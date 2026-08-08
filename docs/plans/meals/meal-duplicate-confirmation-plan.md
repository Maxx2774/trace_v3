# Bekräftelse av möjliga måltidsdubletter

Status: planerad.

Relaterad extern feedback finns i
[`meal-duplicate-confirmation-plan-feedback.md`](meal-duplicate-confirmation-plan-feedback.md).
Endast de punkter som uttryckligen markerats som accepterade är införda här; återstående
feedback ändrar inte planen förrän den har gåtts igenom.

## Mål

Förhindra att två separata användarturer oavsiktligt skapar samma måltid utan att
förbjuda legitima upprepningar. En möjlig semantisk dublett ska pausa registreringen och
be användaren avgöra. Samma tekniska operation ska däremot alltid återspelas idempotent
utan fråga och utan en andra insert.

Exempel:

```text
Användare: Jag åt gröt igår
Trace: Registrerat

Användare: Jag åt gröt igår
Trace: Du har redan registrerat gröt för igår. Vill du registrera ytterligare en måltid?
```

Ingen andra `Meal` får finnas innan användaren uttryckligen bekräftar. Vid bekräftelse
skapas en separat måltid; vid avböjande skapas ingen måltid.

## Låsta produktbeslut

- En teknisk replay och en möjlig verklig dublett är två separata problem.
- Teknisk replay fortsätter använda `turnId`, stabilt `source_operation_id`, input-hash
  och idempotent RPC-resultat. Den får aldrig ge en dublettvarning.
- Semantisk dublettkontroll är en konservativ, deterministisk och versionerad
  produktpolicy. Första versionen heter `meal_duplicate_policy_v1`.
- Kontrollen är en varning, aldrig en unik constraint på `meals` och aldrig automatisk
  sammanslagning eller radering.
- Saknad information är neutral. Den är varken positiv evidens för likhet eller bevis
  för skillnad.
- Ingredienslistor är öppna och ofullständiga. Olika registrerade ingredienser är en
  synlig skillnad, inte en logisk motsägelse.
- Ingen synonymmatchning, singular/plural-konvertering, stavningskorrigering,
  enhetskonvertering, embeddings eller LLM-likhet används i v1.
- Ett möjligt matchningsresultat får inte sparas som en halvfärdig `Meal`. Förslaget
  lagras separat tills det bekräftas eller avvisas.
- Bekräftelse skapar alltid måltiden från den serverlagrade, validerade proposal-payloaden.
  Modellen får inte återskapa eller förändra payloaden när användaren svarar ja.
- Servern avgör deterministiskt när `confirmation_required` gäller och returnerar ett
  strikt, typat resultat med `mealCreated: false` och en strukturerad svarsplikt. En
  separat liten LLM-finalizer utan tools formulerar den naturliga frågan; ingen serverägd
  språk-, mall- eller pluraliseringslogik införs. Finalizern körs högst en gång efter en
  avslutad batch av tool-resultat.
- Den LLM-formulerade frågan sparas som assistantmeddelande. Teknisk replay återanvänder
  den sparade texten och anropar inte modellen igen för att återskapa frågan.
- En bekräftad måltid kopplas till turen där användaren bekräftade. Kortet visas därför
  under bekräftelsesvaret även efter omladdning.
- Väntande protokollstate lagras generellt i `pending_interactions`. `messages` är
  historik/presentation och `meals` samt framtida domäntabeller är kanonisk domändata.
- Tabellnamnet förblir `pending_interactions`; namnet beskriver interaction-typen och
  dess ursprung även när en historisk rad senare är `confirmed` eller `discarded`.
- En interaction börjar som `prepared` utan `prompt_message_id` och blir `pending`
  först när assistantmeddelandet committas och länkas atomiskt. Endast `pending`
  projiceras till nästa modellturn.
- JSONB-payloaden är ett strikt versionerat kontrakt med separata `kind`,
  `schema_version` och `policy_version`.
- `schema_version` versionerar hela den domänspecifika interaction-payloaden; någon
  separat måltidsspecifik `proposal_schema_version` införs inte.
- Den versionerade payloaden är auktoritet för vad användaren ombeds besluta om.
  `messages.content` är endast LLM-formulerad historik och presentation. Resolution får
  aldrig rekonstruera proposal från meddelandet eller fri modelltext.
- `kind` är en stabil semantisk maskinidentitet, här `meal_duplicate`, inte ett
  generellt `meal_confirmation` med subtype gömd i JSONB.
- Tabellidentiteten innehåller obligatoriskt `proposal_input_hash`, saknar
  `expires_at` i v1 och behåller `activated_at` för när frågan faktiskt blev
  besvarbar.
- Flera interactions får länkas till samma assistantmeddelande. `ModelContext`
  projicerar en lista med separata symboliska handles; ett otydligt svar får modellen
  förtydliga utan textheuristik. Ingen beständig `ConversationProjection` införs.
- Provenance går via befintliga operationer: interactionen lagrar proposal- och
  resolution-operation, och den skapade måltiden använder resolution-operationen som
  `source_operation_id`. Domäntabeller får inget `source_interaction_id`, och v1 inför
  inget generiskt operation-ledger.
- Uppgifts- och auktorisationsprovenance bevaras utan nya kolumner på `meals`:
  `proposal_turn_id` anger var innehållet uppgavs, `resolution_turn_id` var det
  godkändes och resolution-operationen binder interactionen till måltidens
  `source_operation_id`.
