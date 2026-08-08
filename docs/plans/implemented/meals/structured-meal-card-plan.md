# Strukturerade måltidstillfällen och redigerbart måltidskort

Status: implementerad och verifierad 2026-08-06.

## Mål

Gör `Meal` till ett gemensamt konsumtionstillfälle och inför en explicit struktur för det
användaren åt eller drack vid tillfället:

```text
Meal
├─ meal_type
├─ occurrence
└─ Meal items
   ├─ name
   ├─ amount_text
   └─ Ingredients
      ├─ name
      └─ amount_text
```

Måltidskortet i chatten ska visa och redigera denna kanoniska struktur. Endast sparade
eller uttryckligen bekräftade uppgifter får visas. Saknad information betyder okänd
information och ska aldrig fyllas i från ett receptantagande.

## Låsta domänbeslut

- `Meal` är ett konsumtionstillfälle med gemensam måltidstyp och tidsuppgift.
- `MealItem` är en separat rätt, mat, dryck eller ett tillbehör som användaren beskrev vid
  tillfället, exempelvis **Chiapudding**, **Äggröra**, **Kaffe** eller **Bearnaisesås**.
- `MealIngredient` är en uttryckligen angiven beståndsdel i ett namngivet item.
- Item och ingrediens är kontextuella roller i den aktuella registreringen, inte fasta
  klassificeringar av livsmedel. Ordet **med** innebär inte automatiskt en
  ingrediensrelation.
- Ett item får sakna ingredienser. Det betyder att ingredienserna är okända, inte att
  maträtten saknade ingredienser.
- Måltidstypen är nullable och har exakt följande värden:
  `breakfast | lunch | dinner | snack | other`.
- Användarens mängduttryck bevaras i `amount_text`. Inför inte numerisk mängd eller
  normaliserad enhet i denna capability; uttryck som **lite**, **en halv portion** och
  **2–3 skivor** måste kunna sparas utan informationsförlust.
- Alla items och ingredienser får stabila UUID:n. Arrayindex används endast för visuell
  ordning och aldrig som identitet.
- En måltid måste ha minst ett item. Radering av det sista itemet nekas; radering av hela
  måltiden är en separat framtida capability.
- Gamla måltider slås inte ihop utifrån turn, tidpunkt eller liknande heuristik.

## Kanoniska TypeScript-kontrakt

```ts
type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';

type MealOccurrence =
	| {
			precision: 'exact';
			occurredAt: string;
			occurredOn: string;
			timezone: string;
			timeExpression: string | null;
	  }
	| {
			precision: 'approximate';
			occurredAt: string | null;
			occurredOn: string;
			timezone: string;
			timeExpression: string;
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

type MealOccurrenceInput =
	| {
			precision: 'exact';
			occurredAt: string;
			timezone: string;
			timeExpression: string | null;
	  }
	| {
			precision: 'approximate';
			occurredAt: string;
			timezone: string;
			timeExpression: string;
	  }
	| {
			precision: 'approximate';
			occurredAt: null;
			occurredOn: string;
			timezone: string;
			timeExpression: string;
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

type Meal = {
	id: string;
	revision: number;
	mealType: MealType | null;
	items: MealItem[];
	occurrence: MealOccurrence;
	createdAt: string;
	updatedAt: string;
};

type JournalRecordReference = {
	type: 'meal';
	recordId: string;
	committedRevision: number;
};
```

`name` och `amountText` är användarsynliga fält. Eventuella framtida normaliserade namn,
enheter eller näringsvärden ska vara separata fält och får inte ersätta den bevarade
representationen.

## Databasmodell

### `meals`

- Behåll ägare, provenance, occurrence, idempotens och tidsstämplar.
- Lägg till nullable `meal_type text` med en check constraint för de fem tillåtna värdena.
- Lägg till `revision integer not null default 1` med en positiv check constraint. Varje
  lyckad redigering ökar revisionen exakt en gång; `updated_at` behålls för audit och
  visning men används inte som concurrency-token.
- Ta bort `description` när migreringen och alla läs-/skrivkontrakt använder items.
- Behåll `occurred_precision`; döp inte om det till `time_precision`, eftersom fältet även
  uttrycker datum-only och helt okänd tid.
- Låt databasen upprätthålla samma giltiga kombinationer som `MealOccurrence`-unionen.
  För `exact`, och för `approximate` när `occurred_at` finns, härleder servern
  `occurred_on` från `occurred_at` och `timezone`; klienten får inte skapa två motstridiga
  värden.
