# Feedback på planen för bekräftelse av möjliga måltidsdubletter

Status: färdigbehandlad. Dokumentet strukturerar den externa feedbacken på
[`meal-duplicate-confirmation-plan.md`](meal-duplicate-confirmation-plan.md). Inget
förslag nedan är infört i huvudplanen innan det uttryckligen har accepterats.

## Samlad bedömning

Feedbacken bedömer planen som nära godkännbar och stödjer den låsta
`meal_duplicate_policy_v1`:

- teknisk replay och semantisk dublett hålls isär
- okända fält används inte som positivt eller negativt bevis
- ingen fuzzy matching, synonymmatchning, embeddings eller LLM-likhet införs
- ingen `Meal` skapas innan användaren bekräftar
- servern äger den validerade proposal-payloaden
- concurrency, replay, RLS och grants behandlas uttryckligt

Matchningspolicyn rekommenderas därför låsas oförändrad. Feedbackens invändningar gäller
främst bekräftelsens livscykel, provenance, replayidentitet och hur pending state förs in
i nästa användartur.

## Beslutsstatus

- **Stöds av feedbacken men är redan låst:** den konservativa och deterministiska
  matchningspolicyn.
- **Avvisat 2026-08-07:** serverrenderad confirmation-text. Servern returnerar ett
  strikt `confirmation_required`-resultat, men samma LLM-loop formulerar den naturliga
  frågan. Det ovanliga extra modellanropet accepteras för att undvika egen språk-, mall-
  och pluraliseringslogik.
- **Accepterat 2026-08-07:** den sparade assistantfrågan är replaykällan och genereras
  inte om vid teknisk replay.
- **Accepterat 2026-08-07:** använd `prepared → pending → confirmed | discarded`.
  `prepared` är dolt och `pending` betyder att assistantfrågan har sparats och kan
  besvaras. Frågan och övergången till `pending` committas atomiskt.
- **Avvisat 2026-08-07:** automatisk expiration efter 30 minuter. Confirmations är
  konversationsbundna och en sen bekräftelse kan fortfarande vara avsiktlig. Tidsbaserad
  expiration införs inte i v1.
- **Accepterat 2026-08-07:** ladda och frys verifierade `pending` confirmations i
  `ModelContext` före första Responses-anropet och hosted `tool_search`.
  `food_log.resolve_registration` är endast sökbart när sådan state finns.
- **Accepterat 2026-08-07:** pending-livscykeln generaliseras i en enda
  `pending_interactions`-tabell. Meddelanden är historik/presentation, interactionen
  äger protokollstate och domäntabellerna äger kanonisk data.
- **Accepterat 2026-08-07:** payloaden är strikt versionerad genom `kind`,
  `schema_version` och `policy_version`. Provenance går via befintliga operation-ID:n;
  inga domäntabeller får `source_interaction_id` och inget nytt generiskt ledger införs.
- **Färdigbehandlat 2026-08-07:** punkt 4 och dess fördjupade interaction-feedback är
  genomgångna och införda i huvudplanen.
- **Accepterat 2026-08-07:** punkt 5–7 är införda med provenance via interaction och
  operationer, ett eget immutable outcome per proposal-operation samt historiskt
  kandidatsnapshot utan domänspecifik FK.
- **Accepterat 2026-08-07:** punkt 8–10 är införda med kontraktsmässigt stöd för senare
  terminal payloadminimering, generellt `schema_version` i stället för
  `proposal_schema_version` och hårda SQL-constraints för state machine.
- **Accepterat 2026-08-07:** punkt 11–12 är införda med `candidate_count`, en primär
  kandidat, `different`-antal som deterministisk tie-breaker och aggregerad multisetdiff
  som behandlar saknad information neutralt.
- **Accepterat 2026-08-07:** punkt 13 är införd som ett explicit orchestrator-kontrakt:
  alla tool-resultat bevaras i stabil operationsordning, skapade records renderas och
  samma LLM-loop formulerar ett gemensamt svar när någon interaction väntar. Ingen ny
  generell `TurnOutcome`-abstraktion införs enbart för detta.
- **Avvisat 2026-08-07:** punkt 14:s tiominutersbegränsning. Identisk kanonisk
  datum-only-payload för samma `occurredOn` ger varning oavsett när registreringarna
  skapades. `createdAt` används endast för stabil kandidatrankning.