- Varje proposal-operation får exakt ett eget beständigt outcome. En interaction delas
  aldrig mellan olika `proposal_operation_id`; `proposal_input_hash` verifierar replay
  av samma operation men deduplicerar inte olika operationer. Ingen separat
  operation-resultattabell införs.
- Kandidaten representeras av ett begränsat snapshot i den versionerade payloaden, inte
  av en måltidsspecifik FK i den generella tabellen. Resolutionen är oberoende av om den
  levande kandidaten senare redigeras eller raderas.
- V1 behåller full payload även efter resolution men ingen läs-, replay- eller
  historikfunktion får kräva att terminala interactions alltid har den kvar. En senare
  retention-migrering ska kunna minimera personlig terminal payload utan att ändra
  kanonisk domändata; automatisk redigering byggs inte nu.
- Lifecycle-reglerna låses med SQL `CHECK`-constraints, inte enbart TypeScript. V1 har
  endast `prepared`, `pending`, `confirmed` och `discarded`; korrigering uttrycks genom
  `discarded + corrected_proposal`, inte en separat `superseded`-status.
- Om nästa användarmeddelande tydligt byter till ett orelaterat ämne ska LLM:en i samma
  modellturn explicit discard:a den gamla interactionen med reason
  `conversation_moved_on`. Servern använder ingen relevansheuristik. En följdfråga om
  den väntande registreringen lämnar den däremot `pending`.
- Varje tool-resultat producerar generiska, verifierade effekter: om agenten måste
  fortsätta arbeta, vilka kanoniska svarsdelar som finns och vilka naturliga
  svarsplikter som återstår. Orchestratorn samlar hela batchen i stabil
  `operationIndex`-ordning och härleder därefter exakt en åtgärd: `complete`, `respond`
  eller `continue`, med prioriteten `continue > respond > complete`.
- `respond` använder en liten fryst `ResponseFinalizerContext` och samma typade
  slutkontrakt oavsett domän. Den har inga tools, får inte hitta på nya fakta och måste
  returnera både naturlig text och referenser till samtliga svarsplikter den uppfyllt.
  Detta är den långsiktiga språkytan för framtida domäner, inte måltidsspecifik logik.
- `continue` används endast när fler agentbeslut eller tool-anrop faktiskt kan behövas.
  Ouppfyllda svarsplikter följer då med. När agenten når ett terminalt textsvar ska samma
  strukturerade slutkontrakt användas; en extra finalizer körs bara om ett giltigt svar
  inte redan producerats.
- En modellturn får innehålla både skapade records och interactions som kräver
  bekräftelse. Oberoende tool calls får köras parallellt, men samtliga resultat bevaras
  och sammanställs i stabil `operationIndex`-ordning. Kort/events skickas för varje
  skapad record. Snabbsvaret `Registrerat` används endast när samtliga effekter är
  kompletta utan naturlig svarsplikt.
- Tool-mutationer committas före finalizer-anropet och ingen databastransaktion hålls
  öppen under ett LLM-anrop. `respond` får bara användas när dess kontext kan
  rekonstrueras från beständiga records/interactions och stabila operationsresultat;
  annars används `continue`. Ett finalizer-retry får aldrig köra domänoperationerna igen.
- Ingen ny generell `TurnOutcome`-tabell, outcome-ledger, serverrenderad textmall,
  spekulativ `ResponsePlan` eller projektion av dagens/gårdagens alla måltider införs.
- Måltidstitelgenerering och konversationstitlar påverkas inte.

## V1-policy för möjlig dublett

### Begränsad normalisering

Normalisera namn enbart genom att:

1. trimma inledande och avslutande whitespace
2. ersätta varje följd av whitespace-tecken med ett vanligt mellanslag
3. konvertera till gemener

Skiljetecken och diakritiska tecken bevaras. Normaliseringen ska implementeras en gång i
databasens versionerade matchningshelper och täckas av SQL-tester.

### Grundkandidat

En tidigare måltid blir grundkandidat endast när allt följande gäller:

```text
samma verifierade användare
+ känt occurredOn på båda posterna
+ samma lokala occurredOn
+ exakt samma normaliserade multiset av itemnamn
```

Itemordningen ignoreras, men multipliciteten bevaras. `[Kaffe]` matchar därför inte
`[Kaffe, Kaffe]`. Poster med okänt datum deltar inte i semantisk dublettkontroll i v1.

### Positivt ankare

En grundkandidat ger en varning endast om minst ett av följande ankare finns.

#### A. Kompatibla verkliga klockslag

När båda occurrence-värdena har ett sparat `occurredAt` gäller:

```text
exact + exact             högst 30 minuters absolut skillnad
exact + approximate       högst 90 minuters absolut skillnad
approximate + exact       högst 90 minuters absolut skillnad
approximate + approximate högst 90 minuters absolut skillnad
```

Om båda har verkliga klockslag och skillnaden överskrider gränsen är posten inte en
dublettkandidat, även om den skapades nyligen. Kontrollerade perioder som `morning` och
`evening` omvandlas aldrig till fabricerade klockslag och utgör inte ensamma ett
tidsankare.

#### B. Identisk payload utan verkligt klockslag

När verkligt klockslag saknas är följande ett eget positivt ankare:

```text
identisk kanonisk semantisk payload
+ samma lokala occurredOn
```

Det finns inget `createdAt`-fönster. Två registreringar som görs på olika dagar men
uttryckligen avser samma historiska datum och har identisk kanonisk payload ska därför
ge en varning. Eftersom varningen aldrig blockerar kan användaren fortfarande registrera
två legitima identiska måltider samma dag.