- Ett ungefärligt uttryck utan meningsfull klocktid, exempelvis **imorse**, sparas med
  `occurred_at = null`, känt `occurred_on`, tidszon och bevarat `time_expression`. Servern
  får inte välja ett representativt klockslag.

### `meal_items`

```text
id uuid primary key
meal_id uuid not null references meals(id) on delete cascade
position integer not null
name text not null
amount_text text null
created_at timestamptz not null
updated_at timestamptz not null
unique (meal_id, position) deferrable initially deferred
```

- `name` trimmas och begränsas till 1–160 tecken.
- `amount_text` är nullable; när det finns trimmas det och begränsas till 1–80 tecken.
- `position` begränsas till 0–49.
- Foreign keyn täcks av det unika indexet med `meal_id` först.

### `meal_item_ingredients`

```text
id uuid primary key
meal_item_id uuid not null references meal_items(id) on delete cascade
position integer not null
name text not null
amount_text text null
created_at timestamptz not null
updated_at timestamptz not null
unique (meal_item_id, position) deferrable initially deferred
```

- Samma text- och positionsgränser används som för items.
- Foreign keyn täcks av det unika indexet med `meal_item_id` först.
- Tabellen ersätter den nuvarande direkta relationen `meal_ingredients.meal_id`.

### `meal_update_receipts`

Lägg till en liten serverägd receipt-tabell för säkra retryer av kortmutationer:

```text
user_id uuid not null references auth.users(id) on delete cascade
client_mutation_id uuid not null
meal_id uuid not null references meals(id) on delete cascade
input_hash text not null
previous_revision integer not null
new_revision integer not null
result jsonb not null
source text not null
created_at timestamptz not null
primary key (user_id, client_mutation_id)
```

- Tabellen är ett idempotensprotokoll för genomförda meal-updates, inte ett generellt
  event sourcing- eller undo-lager.
- Fälten följer det gemensamma mönstret aktör, källa, mutations-ID, input-hash,
  föregående/ny revision och kanoniskt resultat så att en framtida gemensam
  journalwrite-lösning inte blockeras. Den här iterationen inför ändå ingen generell
  operationsabstraktion innan ytterligare journaltyper faktiskt behöver den.
- `input_hash` härleds av servern från den kanoniska mutationspayloaden och accepteras
  aldrig från klienten.
- `source` är `meal_card` i denna capability.
- `result` innehåller det kanoniska svar som ska återspelas om samma mutation retryas.
- Tidigare snapshots eller inversa operationer sparas inte. Recovery och undo är en
  separat framtida capability och ska inte antydas av receipten.

### Åtkomst

- Aktivera RLS på alla nya tabeller innan de exponeras.
- Aktivera RLS utan klientpolicies på `meal_update_receipts`; tabellen är endast
  serveråtkomlig.
- Autentiserade användare får endast `select` och endast genom ägarskap via
  `meals.user_id = auth.uid()`.
- `anon` får ingen åtkomst.
- Mutationer sker endast via serverns admin-klient efter `getClaims()` och genom RPC:er
  som alltid filtrerar på både `p_user_id` och `p_meal_id`.
- Återkalla standardmässig `execute` från `public`, `anon` och `authenticated`; ge endast
  `service_role` den mutationsexekvering appservern behöver.
- Kör Supabase security- och performance-advisors efter migreringen.

## Förlustfri migrering av befintliga måltider

Appen är inte driftsatt, så migreringen behöver ingen expand/switch/contract-fas,
dual-write eller bakåtkompatibilitet mellan två samtidigt körande appversioner. Gör ett
sammanhållet lokalt byte och applicera det först när den nya appkoden är redo.

Kör före backfill en preflight som identifierar tomma descriptions, omgivande whitespace,
texter över de nya gränserna och om den befintliga ingrediensordningen verkligen är
lagrad. Avbryt på data som annars skulle kapas eller ändras tyst. Om gammal ordning
saknas används en dokumenterad deterministisk fallback, exempelvis `created_at, id`; den
får inte beskrivas som bevarad originalordning.

Migreringen får därefter inte tolka om eller slå ihop historiska poster:

1. Skapa `meal_items` och den nya ingrediensrelationen.
2. Skapa exakt ett item per befintlig `meal`.
3. Sätt itemets `name` till måltidens befintliga `description` ordagrant.
4. Sätt itemets `amount_text` till `null`.
5. Flytta varje befintlig ingrediens till detta item i oförändrad ordning.
6. Sätt ingrediensens `name` till befintligt `reported_text` ordagrant och
   `amount_text` till `null`; dela inte upp texten heuristiskt.