- **Färdigbehandlat 2026-08-07:** samtliga feedbackpunkter är beslutade och den aktiva
  målarkitekturen finns i huvudplanen.
- **Nästa genomgångspunkt:** punkt 14 nedan.

## 1. Serverrenderad bekräftelsefråga

Nuvarande plan fortsätter modellen efter `confirmation_required` för att formulera en
kort fråga. Feedbacken föreslår i stället:

```text
food_log.record
→ confirmation_required
→ servern bygger ett deterministiskt PendingInteraction-resultat
→ servern renderar frågan
→ inget ytterligare modellanrop för en ren registrering
```

Exempel:

```text
Du har redan registrerat gröt för igår.
Vill du registrera ytterligare en måltid?
```

Frågan kan fortfarande visas som ett vanligt assistantmeddelande. Under ytan blir den
strukturerad och serverägd. Även `discard` kan få ett deterministiskt svar, exempelvis
`Inte registrerat.`

Föreslagna vinster:

- lägre latency
- ingen risk att modellen påstår att måltiden redan registrerats
- identisk formulering vid replay
- frågan grundas i samma kanoniska summary
- pending-interaktion och assistantfråga kan committas tillsammans
- inga måltidsspecifika bekräftelseinstruktioner behövs i kärnprompten

Modellen behövs fortfarande i nästa tur för att tolka exempelvis `ja`, `nej`, `ja, men
ändra till idag` eller `bara den första`. Vid blandade meddelanden kan modellen svara på
en annan faktisk fråga, men confirmation-texten föreslås vara en serverägd slot i en
`ResponsePlan`.

Detta står mot huvudplanens nuvarande beslut om en LLM-formulerad naturlig respons och
behöver därför beslutas uttryckligen.

**Beslut 2026-08-07:** behåll LLM-formulerad confirmation-text. Servern äger
matchningsbeslutet och returnerar ett strikt resultat med `mealCreated: false` och
`requiredAction: ask_for_confirmation`. LLM:en äger endast formuleringen. Frågan sparas
och används oförändrad vid replay, så ett nytt modellanrop krävs inte för en redan
slutförd tur. Punktens förslag om serverrenderad text införs inte.

## 2. `prepared → pending` först vid turn-commit

Nuvarande plan kan skapa en pending-rad innan assistantfrågan har sparats. Feedbacken
pekar ut följande felväg:

```text
RPC skapar pending confirmation
→ modellcontinuation eller stream misslyckas
→ frågan sparas aldrig
→ nästa tur ser en confirmation som användaren aldrig har sett
```

Beslutad state machine:

```text
prepared → pending → confirmed | discarded
```

`food_log.record` producerar en `PreparedPendingInteraction`. `commit_turn` sparar
assistantfrågan, ändrar interaktionen till `pending` och skriver durable turn outcome
atomiskt. Endast `pending` projiceras till senare turns.

Samma princip ska gälla resolution: en skapad måltid får inte lämnas utan ett
återställbart kanoniskt turn outcome.

**Beslut 2026-08-07:** acceptera commit-barriären men använd termen `pending`, inte
`active`. Ta bort 30-minuters-expiration ur v1. Confirmationen förblir
konversationsbunden och besvarbar tills den bekräftas, avböjs eller ersätts av en
korrigerad registrering.

## 3. Pending state måste in före modellens tool-val

Ett svar kan bestå av endast `Ja`. Den aktiva bekräftelsen måste därför vara känd innan
första Responses-anropet och dess `tool_search`, inte upptäckas senare i
`prepareModelContext`.

Föreslaget flöde:

```text
begin_turn
→ ladda och frys PendingInteractions med status pending
→ skapa symboliska bindings
→ bygg ModelContext
→ exponera relevanta namespaces/tools
→ modell
```

Laddningen bör ingå i samma serverägda turn-snapshot, inte vara en fristående fetch.
`food_log.resolve_registration` bör endast vara sökbart när minst en relevant aktiv
meal-confirmation finns.

Feedbackens ord `router` ska i Trace förstås som modellens tool-val via hosted
`tool_search`; ingen heuristisk router föreslås.