Den kanoniska payloaden innehåller:

- måltidstyp, inklusive skillnaden mellan `null` och ett känt värde
- occurrence-precision, lokalt datum, verkligt klockslag eller kontrollerad tidsperiod
- items som ett sorterat multiset
- varje items normaliserade namn och normaliserade nullable `amountText`
- ingredienser som ett sorterat multiset med normaliserat namn och nullable
  `amountText`

Den innehåller aldrig ID:n, positioner, revision, provenance, mutations-ID:n,
`createdAt` eller `updatedAt`. Item- och ingrediensordning påverkar därför inte
identiteten, men upprepade identiska element bevaras.

### Skillnader som metadata

När grundkandidaten har ett tidsankare får följande skillnader inte eliminera den:

- måltidstyp
- mängd
- ingredienser

Matchningsresultatet ska i stället innehålla en strukturerad diff med `match`, `unknown`
eller `different` för dessa fält. Diffen används för modellens fråga och framtida
produktutvärdering, men v1 uppdaterar eller sammanfogar aldrig den befintliga måltiden.

När samma normaliserade itemnamn förekommer flera gånger byggs diffen som aggregerade,
sorterade multisets per itemnamn. Ingen itemparning får bero på rad- eller SQL-ordning.
Alla uttryckligen kända värden matchas exakt först. En kvarvarande känd skillnad ger
`different`; om ingen sådan finns men saknad information hindrar full jämförelse blir
relationen `unknown`; annars `match`. Ett nullvärde mot ett känt värde är alltså
`unknown`, inte `different`.

### Flera kandidater

Matchningsresultatet innehåller `candidate_count` och exakt en `primary_candidate`.
Endast den primära kandidaten behöver ett snapshot. V1 väljer den så här:

1. kandidat med kompatibelt verkligt klockslag före identisk payload utan verkligt
   klockslag
2. minsta absoluta tidsskillnad
3. minst antal diff-fält med relationen `different`; `unknown` räknas inte som skillnad
4. senast skapade post
5. måltidens UUID som stabil sista tie-breaker

Modellen får kandidatantalet så att frågan inte antyder att exakt en tidigare måltid
finns när flera matchade. Rankningen påverkar endast vilken befintlig post frågan
refererar till. Ingen kandidat raderas eller ändras.

## Beständigt interaction-protokoll

### Ny tabell: `pending_interactions`

Interactionen är arbetsflödesstate som måste överleva en avslutad stream och en ny
användartur. Lägg därför till en generell serverägd tabell, separat från meddelanden och
domändata:

```text
id uuid primary key
user_id uuid not null references auth.users(id) on delete cascade
conversation_id uuid not null references conversations(id) on delete cascade
kind text not null
status text not null  -- prepared | pending | confirmed | discarded
schema_version smallint not null
policy_version smallint null
proposal_turn_id uuid not null references turns(id) on delete cascade
proposal_operation_id text not null
proposal_input_hash text not null
prompt_message_id uuid null references messages(id)
resolution_turn_id uuid null references turns(id) on delete set null
resolution_operation_id text null
resolution_reason text null
payload jsonb not null
created_at timestamptz not null
activated_at timestamptz null
resolved_at timestamptz null
```

Lås följande integritet:

- För den här leveransen gäller `kind = 'meal_duplicate'`, `schema_version = 1` och
  `policy_version = 1`.
- För `prepared` och `pending` följer `payload` ett strikt runtime-validerat
  `MealDuplicateInteractionV1`-kontrakt med den kanoniska `RecordMealInput`, ett
  relevant snapshot av kandidaten och strukturerade matchdetaljer. Inga fria
  modellgenererade förklaringar sparas. V1 lämnar payloaden oförändrad efter resolution,
  men terminala läsflöden får inte använda den som permanent journal-authority.
- `(user_id, proposal_operation_id)` är unik för idempotent replay av den ursprungliga
  tool-operationen. Samma operation med en annan `proposal_input_hash` är ett
  kontraktsfel.
- `resolution_operation_id` är unik per användare när det finns, så retry av ja/nej ger
  samma utfall.
- Ingen unik constraint över `proposal_input_hash` får koppla ihop olika operationer.
  Varje distinkt proposal-operation äger sitt eget skapade meal- eller
  interaction-outcome.
- `prepared` måste sakna `prompt_message_id`, `activated_at` och resolution-fält.
  `pending` måste ha `prompt_message_id` och `activated_at`, men sakna
  resolution-fält. Terminala rader måste ha prompt-, aktiverings- och samtliga
  resolution-fält. `confirmed` har `resolution_reason = 'user_confirmed'`.
  `discarded` kräver någon av `user_declined`, `conversation_moved_on` eller
  `corrected_proposal`.
- Statusmängden och samtliga statusberoende null/non-null-regler ovan ska uttryckas som
  databasens `CHECK`-constraints. Servervalidering kompletterar men ersätter dem inte.
- `commit_turn` sparar den LLM-formulerade assistantfrågan och sätter
  `prompt_message_id`, `activated_at` samt `prepared -> pending` i samma
  databastransaktion. En interaction får aldrig bli `pending` om frågan inte samtidigt
  blir beständig.
- Ownership-constraints binder conversation, proposal turn, prompt message och
  resolution turn till samma verifierade användare.
- Ingen tidsbaserad expiration införs i v1. En pending-interaction ligger kvar inom samma
  konversation tills den bekräftas, avböjs, ersätts av en korrigerad registrering eller
  LLM:en explicit discard:ar den när samtalet tydligt går vidare.
