# Feedback på planen för måltidsregistrering

Status: gemensam genomgång slutförd 2026-08-06. Detta dokument återger och
strukturerar den bifogade feedbacken. Accepterade beslut har förts in i
[`meal-logging-plan.md`](meal-logging-plan.md); avgränsade förslag ligger kvar här
som beslutshistorik.

Feedbacken är delvis formulerad mot en tidigare textchattplan. Där den nuvarande
måltidsplanen redan har infört förslaget markeras det nedan. Resterande punkter är
fortfarande förslag eller frågor.

## Beslutsstatus

- **Accepterat 2026-08-06:** turn är den centrala serverägda runtime-enheten och
  får en separat, minimal `turns`-tabell redan i måltidsslicen.
- **Accepterat 2026-08-06:** concurrency löses med en atomisk begin-operation och
  tidsbegränsad lease på turen. Lease-claimen används även som fencing vid writes
  och finalisering.
- **Accepterat 2026-08-06:** `TurnOutcome` införs som ett typat, tillfälligt
  applikationskontrakt byggt från kanoniska handlerresultat.
- **Accepterat 2026-08-06:** v2:s uppdelning används i reducerad form: en
  kortlivad, bounded `ModelContext`, hela historikturer och serververifierade
  symboliska handles.
- **Avgränsat:** outcome dupliceras inte som beständig JSON. Full runtime-state med
  sequence, state-version, promptversion, katalogversion och provider-/tool-state
  införs inte nu.
- **Avgränsat:** ingen generell beständig `ConversationProjection`,
  `ConversationState` eller `TurnReference` införs före en capability som faktiskt
  behöver state som inte säkert kan rekonstrueras.
- **Accepterat 2026-08-06:** varje domänverktyg är atomiskt internt; separata
  cross-domain-anrop committar separat och bevarar partiell framgång.
- **Avgränsat:** all-or-nothing över domäner kräver en uttrycklig sammansatt
  capability och införs inte som generell batch- eller rollback-runtime.
- **Accepterat 2026-08-06:** modellen får returnera flera function calls per
  respons. Servern parallelliserar bounded endast handlers som registret
  uttryckligen markerar `parallelSafe` och bevarar stabil call-ordning i resultaten.
- **Accepterat 2026-08-06:** produktionen fortsätter i samma Responses-loop och
  modellkonfiguration till naturlig text. En isolerad composer jämförs endast i
  eval och får ingen runtime-adapter innan den visar tydlig vinst.
- **Accepterat 2026-08-06:** modellens namespace heter `food_log`, medan interna
  typer och databastabeller behåller `Meal`, `meals` och `meal_ingredients`.
  Framtida sparade mallar får det separata namespaceet `dish_library` och är inte
  i sig bevis för konsumtion.
- **Accepterat 2026-08-06:** behåll HTTP/NDJSON mellan webbläsare och Trace samt
  Responses HTTP-streaming mellan Trace och OpenAI. Isolera provider-events i en
  konkret, typad servermodul men inför inget generellt transportinterface ännu.
  WebSocket utvärderas först mot uppmätta, verktygstunga turns eller ett verkligt
  behov av dubbelriktad liveinteraktion.
- **Accepterat 2026-08-06:** leverera vertikala, verifierbara
  produktcapabilities. Persistens och streaming är interna arbetssteg i den första
  kompletta `food_log.record`-slicen, inte fristående leveranser. Läsning,
  korrigering och nya domäner följer som separata capabilities.
- **Accepterat 2026-08-06:** efter verifierad auth, request och
  konversationsägarskap startar turn-persistens och första modellkörningen
  parallellt. Text får strömmas optimistiskt, men lyckad turn-persistens är en
  barriär före tool-writes, lagring av assistantsvaret och `done`.
- **Accepterat 2026-08-06:** innebörden bakom "semantisk compiler" behålls, men
  termen och ett separat arkitekturlager avvisas. Planen beskriver konkret att LLM
  tolkar språk och föreslår typade calls medan servern validerar, auktoriserar och
  genomför dem.