**Beslut 2026-08-07:** acceptera ordningen men behåll Traces latencykontrakt. Auth,
ägarskap, historik och `pending` state verifieras och fryses först. Därefter startar
turn-persistens och första modellkörningen parallellt. Resolve-verktyget exponeras endast
om den frysta kontexten innehåller en relevant `pending` meal-confirmation.

## 4. Generalisera livscykeln, inte måltidspolicyn

En separat fördjupad feedbackomgång om denna punkt finns i
[`meal-duplicate-confirmation-interactions-feedback.md`](meal-duplicate-confirmation-interactions-feedback.md).
Den föreslår en enda generell interaction-tabell med versionerade domänpayloads och
operationer som provenancegräns. Genomgången är nu avslutad och besluten är införda i
huvudplanen.

Feedbacken håller med om att ingen generell domänpolicy för confirmations ska byggas.
Den menar däremot att själva arbetsflödesskalet redan är domänoberoende:

- `prepared`, `pending` och terminal resolution
- conversation-, proposal-turn- och resolution-turn-tillhörighet
- expiry, symbolic handle och idempotens
- projektion till nästa turn
- aktivering vid turn-commit

Föreslagen normaliserad modell:

```text
pending_interactions
├─ id, user_id, conversation_id, kind, status
├─ proposal_turn_id, activated_turn_id, resolution_turn_id
├─ created_at, resolved_at

meal_duplicate_confirmation_data
├─ pending_interaction_id
├─ policy_version, proposal_schema_version
├─ semantic_payload_hash, proposal
├─ primary_candidate_id, candidate_revision, candidate_snapshot
└─ match_details
```

Ett mindre alternativ är att behålla `meal_registration_confirmations` men låta den
implementera samma interna pending-livscykel och projiceras genom turnmekanismen.

Detta står i konflikt med huvudplanens nuvarande avgränsning mot generell
confirmation-infrastruktur och måste vägas mot projektets enkelhetsprincip.

**Beslut 2026-08-07:** generalisera endast protokollskalet genom
`pending_interactions`; måltidens policy, schema och resolution förblir lokala till
capabilityn. Den kompletterande feedbackfilen dokumenterar de låsta detaljerna.

## 5. Bevara både uppgifts- och auktorisationsprovenance

En måltid som skapas efter:

```text
TUR 1: Jag åt gröt igår
TUR 2: Ja
```

bör inte enbart peka på resolutionsturen. Feedbacken föreslår:

```text
reported_in_turn_id
→ turen där måltidsinnehållet uppgavs

authorized_in_turn_id
→ turen där registreringen godkändes

source_confirmation_id
→ interaktionen som band ihop dem
```

Kortet får fortfarande visas under bekräftelseturen. Provenance och presentation hålls
separata.

**Beslut 2026-08-07:** acceptera behovet men lägg inga nya provenancekolumner på
`meals`. `proposal_turn_id` bevarar var innehållet uppgavs, `resolution_turn_id` var det
godkändes och den gemensamma resolution-operationen binder interactionen till
måltidens `source_operation_id`.

## 6. Ett immutable operation outcome per source operation

En unik aktiv confirmation kan återanvändas av flera tekniska operationer med samma
proposal. Om bara confirmation-raden lagrar ett enda `proposal_operation_id` kan en
senare retry av en annan operation skapa en ny confirmation efter att den delade raden
har lösts.

Feedbacken föreslår ett smalt operation-resultat, exempelvis:

```text
meal_registration_operation_results
├─ user_id
├─ source_operation_id
├─ input_hash
├─ outcome_type       -- created | confirmation_required
├─ meal_id
├─ confirmation_id
└─ created_at
```

Varje operation replayar då sitt ursprungliga outcome även om flera outcomes pekar på
samma confirmation. Samma princip gäller resolutioner med serverhärlett
`resolution_operation_id`.

Feedbackens hänvisning till ett befintligt `TurnLedger` är inte etablerad i Trace v3.
Beslutet gäller därför om ett capability-specifikt operation-resultat behövs, inte om en
generell ledger ska införas.

**Beslut 2026-08-07:** varje proposal-operation får ett eget immutable outcome. En
interaction delas aldrig mellan olika `proposal_operation_id`; samma operation replayar
samma interaction och `proposal_input_hash` verifierar att inputen är identisk. Därmed
behövs varken cross-operation-deduplicering eller en separat operation-resultattabell.