7. Sätt `meal_type` till `null` för historiska poster. Härled inte typen från en gammal
   titel, eftersom titeln kan vara modellgenererad eller ha en annan betydelse.
8. Skapa de nya RPC-kontrakten, verifiera backfillen och ta därefter bort gamla
   databaskontrakt och kolumner inom samma databastransaktion.

Serverhelpers, replay och läsprojektioner uppdateras i samma kodändring men ligger inte i
databastransaktionen. Ingen övergångskod behålls efter att det lokala bytet verifierats.

Existerande måltider förblir separata tillfällen. Två poster som skapades i samma turn
eller vid närliggande tider får inte slås ihop automatiskt.

## Atomiska serverkontrakt

### Skapa från chatten

`food_log.record` ändras till ett nested input för exakt ett konsumtionstillfälle:

```ts
type RecordMealInput = {
	mealType: MealType | null;
	items: Array<{
		name: string;
		amountText: string | null;
		ingredients: Array<{
			name: string;
			amountText: string | null;
		}>;
	}>;
	occurred: MealOccurrenceInput;
};
```

- Inputen kräver 1–20 items, högst 30 ingredienser per item och högst 100 ingredienser
  totalt för måltiden.
- Den serialiserade mutationspayloaden får vara högst 32 KiB. Gränsen verkställs både vid
  requestgränsen och efter kanonisk validering så att extra eller oväntade fält inte kan
  användas för att kringgå den.
- Modellen får bara sätta `mealType` när typen framgår uttryckligen eller användaren har
  bekräftat den. Annars skickas `null`.
- Food-capabilityns egna instruktioner definierar item som en separat rätt, mat, dryck
  eller ett tillbehör och ingredient som en uttryckligen beskriven beståndsdel i ett
  namngivet item. Regeln läggs inte i chattens kärnprompt.
- **Äggröra med 4 ägg och smör** blir itemet Äggröra med de uttryckliga ingredienserna
  Ägg och Smör. **Biff med pommes och bearnaisesås** blir tre items utan härledda
  ingredienser. Bearnaisesåsens eller pommesens sannolika beståndsdelar får inte fyllas i.
- `amountText` innehåller endast mängd som användaren faktiskt har angett.
- Tydliga uttryck delas förlustfritt, exempelvis **500 g köttfärs** till
  `name: Köttfärs`, `amountText: 500 g`. Om uppdelningen är osäker bevaras hela uttrycket
  i `name` och `amountText` sätts till `null`.
- Ett tool-call skapar måltiden, samtliga items och samtliga ingredienser i samma
  transaktion under den befintliga idempotensnyckeln.
- Flera uttryckligen skilda konsumtionstillfällen kräver flera tool-calls. Flera rätter
  vid samma uttryckliga tillfälle blir flera items i ett call.

### Redigera från kortet

För den här capabilityn används en enda liten mutationsyta:

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

- UI-åtgärderna är granulära, men skickar nästa fullständiga kanoniska struktur till en
  atomisk `update_meal`-RPC.
- Servern validerar ägare, tillåtna typer, stabila UUID:n, textgränser, unika ID:n,
  positionsgränser, 1–20 items, högst 30 ingredienser per item, högst 100 ingredienser
  totalt och högst 32 KiB serialiserad mutationspayload.
- RPC:n låser måltidsraden, jämför `expectedRevision` och applicerar hela payloaden som
  ett atomiskt replace-kontrakt genom diff/upsert. Den får inte implementeras som att
  alla barn raderas och skapas om.
- Befintliga objekt med ID uppdateras på plats, objekt med `id: null` skapas med
  servergenererade UUID:n och tidigare objekt som saknas i payloaden raderas.
- Servern verifierar att varje befintligt item-ID tillhör måltiden och att varje
  ingredient-ID tillhör det angivna itemet. Dubbletter, adoption från andra måltider och
  tyst byte av förälder nekas.
- Flytt av en ingrediens mellan två items uttrycks som radering från det gamla itemet och
  skapande med `id: null` under det nya itemet.
- `position` skickas inte av klienten utan härleds från arrayordningen. De uppskjutna
  unikhetsvillkoren gör att en omsortering kan genomföras utan tillfälliga
  positionskollisioner mitt i transaktionen.