- **Genomgång klar:** samtliga feedbackpunkter är beslutade eller uttryckligen
  avgränsade.

## Samlad bedömning

Feedbackens huvudbedömning är att hosted `tool_search` från den första domänen är
ett bra och medvetet beslut. Det bör inte optimeras bort. Syftet är att mäta den
latency-, cache- och verktygsprofil som Trace faktiskt ska använda när fler
domäner tillkommer.

Den viktigaste långsiktiga tesen är:

```text
conversation
≠ bara messages

turn
= user input
+ frozen context
+ model interpretation
+ validated operations
+ verified outcome
+ natural response
```

Modellen ska tolka språk. Servern ska äga verkligheten. Ett separat responssteg ska
formulera det verifierade utfallet naturligt utan att lägga till nya fakta.

## Förslag på målarkitektur

```text
Browser
  │
  │ POST /api/chat/stream
  │ { conversationId?, clientTurnId, message }
  ▼
begin_turn
  - verifiera användare och konversation
  - idempotens och concurrency claim
  - spara user message
  - läs ConversationProjection
  - bygg immutable TurnContextSnapshot
  ▼
ModelContext
  - currentMessage
  - kort synlig historik
  - verifierade referenser
  - pending interaction
  - locale, timezone och now
  - tillgängliga namespace-beskrivningar
  ▼
Semantisk modell
  - vanlig konversation
  - hosted tool_search
  - strukturerade operation drafts
  ▼
Server
  - schemavalidering
  - authorization
  - reference revalidation
  - domänvalidering
  - atomisk exekvering
  ▼
TurnOutcome
  - verifierade effekter
  - verifierade läsresultat
  - referenser
  - fel och begränsningar
  ▼
Natural Response Composer
  - minimal verified brief
  - naturlig formulering
  - inga nya fakta
  ▼
finalize_turn
  - spara assistant message
  - spara references
  - uppdatera ConversationProjection
  - markera turn completed
  ▼
done
```

## Vad den nuvarande måltidsplanen redan hanterar

- Hosted `tool_search` och deferred tools används från första domänen.
- Kärnprompten hålls liten och domänregler placeras i verktygsbeskrivningar.
- Ingen keyword-, regex- eller substring-router används.
- Servern ansvarar för auth, strikt validering, authority och dataintegritet.
- `source_turn_id` och `source_operation_id` skiljs åt.
- Stateless tool-loop bevarar tool-search-, function-call- och encrypted
  reasoning-items inom den aktiva turen.
- Bekräftade writes överlever ett senare svarsfel.
- Retry, replay och partiell framgång har uttryckliga kontrakt.
- `JournalRecord` är en typad läs- och transportprojektion; databasen förblir
  domänspecifik.
- Latency, tokenanvändning, cacheutfall och fel ska mätas i modelevals.

## 1. Gör turn till den centrala runtime-enheten

Feedbacken föreslår ett starkare serverägt turn-kontrakt än det som finns i den
nuvarande planen. Ett turn ska bära hela gränsen från accepterad input till
verifierat utfall och sparad naturlig respons.

Föreslaget requestkontrakt:

```json
{
	"conversationId": "optional",
	"clientTurnId": "client-generated UUID",
	"message": "..."
}
```

Föreslagen separat tabell:

```text
turns
- id
- conversation_id
- user_id
- client_turn_id
- sequence
- status
- input_hash
- base_state_version
- prompt_version
- catalog_version
- outcome
- error_code
- created_at
- completed_at
```

`messages.turn_id` ska vara obligatoriskt. Synliga meddelanden förblir rena
`user | assistant`-poster; tool calls, outcomes och providerinformation ska inte
lagras som meddelanden.

Den föreslagna minimala state-maskinen är:

```text
accepted
processing
effects_committed
completed

failed_retryable
failed_terminal
cancelled
```

