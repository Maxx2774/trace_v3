# Minimal function output från `process_interaction_response`

Status: implementerad och verifierad.

Mätresultat och verifieringsutfall finns i
[`2026-08-08-process-interaction-response-output.md`](../../../architecture/performance/reports/2026-08-08-process-interaction-response-output.md).

Mätning och beslut för denna ändring följer dokumentrutten för mätt chatarbete i
[`performance/README.md`](../../../architecture/performance/README.md).

## Mål

Minska wire-payloaden och dynamiska continuation-input-tokens för
`process_interaction_response` utan att försvaga modellens kontext, serverns auktoritet,
idempotens eller recovery. Den direkta tokenvinsten ska sökas i nästa modellanrops input,
inte i det föregående modellanropets genererade output.

När användaren både bekräftar en väntande måltidsregistrering och uttrycker en ytterligare
avsikt ska den normala continuation-kedjan vara:

```text
tidigare modelInput med pending interaction-projektion
+ process_interaction_response-anrop
+ {"status":"registered"}
→ nästa modellsteg
```

Den fullständiga kanoniska måltiden ska inte skickas tillbaka till modellen en gång till.
Den ska fortsatt finnas server-side för journalposten, verifierade svarsdelar, UI och
recovery.

## Avgränsning

Planen ändrar endast den servergenererade function output som blir modellinput efter en
bekräftad registrering och låser de kontrakt som gör optimeringen säker.

Följande ingår inte:

- ingen ny databasrelation eller `meal_id` på `pending_interactions`
- inget generellt projection-framework
- ingen ny interaction-handler-registry
- inga förkortade tool-, fält- eller enum-namn
- ingen optimering av pending interaction-projektionen i samma ändring
- ingen ändring av `PendingInteractionBinding`

## Låsta ansvar och sanningar

Tre lager har olika ansvar:

```text
proposal
→ vad som skulle registreras

resolved interaction
→ vad användaren beslutade och vilken operation som genomfördes

canonical journal record
→ vad som faktiskt är registrerat
```

`PendingInteractionBinding` förblir en liten authority-mappning:

```ts
{
	(interactionRef, kind, interactionId);
}
```

Modellpresentation och domändata ska inte flyttas in i bindingen.

## Modellgräns

### Nuvarande registrerade resultat

```ts
modelOutput: {
	status: 'registered',
	meal: result.meal
}
```

### Planerat registrerat resultat

```ts
modelOutput: {
	status: 'registered';
}
```

Den kanoniska måltiden ska fortsatt användas i orkestreringen:

```ts
orchestration: {
	requiresAgentContinuation,
	verifiedResponseParts: [
		{ kind: 'text', text: 'Registrerat' },
		{ kind: 'journal_record', record }
	],
	responseRequirements: []
}
```

Endast `modelOutput` serialiseras som `function_call_output` till modellen.
`orchestration` stannar server-side.

## Varför den minimala outputen är säker

### Normal continuation

Vid `confirmed_with_additional_intent` behåller orkestratorn tidigare `modelInput` och
lägger till modellens function call och serverns function output. Pending
interaction-projektionen med `proposedMeal` finns därför kvar i det faktiska andra
provider-requestet.

Denna optimering bygger på följande explicita invariant:

> En lyckad bekräftelse bevarar proposalens modellrelevanta semantik. Servergenererade
> representationer och metadata får skilja sig, men registreringen får inte förändra
> den modellrelevanta användarsemantiken för måltidstyp, occurrence, items, mängder eller
> ingredienser.

Om registreringen i framtiden börjar förändra modellrelevant innehåll ska tool-outputen
exponera det relevanta deltat. Hela den kanoniska `Meal` ska inte återinföras automatiskt.

### Terminal bekräftelse

Vid `confirmed` krävs inget nytt modellsteg. Den kanoniska måltiden används direkt av
serverns verifierade svarsdelar och journalflöde. Ett fullständigt meal-objekt i
`modelOutput` ger därför inget värde.

### Recovery och retry

Recovery ska inte försöka rekonstruera samma providerhistorik som den normala
continuationen.

Efter att mutationen har committats gäller:

```text
begin_chat_turn
→ återhämtar kanoniska journalposter via source_turn_id

resolved interactions
→ visar vilka operationer som redan genomförts

operation-ID
→ DB-invariant för idempotens och entydighet
```

Interactionens `resolution_operation_id` och måltidens `source_operation_id` använder
samma operation-ID. Unika constraints per användare gör kopplingen entydig. Recovery
behöver därför ingen ny `meal_id`-kolumn och får aldrig leta efter en måltid genom
innehålls- eller tidslikhet.

Den resolved interaction-raden är authority för interaktionsutfallet. Den återhämtade
kanoniska journalposten är authority för det registrerade innehållet.

## Implementation

1. Ändra den registrerade grenen i
   `src/lib/server/chat/tools/process-interaction-response.ts` så att `modelOutput`
   innehåller exakt `{ status: 'registered' }`.
2. Behåll `result.meal` i den serverägda journalposten och `verifiedResponseParts`.
3. Ändra inte övriga statusutfall i samma slice.
4. Gör ingen migration. Befintliga operation-ID:n och constraints är tillräckliga.

## Tre kontraktsscenarier

### 1. Confirmation fidelity

SQL-kontraktet ska genomföra en verklig dublettbekräftelse och verifiera att
registreringen semantiskt motsvarar proposal för måltidstyp, occurrence, items, mängder
och ingredienser. Serverhärledda representationer och metadata får följa sina kanoniska
DB-regler. Konkreta DB-fält ska fortfarande jämföras exakt där respektive kontrakt kräver
det.

Testet ska särskilt verifiera:

- måltidstyp och occurrence motsvarar proposal enligt sina kanoniska DB-kontrakt
- items, mängder och ingredienser representerar samma användarsemantiska innehåll
- interactionen är `confirmed`
- `resolution_operation_id` är lika med måltidens `source_operation_id`
- exakt en ny måltid skapas av resolutionen
- replay av samma resolution skapar ingen ytterligare måltid

Runtime-kontraktet ska dessutom verifiera att den kanoniska `Meal` som returneras genom
serverlagret representerar samma användarsemantiska måltid som proposal-payloaden.

### 2. Normal continuation

Ett provider-kontraktstest ska köra:

```text
pending meal duplicate
+ "Ja, registrera den. Vad innehöll måltiden?"
→ confirmed_with_additional_intent
→ continuation
```

Testet ska inspektera det faktiska andra request-objektet som går in i den riktiga
provider-nätverksvägen och verifiera:

- det första `process_interaction_response`-anropet finns kvar
- function output är exakt `{"status":"registered"}`
- inget kanoniskt meal-objekt dupliceras i function output
- den ursprungliga, adresserade pending interaction-projektionen finns fortfarande i
  requestens modellinput
- projektionen innehåller den måltidssemantik som den återstående avsikten behöver
- en deterministiskt simulerad nästa provider-response kan slutföra den återstående
  avsikten från requestens bevarade kontext

Testet får inte nöja sig med att inspektera en intern array före den slutliga
provider-request-buildern. Det automatiserade provider-kontraktstestet får inte bero på
en verklig modells stokastiska beteende. Live-provider-evalen ansvarar separat för att
verifiera att den riktiga modellen kan använda samma kontext och slutföra avsikten.

### 3. Recovery efter commit

Recovery-scenariot ska placera felet efter commit-gränsen:

```text
meal skapad och interaction resolved
→ provider-, stream- eller turn-completion-fel
→ retry med samma turn
```

Testet ska verifiera:

- `begin_chat_turn` återhämtar den redan committed kanoniska journalposten
- interaction-state visar att resolutionen redan genomförts
- den redan committed kanoniska journalposten återhämtas och används som innehållssanning
- ingen andra måltid skapas
- interactionen muteras inte en andra gång
- recovery använder kanoniskt journalinnehåll, inte proposal som innehållssanning
- användarens återstående avsikt kan slutföras av recovery-finalizern

Detta är ett recovery-test, inte endast ett RPC-idempotency-test.

## Leveransverifiering

Verifieringen ska köras på det slutliga kodläget. Senare produktionskodändringar
invaliderar berörda resultat.

Kör hela den tillämpliga grinden enligt `AGENTS.md`:

- fokuserade tool-, orchestrator- och provider-request-tester
- full automatiserad testsvit
- SQL-kontrakt
- kumulativa kritiska journeys, inklusive permanent meal-duplicate-decline-regression
- `pnpm check`
- `pnpm lint`
- `pnpm build`

Eftersom den servergenererade function output som blir nästa modellanrops input ändras
ska en mutation-free live-provider-eval köras genom produktionsbyggaren. Minst
`confirmed_with_additional_intent` måste verifieras med exakt tool call, minimal function
output och ett korrekt svar på den återstående avsikten. Det realistiska livefallet får
använda frågan `"Ja, registrera den. Hur mycket protein innehöll måltiden?"`; dess
nutritionsbedömning ska inte vara det deterministiska provider-kontraktstestets
korrekthetsgrund. Live-evalen ska använda den verkliga produktionsbyggaren med ett
syntetiskt function-resultat och får inte utföra en riktig måltidsmutation. Det
automatiserade runtime-testet ansvarar separat för att bevisa att den riktiga handlern
producerar samma minimala output. Alla körda livefall och deras pass/fail-resultat ska
rapporteras separat.

## Mätning

Efter att korrektheten är låst ska den faktiska effekten mätas per end-to-end-turn.

Per modellanrop:

- input tokens
- cached input tokens
- uncached input tokens när de kan härledas
- output tokens som sekundärt mått, eftersom de inte är den direkta optimeringsytan
- reasoning tokens, när leverantören rapporterar dem
- tid till första tool-event
- modellens totala responstid

Per turn:

- antal modellanrop
- totala input tokens
- totala uncached input tokens
- totala output tokens
- tool execution time
- total svarstid
- semantisk korrekthet

Mätningen ska jämföra nuvarande fullständiga meal-output med den minimala status-outputen
på samma evalfall. Baseline för den fullständiga meal-outputen ska tas före
produktionskodändringen eller genom en kontrollerad benchmark-variant. Båda varianterna
ska använda samma modell, modellinställningar, request-builder, systemprompt, kontext och
evalfall; function output-payloaden ska vara den enda avsiktliga skillnaden. Latency ska
mätas över flera körningar eftersom den varierar mellan provider-anrop.

Den primära förväntade skillnaden är färre input- och uncached input-tokens i det andra
modellanropet samt färre totala input-tokens för turnen, inte färre genererade
output-tokens i det första anropet. En separat optimering av pending
interaction-projektionen får börja först efter att denna ändring har verifierats och
mätts.

## Klart när

Ändringen är klar när:

- `process_interaction_response` skickar endast `{"status":"registered"}` till modellen
  efter en lyckad måltidsregistrering
- canonical `Meal` fortsatt når journal, UI och recovery server-side
- alla tre kontraktsscenarier passerar
- den fulla tillämpliga leveransgrinden passerar eller eventuella befintliga, orelaterade
  fel rapporteras exakt
- relevant live-provider-eval passerar
- före-/eftermätning av tokens, modellsteg och latency är dokumenterad