- Besvarbara bekräftelser hämtas med ett partiellt index på
  `(user_id, conversation_id, created_at desc, id) where status = 'pending'`.
- Foreign keys som inte redan täcks får egna index.

Interactionen lagrar inget `created_meal_id`, och `meals` får inget
`source_interaction_id`. Vid bekräftad registrering är `resolution_operation_id` samma
operation som den skapade måltidens befintliga `source_operation_id`.

Aktivera RLS utan klientpolicies. Återkalla tabellåtkomst från `anon` och
`authenticated`; endast appserverns verifierade serviceflöde får läsa och mutera
interactions.

## Atomiska databaskontrakt

### Förbered registrering

Ersätt nuvarande ensidiga resultat från `create_meal_from_chat` med ett diskriminerat
resultat:

```ts
type PrepareMealRegistrationResult =
	| { status: 'created'; meal: Meal; replayed: boolean }
	| {
			status: 'confirmation_required';
			interaction: MealDuplicateInteractionV1;
			replayed: boolean;
	  };
```

RPC:n ska inom samma korta databastransaktion:

1. validera input, tur, verifierad ägare och lease precis som idag
2. beräkna kanonisk payload och input-hash
3. återspela en redan skapad måltid för samma operation före all semantisk kontroll
4. återspela interactionen för samma operation oavsett dess nuvarande lifecycle-status
5. för känt datum ta ett transaction-scoped advisory lock på användare + lokalt datum
6. efter låset kontrollera samma operation igen
7. hitta och rangordna kandidaten enligt `meal_duplicate_policy_v1`
8. skapa och returnera en `prepared` interaction om kandidat finns
9. annars skapa meal, items och ingredients atomiskt som idag

Advisory-låset får endast hållas under RPC:ns databasarbete; inga modell- eller
nätverksanrop sker under låset. Okänt datum använder ingen semantisk kontroll och behåller
den befintliga operationslåsningsvägen.

Den befintliga `(user_id, occurred_on, occurred_at, id)`-indexeringen används för att
begränsa kandidatfrågan till en användares måltider samma dag. Lägg inte till lagrade
fingerprints eller ett bredare index innan mätning visar att den lilla dagsmängden kräver
det.

### Lös bekräftelse

Skapa en separat `resolve_meal_duplicate_interaction`-RPC med:

```ts
type ResolveMealDuplicateInteractionInput = {
	userId: string;
	turnId: string;
	leaseExpiresAt: string;
	operationIndex: number;
	interactionId: string;
} & (
	| { decision: 'register' }
	| {
			decision: 'discard';
			reason: 'user_declined' | 'conversation_moved_on' | 'corrected_proposal';
	  }
);
```

RPC:n ska låsa interaction-raden och verifiera `kind + schema_version`, ägare,
konversation, att status är `pending` och den aktuella turens lease.

- `register` skapar meal, items och ingredients atomiskt från den lagrade proposalen,
  använder resolution-operationen som måltidens `source_operation_id`, markerar
  interactionen `confirmed` och returnerar den skapade måltiden.
- `discard` markerar interactionen `discarded` med den validerade anledningen utan att
  skapa en måltid.
- Retry med samma resolution-operation returnerar exakt samma tidigare resultat.
- En annan operation mot en redan löst interaction returnerar ett typat
  `already_resolved`-resultat och får aldrig skapa ytterligare en måltid.
- Den kandidat som utlöste varningen ändras aldrig.

Alla nya eller ersatta RPC:er ska vara `security invoker`, ha tom `search_path`, få
explicit återkallad `execute` från `PUBLIC`, `anon` och `authenticated` och endast ges
till `service_role`, i linje med nuvarande serverägda mutationsmodell.

## Server- och toolkontrakt

### Generiska tool-effects och nästa åtgärd

Ett domäntool returnerar fortfarande sitt strikta domänresultat. Direkt efter validering
mappar dess serveradapter resultatet till ett litet domänoberoende effektkontrakt:

```ts
type ToolExecutionEffects = {
	requiresAgentContinuation: boolean;
	canonicalParts: CanonicalResponsePart[];
	responseObligations: ResponseObligation[];
};

type ResponseObligation =
	MealDuplicateConfirmationObligationV1 | InteractionDiscardAcknowledgementV1;
```

- `requiresAgentContinuation` är `true` endast när agenten kan behöva fatta ett nytt
  beslut eller anropa fler tools, exempelvis efter ett korrigerbart fel eller när ett
  nytt användarärende återstår.
- `canonicalParts` refererar till redan verifierade, deterministiska svarsdelar såsom
  skapade `JournalRecord`-kort och **Registrerat**. V1 återanvänder befintliga records och
  events; ingen ny tabell eller beständig generell response-part-modell införs.
- `responseObligations` beskriver naturligt språk som fortfarande måste produceras.
  Varje unionsmedlem har en stabil symbolisk `ref`, stabil `kind`, `schemaVersion` och
  endast de verifierade fakta som krävs för att uttrycka den. Alla varianter valideras
  strikt vid runtime. Exempel i v1 är
  `ask_meal_duplicate_confirmation` och `acknowledge_interaction_discard`.

Alla resultat i en exekverad batch samlas först och sorteras på `operationIndex`. Därefter
härleder orchestratorn åtgärden utan domänspecialfall:

```ts
type NextTurnAction = 'complete' | 'respond' | 'continue';

function deriveNextAction(effects: ToolExecutionEffects[]): NextTurnAction {
	if (effects.some((effect) => effect.requiresAgentContinuation)) return 'continue';
	if (effects.some((effect) => effect.responseObligations.length > 0)) return 'respond';
	return 'complete';
}
```

`complete` skickar endast de kanoniska delarna och gör inget nytt LLM-anrop. `respond`
kör en separat finalizer. `continue` ger den fulla agenten tool-resultaten och alla ännu
ouppfyllda svarsplikter så att den kan fortsätta arbeta. Nya domäner ansluter genom att
mappa sina verifierade resultat till samma tre effektfält, inte genom att växa en global
prompt med domänregler.

Turer utan tool calls påverkas inte. Ett meddelande som ”Hej” besvaras direkt av den
första agentkörningen och innebär fortfarande exakt ett LLM-anrop; finalizern används
bara efter en tool-batch vars härledda åtgärd är `respond`.

### Naturlig response-finalizer

`respond` skapar ett fryst, litet och rekonstruerbart kontrakt:

```ts
type ResponseFinalizerContext = {
	referenceInstant: string;
	timezone: string;
	currentUserMessage: string;
	canonicalParts: CanonicalResponsePart[];
	responseObligations: ResponseObligation[];
};

type FinalizerOutput = {
	text: string;
	fulfilledObligationRefs: string[];
};
```

Kontexten innehåller ingen generell historik, ingen dump av dagens eller gårdagens
måltider och inga råa interna databas-ID:n. `referenceInstant` fryses med turen så att
ord som ”idag” och ”igår” inte ändrar betydelse vid retry. Obligationernas verifierade
sammanfattningar är språkunderlag; interaction-payload och domändata förblir auktoritet.

Finalizern:

- använder `gpt-5.6-luna` med centralt konfigurerad profil: `reasoning: low`,
  `verbosity: low` och initialt högst 512 output-tokens
- har en liten versionerad kärnprompt och inga tools eller `tool_search`
- ska svara kort, naturligt och på användarens språk
- får endast uttrycka verifierade fakta i kontexten
- måste returnera strikt `FinalizerOutput`
- godkänns endast om varje obligatorisk ref är uppfylld exakt en gång och inga okända
  refs returneras

Profilen ska ligga centralt och kunna utvärderas utan att ändra domänkontrakten. Börja
med `reasoning: low`; prova `none` och/eller ett lägre output-tak först efter mätning av
latens och svarskvalitet.

Om en `continue`-körning får svarsplikter använder dess terminala textsvar samma strikta
`FinalizerOutput`. Ett giltigt sådant svar skickas direkt och ingen separat finalizer
körs. Om agenten i stället gör fler tool calls samlas deras effekter in, gamla ouppfyllda
plikter följer med och nästa åtgärd härleds på nytt efter hela batchen.

Finalizern kör alltid efter att tool-mutationernas korta transaktioner har avslutats.
Vid modell- eller streamfel rekonstrueras samma `ResponseFinalizerContext` från turens
beständiga records, `prepared` interactions och stabila operationsresultat och endast
finalizern körs om. Ett resultat som inte kan rekonstrueras säkert får inte gå till
`respond`; det markeras för `continue`. V1 bygger inte ett nytt generellt outcome-ledger
för detta.

### `food_log.record`

Behåll nuvarande modellinput. Tool-resultatet blir:

```ts
type FoodLogRecordOutput =
	| { status: 'created'; meal: Meal }
	| {
			status: 'confirmation_required';
			confirmationRef: string;
			proposedMeal: MealSummary;
			existingMeal: MealSummary;
			match: MealDuplicateMatchDetails;
	  };
```

Vid `confirmation_required`:

- returneras ingen `JournalRecord`
- skickas inget `journal_record_created`-event
- skapas `requiresAgentContinuation: false`
- skapas en `ask_meal_duplicate_confirmation`-plikt med symbolisk ref och verifierade
  proposal-, kandidat- och matchningssammanfattningar
- härleds därför `respond`, så länge inget annat resultat i samma batch kräver
  `continue`
- får modellen aldrig säga att måltiden har registrerats
- innehåller resultatet uttryckligen `mealCreated: false` och
  `requiredAction: 'ask_for_confirmation'`

Vid `created` skapas en kanonisk record-del utan svarsplikt. Om alla resultat i batchen
är likadana härleds `complete` och nuvarande deterministiska **Registrerat** används utan
ytterligare LLM-anrop.

### `food_log.resolve_registration`

Lägg till ett separat deferred tool:

```ts
type ResolveRegistrationInput =
	| {
			confirmationRef: string;
			decision: 'register';
			responseRequired: boolean;
	  }
	| {
			confirmationRef: string;
			decision: 'discard';
			reason: 'user_declined' | 'conversation_moved_on' | 'corrected_proposal';
			responseRequired: boolean;
	  }
	| {
			confirmationRef: string;
			decision: 'leave_pending';
			reason: 'interaction_followup' | 'ambiguous_response';
			responseRequired: true;
	  };
```

- Lägg endast verktyget i den aktuella requestens sökbara katalog när serverns frysta
  modellkontext innehåller minst en verifierad `pending` meal-confirmation. Detta är
  databasstyrd capability-exponering, inte semantisk routing eller en textheuristik.
- `register` får endast användas efter ett uttryckligt ja till den projicerade
  bekräftelsen. Resultatet innehåller måltiden och en `JournalRecord`; en ren bekräftelse
  ger en kanonisk record-del utan svarsplikt och använder därmed den befintliga
  deterministiska texten **Registrerat**.