**Beslut 2026-08-06:** förslaget accepteras i reducerad form. Första slicens
`turns` lagrar endast `id` (samma värde som `clientTurnId`), `conversation_id`,
`user_id`, `status`, `lease_expires_at`, `created_at` och `completed_at`.
`messages.turn_id` blir obligatoriskt för nya chattmeddelanden. Den större
fältuppsättningen och state-maskinen ovan dokumenterar fortsatt feedbackens
målbild men är inte del av den beslutade implementationen.

## 2. Gör concurrency serverägd

Ett klientlås skyddar inte mot två flikar, två enheter, automatisk retry eller två
serverinstanser. Feedbacken föreslår därför:

```text
conversations.active_turn_id
conversations.state_version
```

`begin_turn` gör en atomisk claim. `finalize_turn` använder compare-and-swap mot
samma state-version. Ingen databastransaktion hålls öppen under modellanropet.

**Beslut 2026-08-06:** concurrency blir serverägd, men via turn-raden i stället för
`conversations.active_turn_id` och `state_version`. `begin_chat_turn` claimar en
tur atomiskt. En giltig lease ger `pending`; en utgången lease kan återtas.
Verktygsmutationer och finalisering måste matcha den aktuella claimens lease, så
att en gammal worker inte kan committa efter ett övertagande. Ingen
databastransaktion hålls öppen under modellanropet.

## 3. Persisted `TurnOutcome` som authority

Assistant-texten ska vara en presentation av utfallet, inte själva utfallet.
Feedbacken föreslår:

```ts
type TurnOutcome = {
	status: 'succeeded' | 'partially_succeeded' | 'failed';
	operations: OperationOutcome[];
	verifiedFacts: VerifiedFact[];
	references: TurnReference[];
	warnings: OutcomeWarning[];
};
```

Det centrala recoveryscenariot är:

```text
write utförd exakt en gång
→ verbalization eller stream misslyckas
→ sparat TurnOutcome återanvänds
→ endast naturlig respons genereras igen
```

Felkontraktet bör skilja mellan exempelvis:

```json
{
	"type": "error",
	"phase": "verbalization",
	"effectsCommitted": true,
	"retryable": true
}
```

och:

```json
{
	"type": "error",
	"phase": "execution",
	"effectsCommitted": false,
	"retryable": false
}
```

**Beslut 2026-08-06:** acceptera `TurnOutcome` som ett slutet, typat kontrakt i
applikationslagret, byggt enbart från kanoniska handlerresultat. Det används för
stream-events, UI och en minimal verifierad brief till den naturliga
verbaliseraren. Persistiera däremot inget generellt outcome-JSON i första slicen:
`turns.status` och domänposterna är authority, och bekräftade records kan
rekonstrueras via `source_turn_id` vid recovery. Beständig outcome-state omprövas
när en andra domän, beständiga läsresultat eller verklig cross-domain partial
success visar vilka fält som faktiskt behöver överleva processen.

## 4. Serverägd konversationskontinuitet

Enbart de senaste synliga meddelandena räcker inte långsiktigt för följdfrågor,
korrigeringar och pronomenreferenser. Feedbacken föreslår:

```ts
type ConversationProjection = {
	version: number;
	activeSubject?: string;
	recentReferenceIds: string[];
	pendingInteractionId?: string;
	activeQueryCursorIds: string[];
};

type TurnReference = {
	handle: 'ref_1';
	kind: string;
	recordId: string;
	recordVersion: number;
	allowedFields: string[];
};
```

Modellen ska få symboliska handles som `ref_1`, inte råa databas-ID:n. Servern
mappar handtaget, kontrollerar ägarskap och revaliderar record-versionen.

En enkel verifierad följdfråga ska då kunna besvaras direkt från nästa modellkontext utan
en ny tool-search- och query-loop.

