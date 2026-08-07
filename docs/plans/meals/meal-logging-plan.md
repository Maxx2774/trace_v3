# Måltidsregistrering med skalbar LLM-orkestrering

## Sammanfattning

Implementera första journalcapabilityn som **skapa + visa måltid**, men bygg
LLM-orkestreringen så att senare domäner som symptoms och saved dishes kan läggas
till utan en växande kärnprompt eller ett specialfall per kombination. Modellen
avgör språklig avsikt, oklarhet, ingredienser, tidsuttryck och vilka domänverktyg
som behövs. Servern använder inga keyword-, substring-, datumtolknings- eller
svarstextheuristiker; den ansvarar för auth, strikt schemavalidering,
verktygsexekvering, dataintegritet och idempotens.

För användaren är varje meddelande en sammanhängande chattur. Internt är den en
generell loop med ett eller flera Responses API-anrop:

1. LLM laddar relevanta domänverktyg och väljer mellan naturligt textsvar och ett
   verktygsanrop.
2. Servern validerar och utför det efterfrågade verktyget.
3. Det kanoniska resultatet skickas tillbaka som `function_call_output`.
4. Loopen fortsätter så länge modellen behöver fler verktyg.
5. När inga verktygsanrop återstår strömmar LLM:en ett naturligt slutsvar baserat
   på de faktiska resultaten.
6. Varje sparad post visas som strukturerad data i chatten och på relevant
   översikt.

## Leveransprincip

- Leverera en liten, komplett produktcapability i taget. Databas, streaming och
  orkestrering är interna arbetssteg och betraktas inte som egna färdiga
  leveranser.
- Första leveransen är **registrera och visa en måltid**: användaren beskriver mat
  eller dryck hen faktiskt konsumerat, `food_log.record` sparar posten exakt en
  gång, posten visas i chatten och LLM:en skriver ett naturligt svar grundat i det
  verifierade resultatet. Omladdning och teknisk retry får inte skapa en dubblett.
- Bygg den första leveransen internt i följande ordning, men verifiera och leverera
  den endast som en sammanhängande helhet:
  1. minimal turn-, meddelande- och måltidspersistens
  2. befintlig HTTP/NDJSON-stream bakom turn-orkestreringen
  3. hosted tool search och `food_log.record`
  4. måltidskort, naturligt slutsvar, replay och retry
  5. kontrakts-, orkestrerings-, modell- och autentiserade E2E-tester
- Efter den första slicen införs läsning av måltidsdata, korrigering via
  verifierade referenser, symptoms och sparade rätter som separata capabilities.
  Cross-domain-beteende verifieras först när den andra domänen faktiskt finns.

## Datamodell och serverkontrakt

- Skapa explicita `turns`, `meals` och `meal_ingredients`; ingen generell journal-,
  event- eller per-tool-runtime-tabell.
- `turns` är den serverägda livscykeln för en användartur. Första slicen lagrar
  endast:
  - `id`: samma klientgenererade UUID som requestens `turn_id`
  - `conversation_id` och `user_id`
  - `status`: `processing | completed | failed_retryable | failed_terminal`
  - `lease_expires_at`
  - `created_at` och `completed_at`
- `messages.turn_id` är obligatoriskt för nya chattmeddelanden och refererar till
  `turns`. En tur har exakt ett user message och högst ett färdigt assistant
  message. Samma `turn_id` med annat normaliserat user message ger konflikt utan
  att ett separat `input_hash` behöver lagras.
- `turns` innehåller i denna slice inte sequence, state-version, prompt- eller
  katalogversion, providerstate, tool-trace eller ett generellt outcome-fält.
- `meals` lagrar ägare, beskrivning, `source_turn_id`, ett servergenererat
  `source_operation_id`, skapad/uppdaterad tid samt:
  - `occurred_precision`: `exact | approximate | date | unknown`
  - `occurred_at`: endast för exakt/ungefärlig tid
  - `occurred_on`: känt lokalt datum
  - `timezone`: validerad IANA-zon när datum/tid är känt
  - `time_expression`: användarens ursprungliga tidsuttryck
- `meal_ingredients` lagrar ordning, användarens uttryck (`reported_text`) och
  LLM-normalform (`normalized_name`). Implicita ingredienser får aldrig läggas
  till.