- Efter diffen ökar RPC:n `revision` exakt en gång och sparar mutationens receipt i samma
  transaktion. Svaret är alltid hela den nya kanoniska måltiden, inklusive nya ID:n.
- Samma `clientMutationId` och samma kanoniska payload returnerar receiptens tidigare
  kanoniska resultat utan en ny mutation.
- Samma `clientMutationId` med en annan payload ger idempotenskonflikt.
- Ett nytt `clientMutationId` med en gammal `expectedRevision` ger versionskonflikt.
- En versionskonflikt ger ett typat `409`-fel. Klienten behåller inte den osparade
  versionen som om den vore kanonisk, utan erbjuder omladdning.
- Varje lyckad mutation ersätter kortets lokala meal med serverns fullständiga returvärde.
- Datum och tid kan korrigeras i samma redigeringsläge och sparas atomiskt tillsammans med
  resten av måltiden. Servern normaliserar och validerar occurrence innan commit.
- Inför inte sex separata CRUD-RPC:er innan det finns ett konkret behov från exempelvis
  framtida LLM-baserad korrigering. Ett atomiskt replace-kontrakt är mindre och uppfyller
  dagens UI-krav.

## Återanvändbar Select-primitive

Skapa `src/lib/components/ui/Select.svelte`. Den ska inte vara måltidsspecifik.

Första kontraktet:

```ts
type SelectOption<T extends string> = {
	value: T;
	label: string;
};

type SelectProps<T extends string> = {
	value: T | null;
	options: SelectOption<T>[];
	placeholder: string;
	label: string;
	disabled?: boolean;
	onValueChange: (value: T) => void;
};
```

- Triggern är en knapp med `role="combobox"`, korrekt label, `aria-expanded`,
  `aria-controls`, `aria-haspopup="listbox"` och `aria-activedescendant`.
- Popupen har `role="listbox"`; varje val har `role="option"` och `aria-selected`.
- DOM-fokus stannar på combobox-triggern när popupen är öppen.
  `aria-activedescendant` pekar på det visuellt aktiva alternativet.
- `ArrowDown`/`ArrowUp` öppnar och flyttar aktivt val.
- `Home`/`End` flyttar till första/sista val.
- `Enter` och `Space` väljer aktivt val.
- `Escape` stänger och återställer fokus till triggern.
- `Tab` stänger utan att fånga fokus.
- Bokstavstangenter använder typeahead för att aktivera nästa matchande alternativ.
- Klick utanför stänger.
- Fokus och aktivt val ska alltid vara synligt vid tangentbordsnavigation.
- Komponentens popup använder samma spacing, radius, yta, shadow, hover-, active- och
  focus-språk som `Popover`, inklusive dark mode. Gemensamma tokens kan extraheras om de
  faktiskt återanvänds; Select får inte göra Popovers menu-semantik till listbox-semantik.
- Den synliga kontrollen är inte en native `<select>`. Lägg inte till en dold native select
  om inget formulärkontrakt kräver den.

Måltidsalternativen visas på svenska:

```text
Frukost    → breakfast
Lunch      → lunch
Middag     → dinner
Mellanmål  → snack
Annat      → other
```

`null` är ett systemskapat tillstånd för en ännu inte klassificerad måltid och visas som
**Välj måltidstyp**. Det finns inget menyval som återställer en bekräftad typ till `null`;
efter användarens första val kan typen endast bytas till en annan av de fem typerna.
Typändringen sparas omedelbart; vid fel återställs Select till serverns senaste kanoniska
värde och visar ett kort felmeddelande.

## Datum och tid

Skapa en ren formatteringsfunktion med explicit `now` i tester.

- Jämför `occurred_on` med dagens datum i måltidens sparade IANA-tidszon.
- Samma lokala datum visas som **Idag**.
- En dag bakåt visas som **Igår**.
- Två till sex dagar bakåt visas med veckodagens namn, exempelvis **Torsdag**.
- Äldre datum visas kort absolut, exempelvis **6 aug.**.
- Alla framtida datum visas absolut. Använd aldrig **Imorgon**, **Övermorgon** eller
  liknande för en konsumerad måltid.
- `exact` visas som exempelvis **Idag, 08:30**.
- `approximate` med sparad ungefärlig klocktid visas som exempelvis
  **Idag, cirka 08:30**.
- `approximate` utan `occurredAt` visar det bevarade uttrycket, exempelvis
  **Idag, i morse**, och får aldrig tilldelas ett påhittat klockslag.