**Beslut 2026-08-06:** använd v2:s ansvarsfördelning i reducerad form, inte dess
fulla runtime. Servern bygger en kortlivad `ModelContext` av aktuellt message,
bounded hela historikturer, associerade `JournalRecord`, tid och tidszon. Modellen
kan få symboliska handles medan servern behåller privata bindings och alltid
revaliderar den riktiga domänposten. `buildModelContext()` har en sluten allowlist av
kontextkällor och inga interna ID:n exponeras.

Persistiera inte generell `ConversationProjection`, `ConversationState` eller
`TurnReference` i första slicen. Måltider och deras relation till turen kan
rekonstrueras via `source_turn_id`. Beständig state införs först när en verifierad
capability behöver pending interaction, presenterade queryresultat, pagination,
correction, undo eller annan kontinuitet som inte säkert kan härledas.

## 5. Reasoning-state inom och mellan turns

Feedbackens rekommenderade ansvarsfördelning är:

```text
Inom ett aktivt turn
→ bevara modellens output-items genom tool-loopen

Mellan användarturns
→ använd serverägd ModelContext och ConversationProjection
```

Föreslagen modellkonfiguration:

```ts
reasoning: {
  effort: 'low',
  context: 'current_turn'
}
```

`none` bör behållas som latencyreferens i evals, men inte väljas dynamiskt med en
egen router. Huvudplanen har redan accepterat `store: false`, encrypted reasoning
inom turen och serverägd kontinuitet mellan turer.

## 6. Tokenbudgeterad `ModelContext`

Meddelandeantal ska endast vara en övre säkerhetsgräns. `buildModelContext()` ska även ha
en inputbudget och kapa vid hela turngränser.

Föreslagen ordning:

```text
1. Stabil compiler-instruktion
2. Search-visible namespace-beskrivningar
3. Kort ConversationProjection
4. Revaliderade TurnReferences
5. Ett fåtal relevanta, hela tidigare turns
6. Current message
7. now, locale och timezone
```

Aktuell fråga och verifierade strukturerade referenser ska alltid prioriteras.
Authority får inte rekonstrueras ur gammal assistantsvarstext.

## 7. Promptcache som explicit kontrakt

Feedbacken föreslår ett stabilt prefix:

```text
core instruction
tool policy
safety boundaries
namespace names and descriptions
cache breakpoint
```

Därefter kommer variabel state:

```text
conversation state
verified references
history
current message
now
```

En versionsbunden cache key föreslås:

```text
trace:compiler:<prompt-version>:catalog:<catalog-version>:profile:<model-profile>
```

Hosted tool search passar upplägget eftersom hittade verktyg läggs sist i
kontexten. Huvudplanen har redan stabil promptordning och cachemätning men har
inte låst ett versionsschema för cache key eller en explicit breakpoint.

## 8. Namespaces ska uttrycka användarintention

Feedbacken rekommenderar produktsemantiska namespaces:

```text
food_log
  Måltider användaren faktiskt har ätit.

dish_library
  Återanvändbara sparade rätter och måltidsmallar.
  Innebär inte att användaren har ätit dem.

weight
  Registrerade viktmätningar.

symptoms
  Symtomhändelser och återkommande check-ins.
```

Detta anses tydligare för modellen än namespaces som speglar normaliserade
SQL-tabeller. Varje namespace bör vara litet och ha en kort, tydligt avgränsad
beskrivning.

**Beslut 2026-08-06:** modellen möter `food_log`, `symptoms` och framtida
`dish_library`. Interna domäntyper, RPC:er och databastabeller behöver inte byta
namn för att följa den modellvända verktygskatalogen. Det håller skillnaden tydlig
mellan faktisk konsumtion och återanvändbara måltidsmallar utan en onödig
datamigrering.

## 9. Saved dishes får inte bli implicita måltidsfakta

En sparad rätt är en mall, inte bevis för vad användaren åt. Trace får inte
automatiskt slå upp en sparad köttpaj och registrera mallens ingredienser när
användaren bara skriver att hen åt köttpaj.