- `responseRequired` sätts av LLM:en till `true` endast när samma användarmeddelande också
  innehåller ett nytt ärende eller en fråga som behöver ett naturligt svar; ett rent ja
  eller nej använder `false`. Det är ett explicit tool-kontrakt, inte serverheuristik.
- När den frysta kontexten innehåller minst en verifierad pending interaction tvingar
  requestkontraktet modellen att anropa `resolve_registration` som första protokollsteg.
  LLM:en väljer själv semantiken: `register`, `discard` eller `leave_pending`. Detta
  hindrar ett vanligt textsvar från att oavsiktligt lämna protokollstate hängande utan att
  servern klassificerar användartext.
- `leave_pending` muterar ingenting och används endast för en faktisk följdfråga om
  förslaget eller ett genuint otydligt svar. Resultatet kräver en fortsatt agentkörning som
  formulerar svaret; efterföljande modellsteg i samma tur tvingas inte fatta beslutet igen.
- `discard` innehåller ingen `JournalRecord` och skapar en
  `acknowledge_interaction_discard`-plikt för ett kort naturligt svar. Ett nytt ärende,
  med eller utan fler tools, sätter `requiresAgentContinuation` via `responseRequired`
  och plikten följer med.
- Otydligt svar, flera relevanta pending-förslag eller en korrigering ska inte gissas som
  `register`. Modellen frågar kort eller använder en ny `food_log.record`-operation.
- Ett tydligt byte till ett orelaterat ämne ska få modellen att anropa `discard` med
  `conversation_moved_on` samtidigt som den hanterar det nya ämnet. Detta är ett
  LLM-tolkat protokollbeslut, inte serverägd textklassificering. En faktisk följdfråga
  om interactionen lämnar den pending.
- Ett okänt, ännu inte levererat eller redan löst handle ger ett typat korrigerbart
  tool-resultat, inte ett generellt serverfel.

### Symboliska referenser i modellkontexten

Utöka `prepareModelContext` med `pending` interactions för den verifierade användaren och
den aktuella konversationen. `prepared` får aldrig projiceras. Hämta pending-raderna
parallellt med historik och övrig konversationskontext när en `conversationId` finns.
Frys resultatet i samma `ModelContext` före det första Responses-anropet och hosted
`tool_search`; ingen senare confirmation-fetch får ändra verktygsytan mitt i turen.
Fältet är en lista, exempelvis `pendingInteractions`, eftersom flera rader får dela
samma `prompt_message_id`. Varje rad får ett eget symboliskt handle. Listan byggs direkt
från verifierade `pending`-rader; v1 skapar ingen beständig generell
`ConversationProjection`.

När den verifierade modellkontexten är färdig får `begin_turn`-persistensen och första
modellkörningen fortfarande starta parallellt enligt måltidsplanens latencykontrakt.
Det tillkommer alltså ingen separat sekventiell confirmation-runda utöver den
kontextladdning modellen redan behöver.

Projicera endast:

- symboliskt handle, exempelvis `pending_meal_1`
- proposalens måltidstyp, occurrence, items och uttryckliga ingredienser
- den befintliga kandidatens motsvarande sammanfattning
- strukturerad matchningsorsak och relevanta skillnader

Databas-ID:n skickas inte till modellen. Lägg bindingen i modellkontextens verifierade
referenskarta och låt tool-exekveringen översätta `confirmationRef` till internt UUID,
följt av en ny serververifiering i RPC:n.

Propagera referenskartan och den serververifierade konversationens ID explicit genom
route → stream → orchestrator → `ToolExecutionContext`. LLM-argumentet innehåller endast
det symboliska handlet; UUID:t hämtas aldrig från fri modelltext.

Pending-projektionen räknas in i befintlig tecken- och tokenbudget. Den fulla agentens
generella kärnprompt får endast regler för hur svarsplikter följer med genom
`continue`; måltidsspecifika formuleringar läggs inte där. Finalizerns separata lilla
kärnprompt beskriver det generella `FinalizerOutput`-kontraktet. Själva semantiken och
de verifierade fakta som ska uttryckas kommer från de versionerade obligationerna.

## Orkestrering och användarflöde

### Första upprepningen

```text
food_log.record
→ confirmation_required och prepared interaction, ingen record
→ effekterna ger respond
→ finalizern får ett fryst ResponseFinalizerContext och ställer en kort fråga
→ assistantmeddelandet sparas och interactionen blir pending i samma commit
→ turnen slutförs normalt
```

Det befintliga snabbflödet för **Registrerat** får endast köras när varje förberett
tool-call faktiskt returnerade en beständig `JournalRecord`.

### Blandade resultat i samma turn

```text
food_log.record(banan) → created + JournalRecord
food_log.record(gröt)  → confirmation_required + prepared interaction
→ banankortets event skickas
→ båda resultatens effekter samlas i stabil operationsordning
→ respond härleds en gång
→ finalizern skriver ett gemensamt svar och uppfyller grötens svarsplikt
→ assistantmeddelandet committas och gröt-interactionen blir pending
```

Oberoende tool calls får exekveras parallellt men resultatordningen bestäms alltid av
`operationIndex`. Ingen skapad record får döljas för att en annan operation väntar på
bekräftelse, och ingen väntande proposal får beskrivas som registrerad.

### Användaren bekräftar