- `date` visar endast datumdelen.
- `unknown` visar **Datum ej angivet**; använd inte `created_at` som måltidens datum.

## Måltidskortets UI

### Läsläge

- Kortet visas som standard som ett lugnt, kompakt kvitto utan permanent
  formulärutseende.
- Vänster i översta raden: måltidstyp som vanlig text eller den neutrala texten
  **Välj måltidstyp** när värdet är `null`.
- Höger: det precisionbevarande datum-/tidsvärdet.
- Items och ingredienser visas utan pennor, kryss, inputs eller lägg till-knappar.
- Efter innehållet visas den lilla textåtgärden **Redigera** med pennikon.
- Under pågående chattstream visas samma läsläge, men **Redigera** är inte tillgänglig.

### Redigeringsläge

- **Redigera** öppnar kortets redigeringsläge och ersätts av **Klar**. Det finns inget
  gemensamt osparat kortutkast; varje underåtgärd använder det atomiska
  mutationskontraktet och **Klar** lämnar läget.
- Måltidstypen blir Select och datum/tid får separata precisionmedvetna kontroller.
- Item- och ingrediensåtgärder samt knappar för att lägga till innehåll visas endast här.
- Små ikonknappar får vara visuellt diskreta men använder designsystemets tillräckliga
  klick-/touchyta och har tillgängliga namn.

### Items och ingredienser

- Varje item är en separat visuell grupp med namn och valfri mängd.
- Ingredienser visas indragna direkt under det item de tillhör.
- Ett item utan ingredienser visar ingen tom ingredienslista eller påhittad förklaring.
- I redigeringsläget har varje item en liten redigeringsåtgärd. Raderingsåtgärden visas
  endast när måltiden har fler än ett item; det sista itemet kan inte tas bort utan att
  den separata framtida capabilityn för att radera hela måltiden finns.
- Varje ingrediens har egna redigerings- och raderingsåtgärder.
- **Lägg till ingrediens** ligger i det item som ska få ingrediensen.
- **Lägg till mat eller dryck** ligger efter item-listan. Använd inte den tekniska texten
  **Lägg till måltidsdel** i UI:t.
- Endast en item- eller ingredienseditor är öppen åt gången.
- Redigering använder separata inputs för `name` och `amountText`, aldrig en gemensam
  textarea för hela måltiden eller alla ingredienser.
- Item- och ingrediensredigering har explicita **Spara** och **Avbryt**.
- Datum- och tidskontrollerna får endast skapa en av de giltiga
  `MealOccurrence`-varianterna och ska visa det bevarade tidsuttrycket när ingen klocktid
  finns.
- Radering och tillägg sparas direkt genom det atomiska serverkontraktet. Vid fel återgår
  kortet till den senaste kanoniska posten.
- Alla mutationer låses medan en mutation på samma kort pågår.
- Kortet fortsätter använda den svaga eukalyptussignalen och neutral innehållstext.

## Chatt, replay och lokal synk

- Beständig chatthistorik lagrar `JournalRecordReference`, inte en auktoritativ kopia av
  den muterbara måltiden. `committedRevision` beskriver revisionen som committades i den
  ursprungliga chatthändelsen; den låser inte framtida visning till den revisionen.
- `journal_record_created` och den omedelbara turn-replayen får innehålla både referensen
  och ett fullständigt `Meal` för omedelbar rendering utan en extra roundtrip.
- Vid reload samlar serverns read projection alla meal-referenser i konversationen och
  hämtar de aktuella kanoniska måltiderna i en batch. Ingen fråga per kort och ingen
  beständig meddelandeblobb används som current authority.
- Den hydrerade konversationsresponsen returnerar samma fullständiga `Meal`-kontrakt med
  items, ingredienser, `revision` och `updatedAt` som live-eventet.
- En ren lyckad `food_log.record`-turn visar den deterministiska statusen
  **Registrerat** och måltidskortet. Inget naturligt assistantsvar genereras eller sparas.
- Om samma turn även innehåller en faktisk fråga får ett naturligt assistantsvar på
  frågan följa efter kortet.
- Konversationstiteln genereras efter den första committade turnen och får som enda input
  använda användarens första meddelande i dess rena textform. Den får inte använda
  meal-JSON, tool-input, tool-resultat, assistanttext eller annan härledd struktur.
- Måltidskortet blir redigerbart först när turnen är färdigcommittad.
- En lyckad redigering ersätter matchande meal-ID i chattsessionens journalrecords.
- Ingen separat måltidsöversikt återinförs på startsidan.