Feedbacken föreslår en explicit operation som endast används vid en uttrycklig
hänvisning:

```text
food_log.record_from_saved_dish
```

Exempel på tillräcklig hänvisning:

```text
Jag åt min sparade köttpaj.
Jag åt samma frukost som vanligt.
Logga köttpajen från mina sparade rätter.
```

Utfallet bör frysa:

```text
saved_dish_id
saved_dish_version
explicit_reference = true
```

En senare ändring av mallen får inte skriva om historiska måltider.

## 10. Symtom ska ha semantiskt separata operationer

Feedbacken avråder från ett stort `symptoms.upsert`. Minst följande betydelser bör
hållas isär när de faktiskt implementeras:

```text
symptoms.record_event
symptoms.record_check_in
symptoms.list
symptoms.correct
symptoms.remove
```

En fristående symtomhändelse och en återkommande check-in betyder olika saker och
ska inte pressas in i ett schema fullt av främmande nullable-fält.

## 11. Cross-domain turns och atomicitet

Exempel:

```text
Åt köttpaj vid 19 och fick ont i magen ungefär en timme senare.
```

Modellen ska kunna ladda både mat- och symtomdomänen och bevara användarens
handlingsordning. Feedbackens föreslagna compiler-flöde är:

1. samla samtliga operation drafts från första modellfasen,
2. validera samtliga,
3. preparera referenser och tider,
4. committa dem atomiskt när produktsemantiken kräver det,
5. returnera ett gemensamt `TurnOutcome`.

Ingen operation ska exekveras medan modellens output fortfarande streamar.

**Beslut 2026-08-06:** behåll huvudplanens partiella framgång. Varje
domänverktyg validerar hela sin payload och committar sin egen invariant i en kort
transaktion. Separata verktygsanrop är separata commits och ett senare fel rullar
inte tillbaka en tidigare verifierad effekt. Om två writes saknar giltig mening var
för sig ska produktcapabilityn exponera ett uttryckligt sammansatt verktyg och en
gemensam RPC-transaktion. Modellen eller en generell runtime får inte välja
atomicitet dynamiskt, och ingen transaktion hålls öppen under modellkörning.

## 12. Utvärdera två tool-protokoll

Feedbacken identifierar två möjliga varianter.

### Variant A: kontraktverktyg plus gemensam draft-submit

```text
tool_search
→ ladda contract_*
→ return_drafts med ops/op/args
```

Fördelar:

- en strukturerad submit,
- enkel action ordering,
- lättare atomisk commit.

Risker:

- tool search laddar callable tools som prompten sedan förbjuder modellen att
  anropa,
- generiska `args` ger svagare schemahjälp,
- extra promptregler krävs.

### Variant B: deferred operation tools

```text
food_log.record(...)
symptoms.record_event(...)
```

Servern behandlar alla calls som otillförlitliga drafts och exekverar dem först
när modellfasen är färdig.

Fördelar:

- tool search används enligt sin naturliga modell,
- varje operation får ett strikt eget schema,
- färre paradoxala promptregler.

Risker:

- batchning och cross-domain ordering måste definieras,
- beroenden kan kräva composite tools,
- atomisk commit över domäner blir mer komplex.

Huvudplanen använder variant B men exekverar calls genom en iterativ loop. Feedbacken
rekommenderar att båda varianterna jämförs med samma evalset innan protokollet
stelnar över många domäner.

**Beslut 2026-08-06:** behåll deferred operation tools och tillåt flera calls i
samma modellrespons. Servern validerar hela responsens calls och kör endast
uttryckligen `parallelSafe`, oberoende handlers samtidigt, bounded till initialt
tre. Övriga eller beroende calls körs sekventiellt. Alla outputs och UI-events
sorteras tillbaka till modellens call-ordning, och ett parallellt fel representeras
som partiell framgång i stället för att avbryta övriga calls.

## 13. `TurnOutcome` och naturlig verbaliserare