```text
”Ja”
→ pending_meal_1 finns i verifierad modellkontext
→ food_log.resolve_registration(register)
→ meal skapas från lagrad proposal
→ journal_record_created
→ Registrerat + måltidskort
```

### Användaren avböjer

```text
”Nej”
→ food_log.resolve_registration(discard)
→ ingen meal och inget kort
→ acknowledge_interaction_discard-plikt
→ respond-finalizern ger ett kort naturligt assistantsvar
```

### Användaren korrigerar

```text
”Nej, jag menade idag”
→ food_log.resolve_registration(discard) körs först
→ food_log.record körs därefter med korrigerat datum
→ den nya operationen genomgår samma policy
→ hela batchens kanoniska delar och svarsplikter sammanställs
```

Modellen bör i samma steg avvisa den gamla pending-bekräftelsen och skicka den nya
registreringen när båda operationerna är kända, men discard-anropet ska ligga först.
Operationerna ska exekveras i stabil verktygsordning; resolve-toolen märks därför inte
`parallelSafe` när den kombineras med andra måltidsmutationer. Om ett korrigerbart utfall
ändå kräver `continue` följer kvarvarande svarsplikter med. När agenten är färdig måste
terminalsvaret uppfylla dem via `FinalizerOutput`; då görs inget tredje modellanrop.

### Användaren byter ämne

```text
”Jag har ont i magen idag”
→ modellen bedömer att måltidsfrågan inte besvaras
→ food_log.resolve_registration(discard, conversation_moved_on)
→ symptoms.record kan köras i samma modellturn
→ den gamla interactionen är inte längre pending
→ discard-plikten och symptomutfallet sammanställs i det terminala svaret
```

Oberoende operationer i olika domäner får exekveras parallellt när respektive tool är
markerat säkert för det. Servern gör ingen egen relevansbedömning och ett förtydligande
om dublettfrågan ska inte discard:a interactionen. Om någon effekt kräver `continue`
väntar orchestratorn in hela den parallella batchen och skickar sedan samtliga resultat
och ouppfyllda obligationer i en enda fortsatt agentkörning.

### Fel och retry runt finalizern

```text
tool-RPC committar Meal och/eller prepared Interaction
→ batchens verifierade effekter samlas
→ respond härleds
→ finalizern körs utanför databastransaktion
→ assistantmeddelande + prepared → pending committas atomiskt
```

Om finalizern misslyckas finns inget halvsparat assistantmeddelande och ingen
`prepared` interaction har blivit besvarbar. En retry laddar de records och prepared
interactions som hör till samma `turnId` och stabila operationsindex, bygger samma
`ResponseFinalizerContext` och kör endast språksteget igen. Måltider eller andra
domänmutationer körs inte om. När svaret väl är committat återanvänder teknisk replay det
sparade assistantmeddelandet utan ett nytt LLM-anrop.

## Filplacering och ansvar

- `src/lib/features/meals/contracts.ts`: publika typer för matchningsdetaljer och
  bekräftelseutfall som delas mellan chat och server.
- `src/lib/features/meals/duplicate-confirmation.ts`: presentationshelpers för
  bekräftelsesammanfattningar; ingen andra TypeScript-implementation av SQL-matchningen.
- `src/lib/server/meals/meals.ts`: typade wrappers för prepare/resolve och serververifierad
  mapping.
- `src/lib/server/chat/tools/food-log-record.ts`: befintligt record-tool och dess schema.
- `src/lib/server/chat/tools/food-log-resolve-registration.ts`: det separata resolve-toolet så att
  record-filen inte växer med ett andra beteende.
- `src/lib/server/chat/history.ts`: laddning, budgetering och symboliska bindings för
  pending-bekräftelser.
- `src/lib/server/chat/tools/registry.ts`: det lilla generiska
  `ToolExecutionEffects`-kontraktet och domäntoolens explicita mapping till det.
- `src/lib/server/chat/orchestrator.ts`: samla ordnade effekter, bära ouppfyllda
  svarsplikter och härleda `complete | respond | continue` utan måltidsspecifika
  textheuristiker.
- `src/lib/server/chat/response-finalizer.ts`: bygg rekonstruerbar
  `ResponseFinalizerContext`, kör den verktygslösa Luna-profilen och validera
  `FinalizerOutput`.
- `src/lib/server/chat/provider.ts`: stöd det strikta terminala output-kontraktet när en
  agent- eller finalizer-request har svarsplikter; exponera fortfarande endast `text`
  utåt efter servervalidering.
- `supabase/migrations/*`: tabell, policy-v1-helper, index och atomiska RPC:er.
- `supabase/tests/meal_logging.sql`: auktoritativa policy-, idempotens-, auth- och
  transaktionstester.
- Alla TypeScript-tester ligger under repositoryts `/tests`.

Ingen confirmation-komponent läggs till i `features/meals/components` i v1. Frågan är ett
vanligt assistantmeddelande och måltidskortet visas först efter bekräftad insert.

## Verifiering

### SQL och dataintegritet

Täck minst följande:

- samma operation + samma hash återspelar skapad meal utan semantisk varning
- samma operation + annan hash ger konflikt
- separat operation med samma datum och identiska tidlösa payload ger pending och ingen
  andra meal, även när den tidigare posten skapades för mer än 10 minuter sedan
- registrering på måndag och identisk datum-only-registrering på tisdag för samma
  historiska lördag ger pending
- samma itemnamn men okänt datum ger ingen semantisk varning
- itemordning ignoreras och multiplicitetskillnad respekteras
- exact/exact vid 30 minuter matchar och vid 31 minuter inte matchar
- exact/approximate och approximate/approximate vid 90 minuter matchar och vid 91 minuter
  inte matchar