## Implementationsordning

1. Lås nya TypeScript- och Valibot-kontrakt samt rena mappings/formatterare med tester.
2. Skapa migrationsfilen med Supabase CLI och implementera tabeller, constraints, index,
   RLS, grants, förlustfri backfill och ersatta RPC-projektioner i en transaktion.
3. Uppdatera serverhelpers, `food_log.record`, replay och chattens journalrecord-kontrakt.
4. Implementera och verifiera den generella Select-primitiven isolerat.
5. Bygg om `MealCard` till måltidstyp, datum/tid, items och underordnade ingredienser.
6. Koppla varje UI-mutation till det revisions- och idempotensskyddade atomiska
   update-kontraktet.
7. Applicera migrationen, kör SQL-tester och Supabase advisors.
8. Kör en autentiserad E2E genom registrering, reload, type-select och samtliga item- och
   ingrediensmutationer i både ljust och mörkt tema.
9. Uppdatera `docs/capabilities.md` endast med det beteende som då är verifierat.

## Verifiering

### Databas

- Nested create skapar meal, items och ingredienser atomiskt och i stabil ordning.
- Samma operation och payload är idempotent; ändrad payload under samma operation ger
  konflikt.
- En annan användare kan varken läsa eller mutera strukturen.
- RLS och explicita grants gäller för alla tre nivåer.
- Update med rätt revision ökar revisionen exakt en gång och returnerar hela den nya
  måltiden.
- Update med stale `expectedRevision` och ett nytt mutations-ID ger konflikt utan partiell
  mutation.
- Retry med samma `clientMutationId` och samma payload returnerar tidigare resultat utan
  en andra revision eller mutation.
- Samma `clientMutationId` med ändrad payload ger idempotenskonflikt.
- Ogiltig typ, tomt item, dubblett-ID, fler än 20 items, fler än 30 ingredienser i ett
  item, fler än 100 ingredienser totalt, payload över 32 KiB och radering av sista itemet
  nekas.
- Radering av meal eller konto kaskadraderar alla underordnade rader.
- Konversationsradering bevarar måltiden och tar endast bort provenance enligt nuvarande
  kontrakt.
- Backfill bevarar varje gammal text och ordning ordagrant.

### Enhet och komponent

- Datumformatteraren täcker Idag, Igår, veckodag, äldre datum, framtida datum, exakt,
  ungefärlig, date-only och unknown över tidszonsgränser.
- Formatteraren verifierar särskilt att **imorse** visas som ett bevarat uttryck och aldrig
  som ett syntetiskt klockslag.
- Select täcker mus, touch, piltangenter, Home/End, Enter/Space, Escape, Tab, disabled,
  placeholder och vald option.
- MealCard täcker läs- och redigeringsläge, tom ingredienslista, valfri mängd, separata
  editorer, add/remove, dold radering för sista itemet, tillgängliga åtgärder, sparfel och
  versionskonflikt.
- Tool-schemat nekar extra fält, tomma items och inkonsekvent occurrence.
- Replay och reload ger exakt samma nested kanoniska post.

### Produktflöde

- **Jag åt chiapudding och äggröra med 4 ägg till frukost idag klockan 08:30** ger ett
  enda meal med typen Frukost, två items och `4 ägg` under Äggröra.
- **Jag åt 4 ägg** ger ett item Ägg med den uttryckliga mängden bevarad och inga påhittade
  ingredienser.
- **Jag åt chiapudding** skapar inga antagna chiafrön, mjölk eller toppings.
- Användaren kan ändra måltidstyp, redigera/lägga till/ta bort items och göra motsvarande
  operationer för ingredienser samt korrigera datum och tid. Varje ändring överlever
  omladdning.
- Kortet fungerar visuellt och med tangentbord i både ljust och mörkt tema.

## Klart när

- Ett måltidskort motsvarar exakt ett konsumtionstillfälle.
- Måltidstyp och occurrence finns endast på meal-nivån.
- Varje sparad ingrediens tillhör exakt ett stabilt meal item.
- Ingen vy behöver gruppera separata meals med tids- eller turnheuristik.
- Alla granulara UI-ändringar uppdaterar den kanoniska serverposten atomiskt och
  revisionsskyddat samt kan retryas idempotent efter ett förlorat svar.
- Befintlig data har migrerats utan textsplitting, typgissning eller automatisk
  sammanslagning.
- Hela verifieringsmatrisen passerar och `docs/capabilities.md` beskriver det levererade
  beteendet.