För vanliga klientägda functions kräver tool-vägen normalt två inferensfaser:

```text
modell tolkar och föreslår operation
→ server exekverar
→ modell formulerar verifierat resultat
```

Feedbacken föreslår en utbytbar adapter:

```ts
interface ResponseComposer {
	compose(brief: VerifiedResponseBrief): AsyncIterable<string>;
}
```

Den ska kunna jämföra:

```text
A. separat mindre verbaliseringsmodell
B. continuation i samma huvudmodell
```

Briefen ska vara liten:

```json
{
	"question": "...",
	"locale": "sv-SE",
	"effects": [
		{
			"kind": "meal_created",
			"description": "...",
			"occurredAt": "..."
		}
	],
	"warnings": []
}
```

Den ska inte innehålla fulla databasrader, interna IDs, tool calls eller hela
konversationen. Modellen får välja naturlig språkdräkt men bara använda verifierade
fakta.

**Beslut 2026-08-06:** använd samma modellkonfiguration och ackumulerade
Responses-input i produktionsloopen tills modellen returnerar naturlig text utan
fler tool calls. Detta behåller språklig och semantisk kontinuitet samt möjligheten
att begära ytterligare verktyg. Bygg ingen separat composer-modell eller
`ResponseComposer`-runtime i första slicen. Jämför däremot en isolerad composer
offline med samma verifierade `TurnOutcome`-fixtures och inför den först om den
visar en tydlig förbättring i korrekthet, latency eller tokenkostnad.

## 14. Latency- och evalprofil

Feedbacken föreslår följande tidslinje:

```text
T0  request received
T1  begin_turn committed
T2  compiler started
T3  tool_search started
T4  tool definitions loaded
T5  operation drafts completed
T6  domain execution started
T7  TurnOutcome committed
T8  verbalizer started
T9  first user-visible text delta
T10 assistant message persisted
T11 done sent
```

Mät minst:

```text
begin_turn_ms
model_pre_tool_ms
tool_search_ms
loaded_namespace_count
loaded_tool_count
compile_ms
domain_execution_ms
verbalizer_ttft_ms
verbalizer_total_ms
first_visible_text_ms
total_turn_ms
input_tokens
reasoning_tokens
output_tokens
cached_tokens
cache_write_tokens
```

Föreslagna evalbanor:

| Bana                                  | Vad den mäter                             |
| ------------------------------------- | ----------------------------------------- |
| `C0 conversation`                     | Ingen tool search, direkt naturligt svar  |
| `T1 one-domain create`                | Tool search, write och verbalization      |
| `T2 one-domain read`                  | Tool search, query och verbalization      |
| `T3 verified follow-up`               | Direkt svar från revaliderad reference    |
| `T4 correction`                       | Symbolisk reference och revisionskontroll |
| `T5 two-domain turn`                  | Flera namespaces och atomisk commit       |
| `T6 saved-dish reference`             | Mall kontra faktisk måltid                |
| `T7 committed-write response failure` | Recovery utan dubbel write                |

Kall och varm promptcache samt p50 och p95 ska mätas separat.

## 15. HTTP först, WebSocket senare

Feedbacken rekommenderar fortsatt Responses-streaming över vanlig HTTP. Trace-turns
förväntas oftast ha få operationer, så en persistent WebSocket bedöms inte ge
tillräcklig tidig nytta.

OpenAI-transporten kan isoleras bakom en liten adapter så att WebSocket kan mätas
senare utan att turn-runtimen skrivs om. Detta får inte bli en generell
transportabstraktion innan en andra transport faktiskt provas.

**Beslut 2026-08-06:** använd vanlig HTTP i första slicen. Browserrequesten hålls
öppen över hela turn-loopen och kan därför bära både verktygsevents och det
slutliga naturliga svaret även när servern gör flera Responses-anrop. En konkret
OpenAI-modul översätter provider-events till Trace egna typade events; den kallas
inte en generell transportadapter och får inget interface för en hypotetisk andra
transport.