- två verkliga tider utanför gränsen matchar inte
- kontrollerad tidsperiod fabricerar inget tidsankare
- måltidstyp-, mängd- och ingrediensskillnader bevaras i diffen när tid ankras
- identiska retries returnerar samma prepared eller pending confirmation
- confirm skapar exakt en meal; retry returnerar samma meal
- discard skapar ingen meal
- annan användare eller konversation kan inte läsa eller lösa bekräftelsen
- parallella separata operationer för samma användare/datum resulterar deterministiskt i
  högst en direkt insert och därefter pending enligt policyn
- RLS, grants, foreign keys och cascade/set-null-beteenden är korrekta

### TypeScript och orkestrering

- record-tool mappar `created` respektive `confirmation_required` korrekt
- ingen JournalRecord eller registreringsbekräftelse skickas före användarens ja
- resolve register skapar record och använder befintlig deterministisk **Registrerat**
- resolve discard skapar en svarsplikt utan record; ett rent nej kräver inte
  agentfortsättning medan ett samtidigt nytt ärende gör det via `responseRequired`
- verifierad pending state tvingar ett första `resolve_registration`-anrop; modellen kan
  explicit `leave_pending` för en följdfråga utan databasmutation eller loop
- `deriveNextAction` ger `continue` före `respond` och `respond` före `complete`
- hela parallella tool-batchen samlas i stabil `operationIndex`-ordning före
  action-derivering
- en ren created-batch ger `complete` utan extra LLM-anrop
- en ren confirmation-batch ger exakt ett `respond`-anrop utan tools
- blandade created- och confirmation-resultat ger ett gemensamt finalizersvar samtidigt
  som samtliga kanoniska record-events bevaras
- terminalt `continue`-svar med giltiga `fulfilledObligationRefs` gör inget extra
  finalizer-anrop
- finalizersvar med saknad, duplicerad eller okänd obligation-ref avvisas
- finalizer-requesten innehåller varken tools, `tool_search`, konversationshistorik eller
  generell måltidsprojektion
- finalizer-retry rekonstruerar samma frysta kontext utan att köra tool-mutationer igen
- endast egna confirmations med status `pending` projiceras med symboliska handles;
  `prepared` projiceras aldrig
- assistantfrågan och övergången `prepared → pending` committas atomiskt; ett streamfel
  före commit lämnar ingen besvarbar confirmation
- interna UUID:n förekommer inte i modellmeddelanden
- pending-projektionen respekterar kontextbudgeten
- replay av en slutförd teknisk turn behåller nuvarande deterministiska beteende
- flera tool-calls behåller stabil ordning och korrekt `parallelSafe`-policy

### End-to-end i utvecklingsmiljön

Använd det dedikerade E2E-kontot från `.env.local` och verifiera:

1. registrera **Jag åt gröt igår** och få exakt en meal/card
2. skicka samma uppgift direkt igen och få en fråga utan nytt kort eller ny meal
3. svara ja och få exakt en ytterligare meal/card
4. upprepa scenariot och svara nej; meal count förblir oförändrad
5. ladda om mellan fråga och svar; pending-bekräftelsen kan fortfarande lösas
6. teknisk retry med samma `turnId` skapar varken fråga eller extra meal
7. två verkliga grötmåltider med tydligt skilda klockslag kan registreras utan varning
8. ett injicerat finalizerfel efter tool-commit lämnar interactionen `prepared`; retry
   skapar exakt ett assistantmeddelande, aktiverar samma interaction och skapar ingen
   extra meal
9. en blandad turn med en skapad meal och en dublett visar kortet och en enda naturlig
   bekräftelsefråga, utan ett tredje modellanrop

Kör därefter `pnpm check`, `pnpm test`, lint för ändrade filer, produktionsbygge,
Supabase SQL-tester samt security- och performance-advisors mot samma utvecklingsmiljö som
fick migreringen.

## Dokumentation och leveransvillkor

- Uppdatera `docs/capabilities.md` i implementationen, inte när denna plan endast skrivs.
- Dokumentera att Trace varnar konservativt, att användaren alltid kan registrera ändå
  och att okänt datum eller bred semantisk likhet inte upptäcks i v1.
- Logga endast policyversion, ankartyp, tidsavstånd, beslut och varaktighet. Logga inte
  måltidsnamn, ingredienser eller den fullständiga proposal-payloaden i applikationsloggar.
- Ingen leverans är klar förrän migrering, appkod och end-to-end-verifiering har körts mot
  samma konfigurerade utvecklingsprojekt.

## Ej del av v1

- automatisk merge, update eller delete av den tidigare måltiden
- embeddings, fuzzy matching eller modellbedömd likhet
- subset/superset-matchning av items
- historisk backfill av möjliga dubletter
- dublettkontroll för måltider med okänt datum
- UI-knappar eller ett särskilt confirmation-kort
- tidsbaserad expiration av pending confirmations
- bakgrundsjobb för cleanup eller redigering av terminal payload
- ytterligare interaction-kinds för andra journaldomäner innan en andra konkret
  capability behöver samma beteende
- serverrenderade textmallar för bekräftelser eller discard-svar
- en generell dump av dagens eller gårdagens måltider i varje modellturn
- spekulativa `ResponsePlan`-/`ModelTurnPlan`-lager eller ett nytt generellt
  operation/outcome-ledger