## 7. Kandidatreferens med snapshot och `ON DELETE SET NULL`

`candidate_meal_id on delete cascade` kan radera pending eller historisk
confirmation-state när kandidaten raderas. Feedbacken föreslår:

```text
candidate_meal_id uuid null references meals(id) on delete set null
candidate_revision
candidate_snapshot
```

Snapshoten innehåller endast den begränsade struktur användaren fick frågan om, inte en
hel teknisk `Meal`-rad. Replay renderas från snapshoten så att senare redigering inte
förändrar en historisk fråga.

Föreslagen låst resolutionsemantik:

> Bekräftelsen godkänner att proposal-måltiden registreras även om kandidaten senare
> redigeras eller raderas.

**Beslut 2026-08-07:** acceptera ett begränsat, historiskt snapshot och den föreslagna
resolutionsemantiken. Lägg ingen måltidsspecifik kandidat-FK i den generella
interaction-tabellen. Resolutionen använder proposal-payloaden och är oberoende av den
levande kandidatens fortsatta existens.

## 8. Redigera bort känslig proposal-data efter resolution

Full `proposal`, `match_details` och candidate snapshot innehåller personlig
måltidsdata. Feedbacken föreslår att payloaden endast finns medan interaktionen är
öppen.

Vid `confirmed` eller `discarded` redigeras full proposal och snapshot bort.
Endast minimal metadata behålls:

- policy- och proposal-schemaversion
- semantisk hash
- ankartyp, tidsdifferens och candidate count
- beslut, varaktighet, operationsreferenser och timestamps
- `created_meal_id` för bekräftad registrering

Operation outcomes används för idempotent terminal replay och ska göra den fullständiga
proposal-payloaden onödig efter resolution.

**Beslut 2026-08-07:** acceptera minimeringsprincipen men implementera ingen automatisk
redigering i v1. Terminala läs-, replay- och historikflöden får inte kräva full payload,
så en senare retention-migrering kan minimera den utan att påverka kanonisk domändata.

## 9. Separat `proposal_schema_version`

`policy_version` beskriver hur kandidater matchas. En separat
`proposal_schema_version` behövs för hur den sparade proposal-JSON:en ska tolkas och
valideras efter en deploy.

```text
policy_version = 1
proposal_schema_version = 1
```

Resolutionen väljer exakt rätt valideringsschema innan den skapar måltiden.

**Beslut 2026-08-07:** acceptera separationen från `policy_version`, men använd det
generella namnet `schema_version`. Det versionerar hela den kind-specifika payloaden och
väljs tillsammans med `kind`; ingen separat `proposal_schema_version` införs.

## 10. Starkare state-constraints

Feedbacken föreslår en checkad statusmängd:

```text
prepared | pending | confirmed | discarded
```

Samt tillståndsberoende constraints:

- `prepared` och `pending`: inget `resolved_at`, `created_meal_id` eller
  `resolution_operation_id`
- `confirmed`: `resolved_at` och `resolution_operation_id` krävs
- `discarded`: `resolved_at` krävs och `created_meal_id` saknas

Constraints måste tåla att en senare skapad måltid raderas och dess FK sätts till null.
Statusen `superseded` föreslås som möjlig skillnad mellan en korrigering, exempelvis
`Nej, jag menade idag`, och ett rent avböjande. Den är inte nödvändig för kärnflödet och
behöver motiveras separat.

**Beslut 2026-08-07:** acceptera hårda, statusberoende SQL `CHECK`-constraints med
prompt-, aktiverings-, resolution- och reason-fält enligt huvudplanen. Tabellen har inget
`created_meal_id`. `superseded` införs inte; korrigering uttrycks som
`discarded + corrected_proposal`.

## 11. Synliggör att flera kandidater finns

Om flera måltider matchar bör frågan inte antyda att det bara finns en. Resultatet bör
innehålla:

```text
candidate_count
primary_candidate
```

V1 behöver inte spara snapshots för alla kandidater. Vid lika tidsavstånd föreslås
`färre strukturerade skillnader` som tie-breaker före `createdAt` och UUID.

**Beslut 2026-08-07:** acceptera `candidate_count` och snapshot endast för
`primary_candidate`. Vid lika ankare och tidsavstånd används minst antal
`different`-fält före `createdAt` och UUID; `unknown` räknas inte som skillnad.