Mät sekventiella modell–verktygsrundor och tiden från färdigt verktygsresultat till
nästa modellrespons. WebSocket blir en evalkandidat först när de mätningarna visar
materiell transportkostnad i verkliga verktygstunga turns, eller när produkten
behöver dubbelriktad liveinteraktion såsom avbrott eller realtime-media. En vanlig
följdfråga i en senare användartur är inte ensam ett skäl för en persistent socket.

## 16. Föreslagen leveransordning

### Del 1: conversation och turn persistence

- `conversations`, `turns` och `messages`
- `clientTurnId` och idempotens
- serverägd turn-status och concurrency claim
- `messages.turn_id`
- `begin_turn` och `finalize_turn`

### Del 2: conversation-only stream

- NDJSON
- direkt streaming
- providerneutral eventmodell
- `store: false`
- assistant message sparas före `done`
- route-filen är endast transport och delegerar till en turn-orchestrator

### Del 3: verklig vertical tool slice

- ett namespace
- hosted `tool_search`
- minst en read och en write
- correction via reference
- verifierat `TurnOutcome`
- naturlig verbaliserare
- retry efter committed write
- separata latencyvärden för tool search och verbalization

### Del 4: andra semantiskt skilda domänen

- lägg till en andra domän
- verifiera att ett användarmeddelande kan kräva båda

Denna ordning är feedbackens förslag. Den står i konflikt med projektprincipen att
migrera en verifierad capability i taget på två punkter: en separat runtime införs
före första journalcapabilityn och den första tools-slicen omfattar read, write och
correction. Konflikten måste lösas innan förslaget kan bli huvudplan.

**Beslut 2026-08-06:** delarna ovan får användas som intern arbetsordning men inte
som fristående leveranser. Den första leveransen avslutas först när användaren kan
registrera och se en måltid, få ett naturligt verifierat svar samt göra en teknisk
retry utan dubbelregistrering. Den omfattar endast write-capabilityn
`food_log.record`; read och correction flyttas till var sin senare slice.

Efterföljande leveranser är i ordning:

1. läsning av måltidsdata,
2. korrigering via verifierade referenser,
3. `symptoms.record`,
4. verifierad kombination av `food_log` och `symptoms`,
5. `dish_library` och explicit registrering från en sparad rätt.

## Beslut feedbacken vill behålla

- OpenAI bakom serverkod.
- Hosted `tool_search` från första domänen.
- `store: false`.
- Supabase som kanonisk produktstate.
- NDJSON i stället för provider-events direkt till klienten.
- Turn-lagring och första modellkörningen startar parallellt; user message måste
  vara beständigt före tool-writes och slutförande, inte före modellstart.
- Assistant-text sparas före `done`.
- RLS plus explicita ägarskapsfilter.
- Inga partiella assistantsvar sparas.
- Ingen regex- eller keyword-router.
- Serverägd validering och authority.
- Strukturerad latencymätning.
- Konversation skapas först när det första meddelandet skickas.

## Öppna beslut som feedbacken väcker

Inga efter genomgången 2026-08-06.

## Slutlig rekommendation i feedbacken

Behåll hosted `tool_search` från första domänen. Kombinera det långsiktigt med:

```text
LLM-tolkning till typade, otillförlitliga tool-call-förslag
+ inga routerheuristiker
+ serverägd validation och authority
+ atomisk domänexecution där produktsemantiken kräver det
+ kanoniskt TurnOutcome
+ minimal naturlig verbaliserare
+ strukturerad serverägd kontinuitet
```

Vanlig konversation ska kräva en modellfas. Tool-turns får acceptera två
modellfaser eftersom den naturliga responsen måste grundas i ett verifierat utfall.
Latency ska främst förbättras genom deferred kontrakt, promptcache, små
resultatbriefs, färre onödiga tool-loopar och direkta svar från revaliderade
referenser.
