# Fördjupad feedback: generell state för väntande interaktioner

Status: färdigbehandlad. Detta dokument fördjupar punkt 4 i
[`meal-duplicate-confirmation-plan-feedback.md`](meal-duplicate-confirmation-plan-feedback.md)
och hör till
[`meal-duplicate-confirmation-plan.md`](meal-duplicate-confirmation-plan.md). Förslagen
är inte införda i huvudplanen om de inte uttryckligen markeras som beslutade nedan.

## Beslutsstatus

Följande accepterades och fördes in i huvudplanen 2026-08-07:

1. `prompt_message_id` är nullable i `prepared`, och interactionen blir `pending`
   först när assistantmeddelandet committas och länkas atomiskt.
2. JSONB-payloaden är ett strikt versionerat kontrakt med separata `kind`,
   `schema_version` och `policy_version`.
3. Provenance går genom befintliga proposal- och resolution-operationer. Inga
   domäntabeller får `source_interaction_id`, och inget nytt generiskt operation-ledger
   införs i denna slice.
4. Tabellidentiteten används med obligatoriskt `proposal_input_hash`, utan
   `expires_at` i v1 och med `activated_at` som tidpunkten då frågan blev besvarbar.
5. `kind` är en stabil semantisk maskinidentitet; första värdet är
   `meal_duplicate`.
6. Flera interactions får dela assistantmeddelande. `ModelContext` innehåller en lista
   med separata symboliska handles, byggd direkt från verifierade `pending`-rader utan
   en beständig generell `ConversationProjection`.
7. Tabellen behåller namnet `pending_interactions`; namnet beskriver objekttypen och
   dess ursprung, inte att varje historisk rad alltid har status `pending`.
8. Den versionerade payloaden är protokoll-authority. `messages.content` är endast
   renderad historik och presentation.
9. Arkitekturen får inte kräva full payload för alltid efter resolution. V1 behåller
   den, men bygger ingen automatisk terminal redigering och låter inte terminala
   läsflöden bero på den.

Det rekommenderade slutflödet är accepterat med v3:s konkreta
`source_operation_id`-kedja. Slutprincip 1–6 är uttryckligen låsta: immutable messages,
generell interaction-state, strikt versionerad domän-JSONB, `kind` som semantisk
kontraktsnyckel, atomisk `prepared → pending` och operationer som provenancegräns.
Slutprincip 7–8 är också låsta: modellen får endast symboliska handles och separata
workflow-tabeller per domän byggs inte. Hela fördjupningen är därmed genomgången.

**Tilläggsbeslut 2026-08-07:** om nästa användarmeddelande tydligt går vidare till ett
orelaterat ämne ska LLM:en explicit lösa den gamla interactionen som `discarded` med
`resolution_reason = 'conversation_moved_on'`. Servern använder ingen
relevansheuristik. `user_declined` och `corrected_proposal` är separata discard-skäl,
medan en faktisk följdfråga om interactionen lämnar den `pending`.

## Samlad bedömning

Feedbacken rekommenderar att ersätta den måltidsspecifika tabellen
`meal_registration_confirmations` med en generell interaction-modell. Den centrala
uppdelningen är:

```text
messages
= immutable historik och presentation

pending_interactions
= föränderlig protokollstate

meals / weights / symptoms
= kanonisk domändata
```

Detta ska ge en gemensam mekanism för väntande människa-i-loopen-state utan separata
workflow-tabeller för varje domän. Domänsemantiken förblir lokal genom `kind`, ett
versionerat JSONB-schema och respektive capabilitys validering.

## 1. `prompt_message_id` måste vara nullable

Interaktionen uppstår innan assistantmeddelandet har committats. Tabellen måste därför
stödja:

```text
prompt_message_id uuid null
```

Föreslaget flöde:

```text
prepared
→ assistantmeddelandet skapas
→ prompt_message_id sätts
→ pending
```

Övergången `prepared → pending` och sättningen av `prompt_message_id` ska ske atomiskt i
samma commit som assistantmeddelandet. `prepared` får aldrig projiceras till nästa
modellturn; endast `pending` är något användaren kan besvara.

Feedbacktexten nämner även `expired` och `superseded` som möjliga terminalstatusar. Den
nuvarande genomgången har redan avvisat tidsbaserad expiration i v1. Detta dokument
återöppnar inte det beslutet automatiskt; `superseded` behöver fortfarande bedömas
separat.

**Beslut:** accepterat. `prepared` projiceras aldrig till modellen. Övergången,
meddelandereferensen och aktiveringstidpunkten committas atomiskt.

## 2. JSONB som versionerat kontrakt

JSONB bedöms lämpligt för den domänspecifika payloaden om tre identiteter hålls
separata:

```text
kind = meal_duplicate
schema_version = 1
policy_version = 1
```

- `kind` avgör interactionens semantik och vilket schema som gäller.
- `schema_version` avgör hur payloaden ska avkodas och runtime-valideras.
- `policy_version` beskriver varför interactionen skapades, exempelvis vilken
  dublettpolicy som träffade.