- Skapa en transaktionell, idempotent `create_meal_from_chat`-RPC:
  - ägare kommer endast från serververifierade claims
  - `source_turn_id` används för provenance och gruppering, inte som unik
    operationsnyckel
  - `source_operation_id` skapas av servern från turen och verktygsstegets stabila
    index; varken klienten eller LLM:en får sätta det
  - `(user_id, source_operation_id)` är unik
  - samma operation och samma payload returnerar befintlig post
  - samma operation med annan payload ger konflikt
  - måltid och ingredienser skapas atomiskt
- Detta tillåter flera distinkta måltider i samma användartur utan att förlora
  retry-säkerhet.
- Aktivera RLS och explicita grants. Autentiserade användare får läsa egna
  domänrader; mutationer och turn-livscykeln förblir serverstyrda. Aktivera RLS på
  `turns`, `meals` och `meal_ingredients`, återkalla oavsiktliga skriv- och
  function-grants och indexera ägar- och foreign-key-kolumner som används i
  policies, joins och cascade. Se
  [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
- Lägg endast index som följer de beslutade läs- och integritetskontrakten:
  - foreign-key-index för `turns.conversation_id`, `turns.user_id` och
    `messages.turn_id`
  - unik `(user_id, source_operation_id)` för idempotens
  - `(user_id, occurred_on, occurred_at, id)` för kända lokala datum
  - partiellt `(user_id, created_at, id)` för `occurred_precision = 'unknown'`
  - `(meal_id, position)` på `meal_ingredients` för relation och stabil ordning
- Konversationsradering raderar turer och meddelanden men inte måltider;
  `meals.source_turn_id` är därför nullable med `on delete set null`.
  `source_operation_id` ligger kvar som idempotensnyckel. Kontoradering
  kaskadraderar även måltiderna.

## Verktygsarkitektur för fler domäner

- Håll kärnprompten liten, stabil och domänoberoende. Den beskriver endast
  produktens generella samtals- och verktygsbeteende:
  - tillgängliga verktyg är sanningskällan för vad Trace kan göra
  - relevanta verktyg ska sökas fram när en begäran kan kräva strukturerad läsning
    eller mutation
  - ett verktygsresultat, aldrig föreslagna argument eller assistantsvarstext, är
    sanningskälla för om en mutation lyckades
  - materiell oklarhet som ändrar uppgiftens betydelse ger en kort naturlig
    följdfråga i stället för ett verktygsanrop
  - saknade fakta får inte fyllas i
  - efter genomförda verktyg skrivs ett kort naturligt svar på användarens språk
- Ta bort den versionsspecifika promptregeln som räknar upp all strukturerad data
  modellen saknar åtkomst till. Modellen får i stället endast använda verktyg som
  faktiskt finns i den aktuella requesten.
- Varje domän äger ett produktsemantiskt namespace, exempelvis `food_log`,
  `symptoms` och `dish_library`, med egna:
  - strikta verktygsscheman
  - detaljerade verktygsbeskrivningar och domänregler
  - serverhandlers och validering
  - kanoniska resultattyper
  - konvertering till en variant i den slutna `JournalRecord`-unionen när domänen
    representerar en journalpost
- Använd hosted `tool_search` och `defer_loading: true` från första slicen. Den
  initiala kontexten innehåller korta namespace-beskrivningar; fulla
  verktygsscheman laddas endast för de domäner den aktuella användarturen behöver.
  Ett och samma tool search kan senare ladda flera namespaces, exempelvis både
  `food_log` och `symptoms`.
- Första requestens verktygsyta är uttryckligen:
  - namespace `food_log` med deferred `food_log.record`
  - hosted `{ type: 'tool_search' }`
  - ingen direkt eller heuristisk fallback som kringgår tool search
- Modellens namespace följer produktens betydelse, inte databasens namn.
  `food_log` betyder mat eller dryck som användaren faktiskt konsumerat, medan
  framtida `dish_library` betyder återanvändbara mallar och aldrig i sig är bevis
  för konsumtion. Interna typer och tabeller behåller de etablerade namnen
  `Meal`, `meals` och `meal_ingredients`.
- Håll namespace-beskrivningen till en kort mening om domänens ansvar. Lägg regler
  för faktisk användning i den deferred funktionsbeskrivningen, så att de bara
  laddas när domänen är relevant.
- `food_log.record` ska uttryckligen beskriva att varje call registrerar en distinkt
  måltid som användaren själv faktiskt har ätit eller äter, inte en plan,
  hypotetisk måltid eller någon annans konsumtion. Modellen får göra flera calls
  för flera måltider i samma meddelande. Endast uttryckligen angivna ingredienser
  får skickas och tidsobjektets precision måste bevaras.
- Registrera `food_log.record` som `{ effect: 'write', parallelSafe: true }`. Varje
  call skapar en distinkt måltid under egen stabil operationsnyckel och delar inget
  write-resultat med ett annat `food_log.record`-call; flera validerade calls från
  samma modellrespons får därför exekveras bounded parallellt.
- Kärnorkestreringen känner endast till registret av tillåtna verktyg och deras
  handlers. Varje registrering binder samman verktygsdefinition, Valibot-schema,
  exekvering och kanonisk resultattyp. Den innehåller inga flöden som är
  hårdkodade som `meal -> symptom -> svar`.
- Inför inget separat lager eller runtime-objekt kallat `SemanticCompiler`.
  LLM:ens konkreta ansvar är att tolka naturligt språk och föreslå typade
  verktygsanrop. Servern behandlar förslagen som otillförlitliga tills schema,
  auth, authority och domänregler har validerats och handlern har returnerat ett
  kanoniskt resultat.
- Behåll stabil ordning för kärnprompt, namespaces och verktygsdefinitioner. Lägg
  dynamisk tid och tidszon efter den stabila promptdelen och låt tool search ladda
  verktyg sist, så att promptcache kan återanvändas.
- Första slicen registrerar endast `food_log.record`. En senare symptoms-slice ska
  kunna registrera `symptoms.record` utan att ändra loopens kontrollflöde eller
  lägga symptoms-regler i kärnprompten.
- Behåll `strict: true` på funktionsverktygen. Autentiserad identitet, interna ID:n
  och annan information som servern redan känner till ska inte fyllas i av
  modellen.
- Se [OpenAI tool search](https://developers.openai.com/api/docs/guides/tools-tool-search)
  och [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling).

## Kontext, stateless replay och recovery

- Behåll `store: false`. Inom en aktiv användartur håller servern en temporär
  Responses-input som består av modellhistoriken, varje fullständig modelloutput
  och motsvarande verktygsresultat.
- Begär `reasoning.encrypted_content` och vidarebefordra reasoning-items tillsammans
  med tool-search- och function-call-items när reasoning-kontinuitet krävs mellan
  stateless modellsteg. Varje `function_call_output` måste använda rätt `call_id`.
- Den temporära provider-inputen lever endast under orkestreringen. Persistensen
  innehåller användar- och assistantmeddelanden samt kanoniska domänposter, inte rå
  provideroutput, tool-search-traces eller reasoning.
- Verktygsresultat ska vara minimala men tillräckliga för fortsatt resonemang och
  UI: status, kanoniskt ID, användarsynliga fält, tidsrepresentation och eventuellt
  en säker felkod. Interna databasfält och felmeddelanden skickas inte till modellen.
- Orkestratorn bygger ett typat `TurnOutcome` i minnet från validerade, kanoniska
  handlerresultat. Det sammanfattar domänexekveringen, inte chatturens tekniska
  livscykel:

  ```ts
  type TurnOutcome = {
  	status: 'succeeded' | 'partially_succeeded' | 'failed';
  	records: JournalRecord[];
  	errors: TurnOperationError[];
  };
  ```

- `TurnOutcome` får aldrig härledas från modellens föreslagna argument eller
  assistant-text. Det används för typade stream-events och UI. En minimal
  `VerifiedResponseBrief` härleds endast för den isolerade composer-evalen; den
  dupliceras inte i den ordinarie modellinputen som redan innehåller de kanoniska
  `function_call_output`-resultaten.
- Persistiera inte ett generellt outcome-JSON i första slicen. Kanonisk authority
  är `turns.status` och de domänspecifika posterna. Vid recovery rekonstrueras
  bekräftade records via `source_turn_id`; saknade retrybara operationer får köras
  igen under samma stabila operationsnycklar. Behovet av beständig outcome-state
  omprövas när en andra domän, beständiga läsresultat eller cross-domain partial
  success har gett ett konkret kontrakt att lagra.
- Bygg en kortlivad, typad `ModelContext` på servern inför varje modellturn.
  Inspirerat av v2 hålls fyra saker åtskilda:
  - aktuellt immutable user message, exakt en gång
  - ett bounded urval av hela tidigare turns i kronologisk ordning
  - kompakta projektioner av associerade, kanoniska `JournalRecord`-poster
  - aktuell tid, verifierad tidszon och eventuella symboliska referenser
- Historikurvalet använder en uttrycklig kombinerad budget för antal turns,
  meddelanden, tecken och uppskattade tokens. Lägg endast till hela turns och
  stoppa vid den första tur som inte ryms; plocka inte lösryckta äldre meddelanden
  för att fylla återstående budget. Lås de första gränsvärdena genom prompteval.
- `ModelContext` byggs endast från en sluten allowlist av serverägda källor. Fri
  metadata, rå providerstate och godtycklig textkonkatenering får inte bli nya
  kontextkällor.
- Modellen får vid behov korta handles som `ref_1`, aldrig interna record-ID:n.
  Servern behåller en privat bindning från handle till domäntyp, record-ID och
  ägare. Bindningen är endast en kandidat: varje verktygsexekvering laddar om och
  verifierar ägarskap, existens, aktuell version när sådan finns och att verktyget
  tillåter operationen. Okänd, stale eller tvetydig referens får inte falla tillbaka
  till `latest`.
- För meal-slicen härleds modellkontexten och eventuella handles deterministiskt från
  meddelanden och journalposter kopplade via `turn_id`/`source_turn_id`. Persistiera
  därför ingen generell `ConversationProjection`, `ConversationState` eller
  `TurnReference`-tabell nu. Inför beständig koordinations- eller referensstate
  först för en verifierad capability som inte kan rekonstrueras säkert, exempelvis
  pending clarification, presenterade queryresultat, pagination, correction eller
  undo. Historikfrågor utanför modellkontextens budget löses med separata
  read-tools.
- Inför en transaktionell `begin_chat_turn` som atomiskt verifierar claims och
  konversation, skapar eller återtar `turns`-raden och sparar user message första
  gången:
  - ny tur får `processing` och en tidsbegränsad serverägd lease
  - `processing` med giltig lease returnerar `pending`
  - `processing` med utgången lease eller `failed_retryable` kan återtas atomiskt
    med en ny lease
  - `completed` returnerar assistantmeddelandet och alla associerade
    `JournalRecord`-poster för deterministisk replay
  - `failed_terminal` returnerar ett stabilt typat terminalfel utan nytt
    modellförsök
  - samma `turn_id` med ändrat user message ger konflikt
- Optimera normalfallet genom att starta `begin_chat_turn` och den första
  Responses-körningen parallellt efter att servern har verifierat auth,
  requestformat, konversationsägarskap och den historik som får skickas till
  modellen. Modellinputen använder requestens immutable user message medan samma
  meddelande sparas av `begin_chat_turn`.
- Vanlig assistant-text får strömmas optimistiskt medan `begin_chat_turn` pågår.
  Persistensen är däremot en obligatorisk commit-barriär före varje beständig
  domänmutation, lagring av assistantsvaret och `done`-eventet. Argument kan
  valideras och parallella grupper planeras medan servern väntar på barriären.
- Om `begin_chat_turn` misslyckas avbryts providerkörningen när möjligt. Inga
  verktyg exekveras, inget assistantsvar sparas och inget `done` skickas.
  Eventuella redan visade textdelar är uttryckligen tillfälliga och klienten
  ersätter dem med ett retrybart eller terminalt fel.
- Lease-värdet som claimen returnerar används som fencing-värde. Varje
  verktygsmutation och finalisering måste kontrollera att samma lease fortfarande
  är aktuell och giltig; en gammal worker får därför inte fortsätta efter att
  turen har återtagits. Ingen databastransaktion hålls öppen under modellanrop.
- Klienten återanvänder `turn_id` vid teknisk retry. En återtagen tur laddar redan
  skapade domänposter via `source_turn_id` och fortsätter utan att upprepa
  bekräftade operationer. Den unika operationsnyckeln skyddar även om ett
  verktygssvar förlorades efter commit.
- Markera turen `completed` först när assistantmeddelandet har sparats. Klassificera
  avbrott som `failed_retryable` eller `failed_terminal` utifrån den typade
  felkontraktsfasen. Inför ingen generell tool execution-ledger eller beständig
  providerstate i denna slice.

## LLM- och UI-flöde

- Utöka chattrequesten med webbläsarens IANA-tidszon; serverns aktuella tid används
  som referens för relativa uttryck. Skicka dem som ett separat dynamiskt
  kontextblock efter den stabila kärnprompten.
- Definiera första verktyget som `food_log.record`. Det tar beskrivning, ingredienser
  och det precisionbevarande tidsobjektet.
- Kör med `parallel_tool_calls: true` från första slicen så att modellen kan
  returnera flera function calls i samma respons, exempelvis två måltider eller
  senare en oberoende måltid och ett symptom. Det minskar normalfallet till ett
  modellsteg för tolkning/tool calls och ett modellsteg för det naturliga
  slutsvaret.
- Varje verktygsregistrering deklarerar serverägd exekveringspolicy:

  ```ts
  type ToolExecutionPolicy = {
  	effect: 'read' | 'write';
  	parallelSafe: boolean;
  };
  ```

- LLM:en får aldrig avgöra faktisk concurrency. Efter att hela modellresponsen är
  färdig validerar servern samtliga calls. Calls som uttryckligen är
  `parallelSafe` och saknar produktberoende får köras samtidigt med en initial
  gräns på tre operationer; övriga körs sekventiellt i stabil responsordning.
  Gränsen låses eller justeras efter tool-latency- och databasmätning.
- Använd bounded `allSettled`-semantik för parallella calls så att ett fel inte
  avbryter eller döljer ett annat utfall. Buffra därefter kanoniska tool outputs
  och `journal_record_created`-events och leverera dem i modellens ursprungliga
  call-ordning, oberoende av completion-ordning.
- Ett call som behöver ett kanoniskt resultat från ett tidigare call kan inte ingå
  i samma parallella grupp. Det begärs i ett senare modellsteg efter att föregående
  `function_call_output` har återförts, eller ägs av ett uttryckligt sammansatt
  verktyg när en produktinvariant kräver det.
- Varje modellkörning får:
  - returnera vanlig text, exempelvis en naturlig följdfråga, utan mutation
  - eller ett eller flera verktygsanrop utan samtidig användarsynlig svarstext
- Klassificera responsläget från Responses API:s typade output-items, inte från
  textinnehåll. Om tool search eller function call börjar är responsen tool-mode
  och eventuell modelltext buffras. Om en assistant-message börjar först strömmas
  den som idag och låser responsen till text-mode. Ett senare tool-item är då ett
  protokollfel: ingen mutation görs och eventuell partiell text ersätts av det
  typade felet. Om tool-mode avslutas utan function call men med ett slutligt
  textmeddelande skickas den verifierade, buffrade texten efter completion.
- Implementera en domänoberoende tool-loop med separata gränser för modellsteg,
  function calls och total tid. Första policyn tillåter högst fem function calls
  och högst sex modellresponser, inklusive det slutliga naturliga svaret. Ersätt
  den nuvarande gemensamma 60-sekunderstimern med en total turdeadline och en
  kortare per-model-step-deadline; lås exakta tidsvärden efter latency-evalen innan
  implementationen betraktas som färdig.
- Loopen är:
  1. anropa modellen med kärnprompt, verktygsregister och ackumulerad input;
     första anropet får överlappa `begin_chat_turn`
  2. samla function calls från den färdiga responsens output
  3. om listan är tom: invänta lyckad turn-persistens, spara den verifierade
     naturliga texten, skicka `done` och avsluta; textdelar får ha strömmats
     optimistiskt dessförinnan
  4. om listan inte är tom: slå upp varje explicit registrerad handler
  5. skapa ett stabilt `source_operation_id` från `turn_id` och callens globala
     exekveringsindex
  6. validera alla argument och korsfältsregler med domänernas Valibot-scheman
  7. planera bounded parallella grupper från registrens explicita
     exekveringspolicy, invänta lyckad turn-persistens och kör därefter writes med
     den aktuella leasens fencing-värde; kör resten sekventiellt
  8. skapa minimala, kanoniska, typade verktygsresultat och sortera dem efter
     ursprungligt call-index
  9. skicka `journal_record_created` för varje lyckad journalmutation i samma
     stabila ordning
  10. lägg hela modellens output samt motsvarande `function_call_output` i nästa
      modellkörnings input
  11. fortsätt utan att tvinga `tool_choice: none`
- Det naturliga slutsvaret genereras alltså av LLM:en först när alla nödvändiga
  mutationer har returnerat sina verkliga resultat. Modellen får aldrig formulera
  en sparbekräftelse utifrån enbart de argument den själv föreslog.
- Produktionsflödet fortsätter med samma modellkonfiguration och den ackumulerade
  Responses-inputen tills modellen returnerar vanlig text utan fler tool calls.
  Inför ingen separat composer-modell eller runtime-adapter i första slicen. En
  isolerad composer får jämföras offline mot samma `TurnOutcome`-fixtures och
  införs först om korrekthet, latency eller tokenkostnad visar en tydlig vinst.
- Hosted tool search kan ladda verktyg och producera det efterföljande function
  callet inom samma modellrespons. Ett applikationsverktyg måste däremot alltid
  utföras av vår server och resultatet skickas tillbaka i ett nytt API-anrop.
- Behåll HTTP på båda transportsträckorna i första slicen: webbläsaren får Trace-
  events över den befintliga NDJSON-streamen och servern använder Responses API:s
  HTTP-streaming. Samma öppna browserrequest kan omfatta flera modellsteg; ett
  nytt modellsteg kräver därför inte en WebSocket till klienten.
- Samla OpenAI-anrop och översättning från provider-events i en konkret servermodul
  som lämnar typade interna events till turn-orkestreringen. Inför inget generellt
  `Transport`-interface innan en andra implementation faktiskt provas.
- Mät bland annat tid från färdigt verktygsresultat till nästa modellrespons och
  antal sekventiella modell–verktygsrundor. Utvärdera Responses WebSocket först om
  verkliga, verktygstunga turns visar materiell fortsättningskostnad eller om en
  produktfunktion kräver dubbelriktad liveinteraktion. Vanliga senare
  användarmeddelanden är inte i sig ett sådant skäl.
- Se [OpenAI HTTP-streaming](https://developers.openai.com/api/docs/guides/streaming-responses)
  och [OpenAI WebSocket mode](https://developers.openai.com/api/docs/guides/websocket-mode).
- Vid blandad text + function call eller fler function calls än konfigurationens
  budget tillåter: mutera ingenting i den modellresponsen och returnera ett typat
  protokollfel. Partiell blandad text ersätts och sparas aldrig. Ingen heuristisk
  reparering.
- Vid ogiltiga argument eller ett verktygsfel: mutera inte för det anropet. Skicka
  tillbaka ett säkert, typat fel som `function_call_output` så att LLM:en kan
  korrigera anropet eller formulera en naturlig förklaring. Endast uttryckligen
  korrigerbara fel, exempelvis schemavalidering, får återföras för nytt försök.
  Auth-, behörighets-, budget- och infrastrukturfel är terminala. Loopgränsen
  förhindrar obegränsade försök.
- Varje domänverktyg definierar sin egen korta atomiska produktgräns. Exempelvis
  skapar `food_log.record` måltid och ingredienser i en transaktion efter att hela
  payloaden har validerats; ingen transaktion hålls öppen under ett modell- eller
  nätverksanrop.
- Separata verktygsanrop committar separat och cross-domain-turer tillåter därför
  partiell framgång som standard. Lyckade mutationer rullas inte tillbaka om ett
  senare domänverktyg misslyckas. `TurnOutcome` innehåller samtliga verifierade
  successes och säkra fel, och LLM:en ska beskriva utfallet korrekt.
- Om två writes enligt en uttrycklig produktinvariant aldrig får existera var för
  sig ska capabilityn äga ett sammansatt verktyg med en gemensam, kort RPC-
  transaktion. Varken modellen, användarens formulering eller generell
  runtime-konfiguration får dynamiskt välja atomicitet. Inför ingen generell
  cross-domain batch- eller rollback-motor.
- Om den slutliga LLM-körningen misslyckas ligger redan skapade poster kvar; deras
  kort visas fortsatt och turen markeras med ett tekniskt svarsfel.
- Inför en sluten, diskriminerad `JournalRecord`-union. Första varianten är
  `{ kind: 'meal', value: Meal }`; senare domäner utökar unionen explicit.
- Utöka `ConversationDetail` med `journalRecords` och `ChatStreamEvent` med
  `{ type: 'journal_record_created', record: JournalRecord }`. Detta är en typad
  läs- och transportprojektion, inte en generell journaltabell. Rendera
  måltidskortet efter användarmeddelandet och det naturliga assistantsvaret under
  kortet.
- Översikten hämtar:
  - måltider vars kända lokala datum matchar användarens aktuella datum
  - de tio senast registrerade måltiderna med helt okänd tid, separat märkta
    `Tid ej angiven`
- Visa användarens ingrediensordalydelse i UI; normalformen är intern data. Uppdatera
  översiktens remote query utan flicker när en `meal`-variant tas emot.

## Verifiering

- Databastester:
  - en ny `turn_id` skapar exakt en tur och ett user message
  - samma `turn_id` och message är idempotent; ändrat message ger konflikt
  - giltig lease ger `pending`, utgången lease kan återtas och en stale lease kan
    varken mutera eller finalisera
  - completed replay returnerar assistantmeddelande och journalposter
  - atomisk måltid + ingredienser
  - alla tidsprecisioner och tom ingredienslista
  - samma operation och payload är idempotent; ändrad payload ger konflikt
  - två olika operationer i samma tur kan skapa två måltider
  - ägarisolering, grants och RLS för turns och domänposter
  - beslutade datum-, unknown- och foreign-key-index finns
  - konversationsradering bevarar måltiden
  - kontoradering tar bort den
- Orkestreringstester med fake streams:
  - vanlig chatt är oförändrad
  - första modellkörningen och `begin_chat_turn` överlappar, medan ingen write,
    assistantpersistens eller `done` passerar innan begin-operationen lyckats
  - misslyckad begin-operation stoppar alla tool-writes och lämnar inget beständigt
    assistantsvar; redan strömmad text avslutas som ett typat fel
  - första måltidsturen använder hosted tool search och laddar `food_log.record`
  - vanlig text som inte behöver strukturerad data utlöser inget tool search
  - ett tool call följs av korrekt `function_call_output` och ett naturligt
    slutsvar i nästa modellkörning
  - modellen kan returnera flera oberoende calls i samma respons och få samtliga
    `function_call_output` före slutsvaret
  - `parallelSafe` fake-handlers överlappar faktiskt under en bounded gräns medan
    serial handlers och beroende calls aldrig överlappar
  - ett parallellt fel avbryter inte övriga calls; outputs, journal-events och
    `TurnOutcome` följer ursprunglig call-ordning, inte completion-ordning
  - encrypted reasoning-, tool-search- och övriga output-items bevaras med rätt
    ordning och `call_id` genom hela stateless-loopen
  - `ModelContext` innehåller aktuellt meddelande exakt en gång, väljer hela turns
    under samtliga historikbudgetar och bevarar kronologisk ordning
  - `buildModelContext()` accepterar endast allowlistade källor och exponerar inga interna
    record-, message-, turn- eller user-ID:n
  - symboliska handles är deterministiska för samma modellkontext; resolution
    ägarvaliderar och avvisar okända, stale och inkompatibla bindings
  - rå provideroutput och reasoning persistieras inte efter turen
  - slutsvaret kan begära ytterligare verktyg eftersom `tool_choice` inte tvingas
    till `none`
  - function-call-, model-step- och tidsbudgeter stoppar respektive överskridande
  - ogiltigt eller blandat output muterar inte
  - vanlig text behåller befintlig streaming; tool-mode skickar ingen text och
    blandad output ersätts utan att texten sparas
  - korrigerbara verktygsfel skickas tillbaka typat och kan följas av ett nytt
    call eller naturligt LLM-svar; terminala fel försöks inte igen
  - varje handler committar sin interna invariant atomiskt utan en transaktion över
    modellsteget
  - ett lyckat första domänverktyg och ett misslyckat andra ger beständig första
    effekt och `partially_succeeded`, inte global rollback
  - `TurnOutcome` byggs endast från kanoniska handlerresultat och representerar
    success, partial success och failure utan att bli beständig dubbellagring
  - verbaliserarens brief innehåller bara verifierade records och säkra fel från
    `TurnOutcome`
  - partiell framgång, svarsfel eller abort efter mutation bevarar skapade poster
  - retry med samma `turn_id` återladdar poster och upprepar inte bekräftade writes
  - färdig replay returnerar både assistantmeddelande och journalposter
- Klienttester:
  - måltidskort visas för `journal_record_created` med `kind: 'meal'`
  - kortet överlever svarsfel och återställs från konversationshistorik
  - completed replay återskapar kortet utan ny mutation
  - översikten uppdateras och skiljer känd från okänd tid
- Modell- och promptevals mot den riktiga Responses-konfigurationen:
  - vanlig konversation väljer text utan tool search
  - tydlig måltid söker fram `food_log` och anropar `food_log.record`
  - två oberoende måltider kan ge två distinkta calls i samma modellrespons; mät
    batchningsgraden och behåll sekventiella modellsteg som korrekt fallback
  - planerad, hypotetisk eller annan persons måltid muterar inte
  - materiell oklarhet ger högst en naturlig följdfråga
  - inga implicita ingredienser skapas och tidsprecision bevaras
  - mät korrekt tool-/namespace-val, falska mutationer, antal modellsteg,
    input tokens, cacheutfall, tool-execution-latency, faktisk parallell överlapp,
    total latency och felfrekvens
  - jämför offline samma verifierade `TurnOutcome`-fixtures mellan produktionens
    same-model continuation och en isolerad composer: faktakorrekthet,
    naturalness, partial-success-formulering, tokens och tid till första texttoken
  - använd resultaten för att låsa tidsbudgeterna och som baseline innan fler
    namespaces registreras
- Autentiserade E2E-smoketester med det dedikerade kontot:
  - tydlig egen avslutad måltid sparas och får naturligt svar
  - två måltider i samma meddelande sparas som två poster
  - relativ, ungefärlig, endast datum och okänd tid visas korrekt
  - lasagne får inga implicita ingredienser
  - planerad, hypotetisk eller annan persons måltid sparas inte
  - materiell oklarhet ger en LLM-genererad följdfråga utan mutation
  - omladdning visar samma post i chatt och översikt
- Kör `pnpm check`, `pnpm test`, `pnpm lint`, `pnpm build` och databastester.
  Uppdatera `docs/capabilities.md` först efter godkänd verifiering.

## Avgränsningar

- Ingen redigering, radering, manuell snabbinmatning eller läs-tool i denna slice.
- Inga saved dishes, symptom, generell tidslinje, summeringar eller evidensanalys
  implementeras i denna slice. Deras namespaces och verktyg läggs till först i
  respektive verifierad capability-slice.
- Ingen obegränsad eller modellstyrd parallell verktygsexekvering. Endast handlers
  som registret uttryckligen markerar `parallelSafe` får överlappa, under en bounded
  servergräns och med deterministisk resultatsortering.
- Ingen separat composer-modell eller `ResponseComposer`-runtime i första slicen;
  en isolerad composer är endast en evalkandidat tills den visar tydlig vinst.
- Ingen sammanslagen `journal.record` med en växande union av alla domäners
  skrivscheman. Domänverktyg hålls separata och laddas via tool search.
- Ingen generell cross-domain batchtransaktion eller runtime-vald rollback.
  All-or-nothing implementeras endast som en uttrycklig sammansatt capability när
  produktens invariant kräver det.
- Ingen Agents SDK eller generell agent-runtime i denna slice; den explicita
  Responses-loopen förblir liten och applikationsägd.
- Ingen `SemanticCompiler`-abstraktion; den semantiska tolkningen sker direkt via
  LLM:ens typade tool calls och säkerheten ligger i serverkontrakten.
- Ingen WebSocket eller generell transportadapter i första slicen. HTTP/NDJSON mot
  klienten och Responses HTTP-streaming mot OpenAI behålls bakom en konkret,
  typad providergräns.
- Ingen persistent lagring av OpenAI-responser eller reasoning; `store: false`
  behålls.
- Ingen beständig generell `ConversationState`, `ConversationProjection` eller
  `TurnReference` i första slicen. `ModelContext` är en kortlivad, bounded
  serverprojektion; beständig kontinuitetsstate införs capability för capability.
- `turns` är medvetet en minimal livscykeltabell. `TurnOutcome` är ett typat
  applikationskontrakt men persistieras inte generellt; versionsfält och
  provider-/tool-state beslutas separat först när ett verifierat behov finns.
- Befintlig modell och SDK-version behålls.
- LLM ansvarar för semantisk tolkning; servervalidering begränsas till säkerhet och
  explicita kontrakt.
