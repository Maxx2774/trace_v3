# Feedback på planen för strukturerade måltidstillfällen

Status: dokumenterad för bedömning. Punkterna i detta dokument ändrar inte
`structured-meal-card-plan.md` förrän de uttryckligen accepteras och förs in där.

Källa: extern feedback mottagen 2026-08-06.

## Beslutsstatus

- Punkt 1, explicit `revision` samt `clientMutationId` med idempotent replay: accepterad
  och införd i huvudplanen 2026-08-06.
- Punkt 2, discriminated occurrence, serverhärlett lokalt datum, bevarade ungefärliga
  tidsuttryck och occurrence-redigering: accepterad och införd i huvudplanen 2026-08-06.
- Punkt 3, diff/upsert-semantik för full replace, stabila ID:n och uppskjutna
  positionsvillkor: accepterad och införd i huvudplanen 2026-08-06.
- Punkt 4, ett kompatibelt write-protokoll: delvis accepterad och införd i huvudplanen
  2026-08-06. Den avgränsade `meal_update_receipts`-tabellen använder gemensamma
  protokollfält för säkra retryer. Generell operationslogg, snapshots, recovery och undo
  skjuts upp tills en konkret capability kräver dem.
- Punkt 5, beständig chatthistorik som referens och serverhydrering från den kanoniska
  måltidsposten: accepterad och införd i huvudplanen 2026-08-06.
- Punkt 6: preflight och förlustkontroller accepterade och införda 2026-08-06.
  Expand/switch/contract, dual-write och övergångskod avvisas eftersom appen inte är
  driftsatt; planen använder ett sammanhållet lokalt byte.
- Punkt 7, praktiska gränser på 20 items, 30 ingredienser per item, 100 ingredienser
  totalt och 32 KiB mutationspayload: accepterad och införd i huvudplanen 2026-08-06.
- Punkt 8, kontextuell semantik för items och uttryckligen angivna ingredienser samt
  förlustfri `amountText`: accepterad och införd i huvudplanen 2026-08-06.
- Punkt 9: fokusmodell, listbox-ARIA och typeahead accepterade och införda 2026-08-06.
  Förslaget att låta användaren återställa en bekräftad måltidstyp till `null` avvisas;
  `null` är endast systemets ännu inte klassificerade tillstånd.
- Punkt 10, separat lugnt läsläge och explicit redigeringsläge med användarnära texter och
  säkra åtgärder: accepterad och införd i huvudplanen 2026-08-06.
- Punkt 11, deterministisk ren registrering och fortsatt dold startsidesöversikt:
  accepterad och införd i huvudplanen 2026-08-06. Titelgenerering använder uteslutande
  användarens första meddelande som ren text, aldrig JSON, verktygsdata eller assistanttext.

## Samlad bedömning

Feedbacken bedömer planen som mycket stark i grunden och rekommenderar att följande
domänmodell låses:

```text
Meal
└─ MealItem
   └─ MealIngredient
```

`amount_text` bedöms vara rätt val eftersom användarens uttryck bevaras utan att systemet
låtsas ha numerisk precision som inte finns. Planens separation mellan registrerade
uppgifter och inferens lyfts också fram som central.

Rekommendationen är ändå att inte implementera planen exakt som den står. De viktigaste
invändningarna gäller versionering, retry, replay och migreringsstrategi snarare än själva
domänmodellen.

## Delar som feedbacken vill behålla

- Ett `Meal` representerar ett konsumtionstillfälle.
- Måltidstyp och occurrence tillhör `Meal`.
- Maträtter, livsmedel och drycker är `MealItem`.
- Ingredienser tillhör exakt ett item.
- `amount_text` bevaras som fri text.
- Historiska meals slås inte ihop.
- Ett item får ha noll registrerade ingredienser.
- En full nested update är bättre än sex små CRUD-RPC:er för nuvarande UI.
- Stabil identitet ska vara UUID, inte arrayposition.
- UI-redigering ska vara deterministisk och inte gå genom LLM.
- `capabilities.md` ska uppdateras först när beteendet är verifierat.

## 1. Använd en explicit revision

Feedbackens viktigaste föreslagna ändring är att ersätta `expectedUpdatedAt` som
concurrency-token med:

```text
revision integer not null default 1
```

Varje lyckad mutation ska öka revisionen exakt en gång.

Föreslaget update-kontrakt:

```ts
type UpdateMealInput = {
	id: string;
	expectedRevision: number;
	clientMutationId: string;
	mealType: MealType | null;
	occurrence: MealOccurrenceInput;
	items: MealItemMutationInput[];
};
```

Föreslaget resultat:

```ts
type Meal = {
	id: string;
	revision: number;
	mealType: MealType | null;
	occurrence: MealOccurrence;
	items: MealItem[];
	createdAt: string;
	updatedAt: string;
};
```

### Idempotent retry för UI-mutationer

`expectedRevision` löser samtidiga ändringar men inte ett förlorat svar efter en lyckad
commit. Feedbacken föreslår därför även `clientMutationId`, input-hash och replay:

```text
Samma clientMutationId + samma payload
→ returnera tidigare kanoniskt resultat

Samma clientMutationId + annan payload
→ idempotenskonflikt

Ny clientMutationId + gammal revision
→ versionskonflikt
```

Förslaget är att concurrency och retry behandlas som två separata problem och att båda
löses uttryckligen.

## 2. Gör occurrence typat och redigerbart

Feedbacken invänder mot att kortet visar datum och tid utan att update-kontraktet kan
korrigera dem. Förslaget är att occurrence ingår i samma atomiska update och uttrycks som
en discriminated union:

```ts
type MealOccurrence =
	| {
			precision: 'exact' | 'approximate';
			occurredAt: string;
			occurredOn: string;
			timezone: string;
			timeExpression: string | null;
	  }
	| {
			precision: 'date';
			occurredAt: null;
			occurredOn: string;
			timezone: string;
			timeExpression: string | null;
	  }
	| {
			precision: 'unknown';
			occurredAt: null;
			occurredOn: null;
			timezone: null;
			timeExpression: null;
	  };
```

För `exact` och `approximate` bör servern härleda `occurred_on` från `occurred_at` och
`timezone` i stället för att acceptera alla tre som oberoende skrivbara värden.

### Ungefärliga tidsuttryck

Planens generella presentation **cirka 08:30** bedöms vara för bred. Ett uttryck som
**imorse** får inte bli ett påhittat klockslag. Feedbacken föreslår att bevarade uttryck
visas när de är den faktiska precisionen:

```text
Jag åt ägg imorse
→ Idag, i morse
→ inte Idag, cirka 08:30
```

Samma princip gäller exempelvis **igår kväll**, **i natt** och **på eftermiddagen**.

## 3. Lås diff/upsert-semantiken för full replace

En full nested update stöds, men den får enligt feedbacken inte implementeras som:

```text
delete alla items
insert alla items igen
```

Det skulle göra stabila UUID:n och `created_at` meningslösa. Föreslagen transaktionell
semantik:

1. Uppdatera befintliga objekt som fortfarande finns.
2. Skapa nya objekt.
3. Radera objekt som saknas i payloaden.
4. Härled och uppdatera ordningen från arrayerna.
5. Öka måltidens revision exakt en gång.
6. Returnera hela den kanoniska posten.

Nya objekt bör sakna ID i inputen och få servergenererade UUID:n:

```ts
type MealItemMutationInput = {
	id: string | null;
	name: string;
	amountText: string | null;
	ingredients: Array<{
		id: string | null;
		name: string;
		amountText: string | null;
	}>;
};
```

Servern ska verifiera att:

- befintligt item-ID tillhör den aktuella måltiden;
- befintligt ingredient-ID tillhör det angivna itemet;
- inga ID:n förekommer flera gånger;
- objekt från annan användare eller måltid aldrig kan adopteras;
- en befintlig ingrediens inte tyst kan flyttas till ett annat item.

Flytt av en ingrediens mellan items representeras tills vidare som radering under den
gamla föräldern och skapande under den nya, med ett nytt ingredient-ID.

### Positioner

Positioner ska härledas från arrayordningen och inte skickas av klienten. Feedbacken
föreslår deferrable uniqueness för att tillåta omsortering utan tillfälliga kollisioner:

```sql
constraint meal_items_meal_position_unique
	unique (meal_id, position)
	deferrable initially deferred
```

Samma princip föreslås för ingredienser.

## 4. Använd ett gemensamt operationsprotokoll för journalwrites

Feedbacken avråder från en separat mutationsekonomi för måltidskortet. Den föreslår att
UI-mutationer följer samma grundprinciper som andra journalwrites:

```text
actor
source
clientMutationId
inputHash
expectedRevision
canonical outcome
```

Exempel:

```text
actor = authenticated_user
source = meal_card
```

Minst följande föreslås sparas atomiskt med uppdateringen:

```text
clientMutationId
recordId
previousRevision
newRevision
inputHash
result
source
createdAt
```

Feedbacken efterfrågar också en tydlig framtida väg till recovery och undo, exempelvis
föregående snapshot, invers operation eller ett revisionslager. Full event sourcing krävs
inte i denna iteration, men den föregående strukturen bör enligt feedbacken inte skrivas
över utan ett medvetet beslut om återställning.

## 5. Chatthistoriken ska vara referens, inte authority