Exempel på payload:

```json
{
	"proposedMeal": {},
	"existingMealSnapshot": {},
	"matchDetails": {}
}
```

TypeScript ska använda en sluten, diskriminerad union:

```ts
type PendingInteraction = MealDuplicateInteractionV1 | FutureInteraction;
```

Servern väljer strikt runtime-schema från `kind + schemaVersion`. JSONB är endast
lagringsformatet och får inte bli en öppen behållare för godtycklig metadata.

**Beslut:** accepterat. Första kontraktet är `kind = 'meal_duplicate'`,
`schema_version = 1` och `policy_version = 1`.

## 3. Operationer, inte domänrader, bör bära provenance

Feedbacken avråder från att lägga följande kolumn på varje framtida domäntabell:

```text
meals.source_interaction_id
weights.source_interaction_id
symptoms.source_interaction_id
```

Föreslagen kedja är i stället:

```text
proposal operation
→ PendingInteraction
→ resolution operation
→ canonical outcome
→ Meal / Weight / Symptom
```

`pending_interactions` lagrar:

```text
proposal_operation_id
resolution_operation_id
```

Resolution-operationens kanoniska outcome pekar på den skapade eller ändrade
domänposten. Då kan en interaction skapa noll, en eller flera records, uppdatera en post
eller påverka flera domäner utan att interaction-konceptet läcker in i samtliga
domänscheman.

Feedbackens hänvisning till `TurnLedger` eller ett generellt operation-outcome-lager är
inte ett etablerat kontrakt i Trace v3. Innan detta accepteras måste det därför visas hur
relationen representeras med den befintliga `turn_id + source_operation_id`-modellen,
eller motiveras som en konkret ny capability.

**Beslut:** accepterat med v3:s befintliga operationsmodell. Interactionen lagrar
proposal-/resolution-operationerna och måltiden använder befintligt
`source_operation_id`. Ett nytt generiskt TurnLedger byggs inte i denna slice.

## 4. Föreslagen tabellidentitet

Feedbacken landar ungefär i:

```text
pending_interactions
id uuid primary key
user_id uuid not null
conversation_id uuid not null
kind text not null
status text not null
schema_version smallint not null
policy_version smallint null
proposal_turn_id uuid not null
proposal_operation_id text not null
prompt_message_id uuid null
resolution_turn_id uuid null
resolution_operation_id text null
payload jsonb not null
created_at timestamptz not null
activated_at timestamptz null
resolved_at timestamptz null
```

`input_hash` föreslås som en möjlig ytterligare identitet för generisk idempotens eller
deduplicering. Hela operation-replaysystemet bör däremot inte byggas in i
interaction-tabellen; det tillhör operationens eget outcome-kontrakt.

Den tidigare föreslagna `expires_at` är utelämnad här eftersom tidsbaserad expiration
redan har avgränsats från v1.

**Beslut:** accepterat med `proposal_input_hash` som obligatoriskt fält.
`activated_at` behålls, `expires_at` utelämnas och ownership samt lifecycle låses med
databasconstraints. Interactionen innehåller inget eget resultatrecord-ID.

## 5. `kind` är en stabil maskinidentitet

`kind` ska beskriva den faktiska semantiken, inte bara säga att något är en generell
confirmation.

Bra exempel:

```text
meal_duplicate
meal_destructive_change
meal_ambiguous_correction
symptom_duplicate
```

Undvik ett alltför brett `meal_confirmation` som senare kräver ett andra subtype-fält i
JSONB. Principen är:

```text
kind
→ protokollets semantik

payload
→ versionerad domändata för semantiken
```

**Beslut:** accepterat. `meal_duplicate` är den första stabila maskinidentiteten. Nya
värden läggs endast till tillsammans med en konkret capability och dess validerade
kontrakt.

## 6. Flera interactions per assistantmeddelande

Ett assistantmeddelande kan presentera flera väntande beslut:

```text
Jag registrerade bananen.
Gröten liknar en tidigare registrering.
Kaffet liknar också en tidigare registrering.
```

Datamodellen måste därför tillåta:

```text
message_42
← pending_1
← pending_2
```

Nästa modellturn får separata symboliska handles:

```text
pending_meal_1
pending_meal_2
```

Inte ett ensamt `activePendingInteraction`. En eventuell konversationsprojektion måste
kunna representera en lista av interaction-ID:n. Trace har dock ännu inte accepterat en
beständig generell `ConversationProjection`; samma behov kan initialt byggas direkt från
de verifierade `pending`-raderna i `ModelContext`.

Det behöver beslutas om v1 stödjer flera samtidiga pending interactions eller medvetet
begränsar sig till en.

**Beslut:** v1 stödjer flera. Flera rader får dela `prompt_message_id`, och
`ModelContext` projicerar `pendingInteractions` med ett separat symboliskt handle per
rad. Otydliga svar förtydligas av modellen utan textheuristik. Ingen beständig generell
`ConversationProjection` införs.

## 7. Tabellnamnet

Namnet `pending_interactions` blir semantiskt något skevt när tabellen även innehåller
terminala rader som `confirmed` och `discarded`.