## 12. Definiera diff för upprepade itemnamn

Multisetet kan innehålla flera items med samma normaliserade namn men olika mängd eller
ingredienser. Item-till-item-parning får inte lämnas åt SQL-plan eller ordning.

Rekommenderad v1-modell är aggregerade multisetskillnader per normaliserat itemnamn:

```text
itemName: kaffe
existingAmounts: [null, "2 dl"]
proposedAmounts: ["1 kopp", "2 dl"]
relation: different
```

Alternativet är att sortera varje grupp efter full kanonisk item-payload och para
positionsvis. En av modellerna måste låsas och SQL-testas.

**Beslut 2026-08-07:** använd aggregerade, sorterade multisets per normaliserat
itemnamn. Matcha uttryckligen kända värden exakt; en kvarvarande känd skillnad ger
`different`, saknad information utan uttrycklig skillnad ger `unknown`, annars
`match`. Itemparning får aldrig bero på rad- eller SQL-ordning.

## 13. Blandade turn outcomes

En tur kan samtidigt skapa en måltid och kräva bekräftelse för en annan:

```text
gröt  → confirmation_required
banan → created
```

Feedbacken föreslår:

```ts
type TurnOutcome = {
	journalRecords: JournalRecord[];
	pendingInteractions: PendingInteraction[];
};
```

Renderingen följer stabil operationsordning och får inte dölja en skapad post:

```text
Registrerat
[Banan-kort]

Du har redan registrerat gröt för igår.
Vill du registrera ytterligare en?
```

Flera pending proposals måste presenteras separat eller numrerat. Ett ensamt `ja` får
aldrig lösa flera.

**Beslut 2026-08-07:** acceptera beteendet men inte nödvändigtvis den föreslagna
top-level-typen. Orchestratorn behåller varje tool-resultat i stabil `operationIndex`-
ordning även när oberoende calls körs parallellt. Skapade records skickar sina vanliga
events, och om minst en interaction väntar får samma LLM-loop alla outcomes och skriver
ett gemensamt naturligt svar. Snabbsvaret `Registrerat` används endast när samtliga
registreringsoperationer skapade beständiga records.

## 14. Begränsa produktlöftet för datum-only-matchning

Två identiska datum-only-registreringar matchar i v1 endast när den tidigare skapades
inom tiominutersfönstret. Målexemplet bör därför uttryckligen säga att användaren
upprepar registreringen direkt, eller dokumentera denna begränsning.

**Beslut 2026-08-07:** avvisa begränsningen. Samma `occurredOn` och identisk kanonisk
payload utan verkligt klockslag är tillräckligt positivt ankare oavsett `createdAt`.
Registrering på måndag och en identisk registrering på tisdag för samma historiska
lördag ska därför varna. Varningen blockerar aldrig en legitim andra registrering.

## Beslutat slutflöde efter genomgången

### Tur 1

```text
begin_turn
→ verifierar auth och ägarskap
→ fryser interactions med status pending och skapar symboliska handles
→ exponerar resolve-capabilityn före hosted tool_search

modell
→ food_log.record

server
→ teknisk replay först
→ advisory lock
→ meal_duplicate_policy_v1
→ interaction skapas prepared, utan Meal

samma LLM-loop
→ formulerar en naturlig confirmation-fråga från strukturerat tool-resultat

commit_turn
→ sparar assistantfrågan
→ sätter prompt_message_id och activated_at
→ prepared blir pending atomiskt
```

### Tur 2: `Ja`

```text
begin_turn
→ projicerar pending interaction före tool_search
→ skapar verifierat symboliskt handle

modell
→ food_log.resolve_registration(pending_meal_1, register)

server-RPC
→ låser och verifierar interactionen
→ skapar Meal från serverlagrad proposal
→ Meal.source_operation_id = resolution-operationen
→ interaction.resolution_operation_id = samma operation
→ markerar interactionen confirmed atomiskt

orchestrator
→ skickar JournalRecord och MealCard
→ använder Registrerat för ett rent register-resultat
```

## Slutstatus

Alla tidigare öppna beslut är lösta. Huvudplanen är auktoritativ för implementationen;
detta dokument bevarar både den ursprungliga feedbacken och de uttryckliga besluten.