Stream-eventet får innehålla hela måltiden för omedelbar rendering, men en beständig
meddelandeblobb ska inte vara den auktoritativa kopian av en muterbar måltid.

Föreslagen referens:

```ts
type JournalRecordReference = {
	type: 'meal';
	recordId: string;
	committedRevision: number;
};
```

Det omedelbara eventet kan innehålla både referens och record:

```ts
{
	reference: {
		type: 'meal',
		recordId: meal.id,
		committedRevision: meal.revision
	},
	record: meal
}
```

Vid reload ska serverns read projection hämta aktuell kanonisk måltid via `recordId`.
Historiken är därmed en immutable referens och ett historiskt outcome, medan meal-tabellerna
är current authority.

## 6. Använd expand, switch och contract

Feedbacken bedömer en enda destruktiv migration som driftmässigt riskabel eftersom
databasmigration och applikationsdeploy inte sker atomiskt tillsammans.

### Fas 1: Expand

- Lägg till `meal_type` och `revision`.
- Skapa `meal_items` och `meal_item_ingredients`.
- Backfilla.
- Lägg till nya RPC:er och read projections.
- Behåll gamla `description` och den gamla ingrediensrelationen.

### Fas 2: Switch

- Stoppa nya meal-writes kort under deploy i den privata MVP:n.
- Deploya appkoden som använder den nya modellen.
- Kör verifiering och autentiserad E2E.
- Öppna writes igen.

En publik tjänst skulle i stället behöva kompatibilitet eller dual-write under
övergången.

### Fas 3: Contract

I en senare migration:

- ta bort gamla RPC:er;
- ta bort `description`;
- ta bort gamla `meal_ingredients`;
- ta bort övergångskod.

### Preflight före backfill

Innan migreringen ska följande kontrolleras:

- tomma descriptions;
- ledande eller avslutande whitespace;
- descriptions längre än det nya maxvärdet;
- `reported_text` längre än det nya maxvärdet;
- om befintlig ingrediensordning verkligen är sparad.

När gammal position saknas föreslås en deterministisk fallback, exempelvis `created_at`
och `id`, utan att beskriva fallbacken som bevarad originalordning.

## 7. Minska praktiska payloadgränser

Planens 50 items med 50 ingredienser vardera tillåter 2 500 ingrediensrader per meal.
Feedbacken föreslår i stället:

```text
1–20 items
0–30 ingredienser per item
högst 100 ingredienser totalt per meal
högst 32 KB serialiserad mutationspayload
```

Databasens tekniska positionsintervall kan vara större, men tool- och mutationskontrakten
bör ha de praktiska gränserna ovan.

## 8. Lås semantiken för item och ingrediens

Feedbacken föreslår följande regel i food-capabilityns egna instruktioner, inte i
kärnprompten:

```text
MealItem
= en separat rätt, mat, dryck eller sida

MealIngredient
= en uttryckligen beskriven beståndsdel i ett namngivet item
```

Exempel:

```text
Äggröra med 4 ägg och smör
→ Item: Äggröra
  Ingredients: 4 ägg, smör

Biff med pommes och bearnaisesås
→ Items: Biff, Pommes, Bearnaisesås

Kaffe med mjölk
→ Item: Kaffe
  Ingredient: mjölk

Köttpaj med crème fraîche bredvid
→ Items: Köttpaj, Crème fraîche
```

Ordet **med** innebär alltså inte automatiskt en ingrediensrelation.

### `amountText`

Föreslagna exempel:

```text
4 ägg
→ name: Ägg
→ amountText: 4

500 g köttfärs
→ name: Köttfärs
→ amountText: 500 g

2–3 skivor ost
→ name: Ost
→ amountText: 2–3 skivor

lite smör
→ name: Smör
→ amountText: lite
```

När uppdelningen är osäker ska hela uttrycket bevaras i `name` och `amountText` sättas
till `null`.

## 9. Förtydliga Select-kontraktet

### Möjlighet att återställa `null`

Efter att en typ har valts behöver användaren kunna återgå till saknad typ:

```ts
type SelectProps<T extends string> = {
	value: T | null;
	options: SelectOption<T>[];
	placeholder: string;
	nullOptionLabel?: string;
	label: string;
	disabled?: boolean;
	onValueChange: (value: T | null) => void;
};
```

För meal type föreslås `nullOptionLabel: "Ingen måltidstyp"`. Detta är en UI-handling
som sätter värdet till `null`, inte ett sjätte `MealType`-värde.

### Konsekvent fokusmodell

Om `aria-activedescendant` används ska DOM-fokus stanna på combobox-triggern medan
listboxen är öppen:

```text
DOM-fokus stannar på comboboxen
aria-activedescendant pekar på aktiv option
Arrow keys ändrar aktiv option
Enter/Space väljer
Escape stänger
```

Lägg även till `aria-haspopup="listbox"` och typeahead med bokstavstangenter.

## 10. Separera läsläge och redigeringsläge

Feedbacken avråder från att alltid visa select-chrome, pennor, kryss och inputs eftersom
kvittot då blir ett formulär igen.

Föreslaget beteende:

```text
Standardläge
→ lugnt, läsbart kort
→ måltidstyp visas som text
→ ett Redigera-val

Redigeringsläge
→ måltidstyp blir Select
→ item- och ingrediensåtgärder visas
→ Lägg till mat eller dryck
→ Lägg till ingrediens
```

UI-texten bör vara **Lägg till mat eller dryck**, inte den tekniska termen
**Lägg till måltidsdel**. Små ikonknappar behöver tillräcklig touchyta och tillgängliga
labels.

Om sista itemet inte får tas bort ska raderingsknappen döljas eller vara disabled med en
förklaring, i stället för att först ge ett domänfel efter klick.

## 11. Gör angränsande produktbeslut explicita

### Naturligt LLM-svar efter registrering

Feedbacken efterfrågar ett explicit kontrakt:

```text
Ren lyckad food_log.record-turn
→ deterministisk status Registrerat
→ kanoniskt MealCard
→ inget naturligt assistantsvar genereras eller sparas

Registrering kombinerad med en fråga
→ MealCard
→ ett naturligt svar på frågan får följa
```

Titelgenerering ska triggas från första committade turn och inte vara beroende av att
turnen innehåller assistant-prosa.

### Startsidesöversikt

Feedbacken vill hålla beslutet om startsidans måltidsöversikt utanför denna capability,
eftersom det är ett separat informationsarkitekturbeslut.

## Rekommenderat slutkontrakt från feedbacken

```ts
type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';

type MealOccurrence =
	| {
			precision: 'exact' | 'approximate';
			occurredAt: string;
			occurredOn: string;
			timezone: string;
			timeExpression: string | null;
	  }
	| {
			precision: 'date';
			occurredAt: null;
			occurredOn: string;
			timezone: string;
			timeExpression: string | null;
	  }
	| {
			precision: 'unknown';
			occurredAt: null;
			occurredOn: null;
			timezone: null;
			timeExpression: null;
	  };

type MealIngredient = {
	id: string;
	name: string;
	amountText: string | null;
};

type MealItem = {
	id: string;
	name: string;
	amountText: string | null;
	ingredients: MealIngredient[];
};

type Meal = {
	id: string;
	revision: number;
	mealType: MealType | null;
	occurrence: MealOccurrence;
	items: MealItem[];
	createdAt: string;
	updatedAt: string;
};

type MealItemMutationInput = {
	id: string | null;
	name: string;
	amountText: string | null;
	ingredients: Array<{
		id: string | null;
		name: string;
		amountText: string | null;
	}>;
};

type UpdateMealInput = {
	id: string;
	expectedRevision: number;
	clientMutationId: string;
	mealType: MealType | null;
	occurrence: MealOccurrence;
	items: MealItemMutationInput[];
};
```

## Feedbackens prioriterade ändringar

1. Ersätt `updatedAt` som concurrency-token med explicit `revision`.
2. Lägg till `clientMutationId` och idempotent replay för updates.
3. Gör occurrence typat och redigerbart.
4. Definiera diff/upsert-semantik för nested replace.
5. Gör chatthistoriken till referens, inte authority.
6. Dela migreringen i expand, switch och contract.
7. Minska payloadgränserna.
8. Lägg till null-reset, typeahead och en konsekvent fokusmodell i Select.
9. Skriv explicit att rena registreringar inte får LLM-prosa.
10. Håll startsidesbeslutet utanför denna capability.

## Nulägesnoteringar när feedbacken dokumenterades

Två antaganden i feedbacktexten var redan inaktuella när dokumentet skapades:

- Rena lyckade måltidsregistreringar visar redan deterministiskt **Registrerat** och kort,
  utan ett efterföljande naturligt LLM-svar.
- Måltidsöversikten är redan borttagen från startsidan och `docs/capabilities.md` beskriver
  detta.

Detta gör inte de generella rekommendationerna ogiltiga, men dessa två punkter kräver
ingen ny produktändring inom planen.

## Fortsatt bedömning

Återstående föreslagna ändringar ska bedömas mot projektets enkelhetsprincip och dagens
faktiska releasekrav innan de förs in i huvudplanen. Särskilt operationslogg/undo,
occurrence-redigering och expand-and-contract innebär större scope än det ursprungliga
måltidskortet och ska inte införas implicit.