Alternativ:

```text
conversation_interactions
interaction_protocols
pending_interactions
```

Argumentet för `pending_interactions` är att `PendingInteraction` redan är
arkitekturbegreppet och kan beskriva objekttypen snarare än radens nuvarande status.
Feedbacken betraktar detta främst som nomenklatur, inte ett arkitekturbeslut.

**Beslut:** behåll `pending_interactions`. Alternativen är antingen för breda eller mer
abstrakta, medan det valda namnet tydligt knyter tabellen till den redan etablerade
pending-mekanismen.

## 8. Payloaden är protokoll-authority

Assistantmeddelandet innehåller den naturliga, historiska presentationen:

```text
Du har redan registrerat gröt igår. Vill du registrera en till?
```

Det får inte vara authority för vad användaren egentligen ombads besluta om. Den
versionerade payloaden måste innehålla tillräcklig strukturerad information:

```json
{
	"proposedMeal": {},
	"candidate": {},
	"match": {}
}
```

Separationen är:

```text
pending_interactions.payload
= protokoll-authority

messages.content
= renderad historisk presentation
```

Resolutionen använder den serverlagrade och runtime-validerade payloaden, aldrig fri
assistanttext eller en ny modellrekonstruktion.

**Beslut:** accepterat. Payloaden är protokoll-authority och meddelandet är endast
LLM-formulerad historik/presentation.

## 9. Terminal payload ska kunna redigeras bort

Efter `pending → confirmed` eller `pending → discarded` behöver full
`proposedMeal`, candidate snapshot, ingredienser och mängder inte nödvändigtvis ligga kvar
i workflow-tabellen.

Minimal terminal metadata kan exempelvis vara:

```json
{
	"policyVersion": 1,
	"anchor": "time",
	"timeDifferenceMinutes": 12,
	"decision": "register"
}
```

Operation outcome och den skapade eller ändrade domänposten utgör den permanenta
journalhistoriken. Feedbacken bedömer inte terminal redigering som den första
MVP-optimeringen, men rekommenderar att kontraktet inte förutsätter att full personlig
payload lagras för evigt.

**Beslut:** acceptera principen men inte en cleanup-mekanism i v1. Full payload behålls
initialt. Terminala läs-, replay- och historikflöden får däremot inte förlita sig på den,
så att en senare retention-migrering kan minimera den utan att påverka kanonisk
domändata.

## Rekommenderat slutflöde

```text
Turn A
→ food_log.record
→ meal_duplicate_policy_v1 träffar
→ Interaction P skapas prepared

commit Turn A
→ assistant message M skapas
→ P.prompt_message_id = M
→ P.status = pending

Turn B: "Ja"
→ ModelContext innehåller ett symboliskt handle för P
→ resolve P
→ resolution operation O skapar Meal X
→ P.resolution_operation_id = O
→ P.status = confirmed
```

Föreslagen provenancekedja:

```text
Meal X.source_operation_id = Operation O
← Interaction P.resolution_operation_id = Operation O
← P skapades av proposal Operation A
```

## Principer feedbacken vill låsa

- `messages` förblir immutable historik och presentation.
- En generell interaction-tabell äger föränderlig protokollstate.
- Domänspecifika payloads lagras som strikt versionerad JSONB.
- `kind` avgör vilket runtime-schema och vilken protokollsemantik som gäller.
- `prepared → pending` sker atomiskt med det committade assistantmeddelandet.
- Operationer, inte varje domänrad, binder interactionen till slutresultatet.
- Modellen får endast symboliska handles.
- Separata workflow-tabeller per domän byggs inte.

**Beslutade slutprinciper 1–3:** `messages` förblir immutable historik och
presentation, `pending_interactions` äger den föränderliga protokollstaten och varje
domänpayload avkodas som ett strikt versionerat JSONB-kontrakt. Dessa är införda i
huvudplanen.

**Beslutade slutprinciper 4–6:** `kind` väljer både runtime-schema och lokal
protokollsemantik, `prepared → pending` committas atomiskt med assistantmeddelandet och
befintliga proposal-/resolution-operationer binder interactionen till slutresultatet
utan `source_interaction_id` eller ett nytt generiskt operation-ledger.

**Beslutade slutprinciper 7–8:** modellen får endast tur-lokala symboliska handles som
servern mappar och verifierar mot interna ID:n. Alla domäner delar
`pending_interactions` för protokollstate men behåller schema, policy och resolver i
respektive capability; inga separata workflow-tabeller byggs per domän.

## Tidigare öppna beslut

Samtliga tidigare öppna frågor i detta dokument är nu lösta:

- Tabellen heter `pending_interactions`.
- V1 stödjer flera samtidiga interactions.
- Provenance använder befintliga operation-ID:n utan ett generiskt `TurnLedger`.
- `superseded` införs inte; `discarded` får en strukturerad resolution reason.
- V1 behåller full terminal payload men kontraktet tillåter senare minimering.
- Den generella tabellens common columns är uttryckligen avgränsade i huvudplanen.
