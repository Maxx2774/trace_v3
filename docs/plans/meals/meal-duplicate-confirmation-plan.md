# Bekräftelse av möjliga måltidsdubletter

Status: planerad.

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
- En bekräftad måltid kopplas till turen där användaren bekräftade. Kortet visas därför
  under bekräftelsesvaret även efter omladdning.
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

#### B. Identisk nylig payload

När verkligt klockslag saknas krävs:

```text
identisk kanonisk semantisk payload
+ tidigare post skapad inom de senaste 10 minuterna
```

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

### Flera kandidater

V1 väljer exakt en starkaste kandidat:

1. kandidat med kompatibelt verkligt klockslag före nylig identisk payload
2. minsta absoluta tidsskillnad
3. senast skapade post
4. måltidens UUID som stabil sista tie-breaker

Detta påverkar endast vilken befintlig post frågan refererar till. Ingen kandidat raderas
eller ändras.

## Beständigt bekräftelseprotokoll

### Ny tabell: `meal_registration_confirmations`

Bekräftelsen är arbetsflödesstate som måste överleva en avslutad stream och en ny
användartur. Lägg därför till en serverägd tabell, separat från `meals`:

```text
id uuid primary key
user_id uuid not null references auth.users(id) on delete cascade
conversation_id uuid not null references conversations(id) on delete cascade
proposal_turn_id uuid not null references turns(id) on delete cascade
proposal_operation_id text not null
proposal_input_hash text not null
proposal jsonb not null
candidate_meal_id uuid not null references meals(id) on delete cascade
policy_version smallint not null
match_details jsonb not null
status text not null  -- pending | confirmed | discarded | expired
expires_at timestamptz not null
resolution_turn_id uuid null references turns(id) on delete set null
resolution_operation_id text null
created_meal_id uuid null references meals(id) on delete set null
created_at timestamptz not null
resolved_at timestamptz null
```

Lås följande integritet:

- `policy_version = 1` för den här leveransen.
- `proposal` är den redan validerade kanoniska `RecordMealInput` som servern senare ska
  använda oförändrad.
- `match_details` innehåller ankare, tidsavstånd och fältdiff; inga fria
  modellgenererade förklaringar sparas.
- `(user_id, proposal_operation_id)` är unik för idempotent replay av den ursprungliga
  tool-operationen.
- `resolution_operation_id` är unik per användare när det finns, så retry av ja/nej ger
  samma utfall.
- En partiell unik indexering på
  `(user_id, conversation_id, proposal_input_hash) where status = 'pending'` förhindrar
  flera aktiva kopior av samma proposal. RPC:n markerar utgångna rader som `expired`
  innan en ny pending-rad skapas.
- En pending-bekräftelse gäller i 30 minuter. Efter det krävs en ny uttrycklig
  registreringsbegäran.
- Aktiva bekräftelser hämtas med ett partiellt index på
  `(user_id, conversation_id, created_at desc, id) where status = 'pending'` och filtreras
  dessutom på `expires_at > now()` i frågan.
- Foreign keys som inte redan täcks får egna index.

Aktivera RLS utan klientpolicies. Återkalla tabellåtkomst från `anon` och
`authenticated`; endast appserverns verifierade serviceflöde får läsa och mutera
bekräftelserna.

## Atomiska databaskontrakt

### Förbered registrering

Ersätt nuvarande ensidiga resultat från `create_meal_from_chat` med ett diskriminerat
resultat:

```ts
type PrepareMealRegistrationResult =
	| { status: 'created'; meal: Meal; replayed: boolean }
	| {
			status: 'confirmation_required';
			confirmation: MealRegistrationConfirmation;
			replayed: boolean;
	  };
```

RPC:n ska inom samma korta databastransaktion:

1. validera input, tur, verifierad ägare och lease precis som idag
2. beräkna kanonisk payload och input-hash
3. återspela en redan skapad måltid för samma operation före all semantisk kontroll
4. återspela en redan skapad pending-bekräftelse för samma operation
5. för känt datum ta ett transaction-scoped advisory lock på användare + lokalt datum
6. efter låset kontrollera operation och identisk pending-proposal igen
7. hitta och rangordna kandidaten enligt `meal_duplicate_policy_v1`
8. skapa och returnera en pending-bekräftelse om kandidat finns
9. annars skapa meal, items och ingredients atomiskt som idag

Advisory-låset får endast hållas under RPC:ns databasarbete; inga modell- eller
nätverksanrop sker under låset. Okänt datum använder ingen semantisk kontroll och behåller
den befintliga operationslåsningsvägen.

Den befintliga `(user_id, occurred_on, occurred_at, id)`-indexeringen används för att
begränsa kandidatfrågan till en användares måltider samma dag. Lägg inte till lagrade
fingerprints eller ett bredare index innan mätning visar att den lilla dagsmängden kräver
det.

### Lös bekräftelse

Skapa en separat `resolve_meal_registration_confirmation`-RPC med:

```ts
type ResolveMealRegistrationConfirmationInput = {
	userId: string;
	turnId: string;
	leaseExpiresAt: string;
	operationIndex: number;
	confirmationId: string;
	decision: 'register' | 'discard';
};
```

RPC:n ska låsa bekräftelseraden och verifiera ägare, konversation, status, expiry och den
aktuella turens lease.

- `register` skapar meal, items och ingredients atomiskt från den lagrade proposalen,
  sätter måltidens provenance till resolutionsturen, markerar bekräftelsen `confirmed`
  och returnerar den skapade måltiden.
- `discard` markerar bekräftelsen `discarded` utan att skapa en måltid.
- Retry med samma resolution-operation returnerar exakt samma tidigare resultat.
- En annan operation mot en redan löst bekräftelse returnerar ett typat
  `already_resolved`-resultat och får aldrig skapa ytterligare en måltid.
- En utgången bekräftelse markeras `expired` och returnerar ett typat `expired`-resultat.
- Den kandidat som utlöste varningen ändras aldrig.

Alla nya eller ersatta RPC:er ska vara `security invoker`, ha tom `search_path`, få
explicit återkallad `execute` från `PUBLIC`, `anon` och `authenticated` och endast ges
till `service_role`, i linje med nuvarande serverägda mutationsmodell.

## Server- och toolkontrakt

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
- sätts `continueModel: true` oavsett modellens `responseRequired`
- får modellen en typad output som kräver en kort bekräftelsefråga
- får modellen aldrig säga att måltiden har registrerats

### `food_log.resolve_registration`

Lägg till ett separat deferred tool:

```ts
type ResolveRegistrationInput = {
	confirmationRef: string;
	decision: 'register' | 'discard';
};
```

- `register` får endast användas efter ett uttryckligt ja till den projicerade
  bekräftelsen. Resultatet innehåller måltiden och en `JournalRecord`; en ren bekräftelse
  använder därmed den befintliga deterministiska texten **Registrerat**.
- `discard` innehåller ingen `JournalRecord` och fortsätter modellen för ett kort naturligt
  svar.
- Otydligt svar, flera relevanta pending-förslag eller en korrigering ska inte gissas som
  `register`. Modellen frågar kort eller använder en ny `food_log.record`-operation.
- Ett okänt, utgånget eller redan löst handle ger ett typat korrigerbart tool-resultat,
  inte ett generellt serverfel.

### Symboliska referenser i modellkontexten

Utöka `prepareModelContext` med aktiva pending-bekräftelser för den verifierade användaren
och den aktuella konversationen. Hämta dem parallellt med övrig konversationskontext när
en `conversationId` finns.

Projicera endast:

- symboliskt handle, exempelvis `pending_meal_1`
- proposalens måltidstyp, occurrence, items och uttryckliga ingredienser
- den befintliga kandidatens motsvarande sammanfattning
- strukturerad matchningsorsak och relevanta skillnader
- expiry

Databas-ID:n skickas inte till modellen. Lägg bindingen i modellkontextens verifierade
referenskarta och låt tool-exekveringen översätta `confirmationRef` till internt UUID,
följt av en ny serververifiering i RPC:n.

Propagera referenskartan och den serververifierade konversationens ID explicit genom
route → stream → orchestrator → `ToolExecutionContext`. LLM-argumentet innehåller endast
det symboliska handlet; UUID:t hämtas aldrig från fri modelltext.

Pending-projektionen räknas in i befintlig tecken- och tokenbudget. Den generella
kärnprompten får endast en domänoberoende regel: ett tool-resultat som kräver användarens
bekräftelse ska återges som en kort fråga och får inte beskrivas som genomfört.

## Orkestrering och användarflöde

### Första upprepningen

```text
food_log.record
→ confirmation_required, ingen record
→ modellen ställer en kort fråga
→ assistantmeddelandet sparas och turnen slutförs normalt
```

Det befintliga snabbflödet för **Registrerat** får endast köras när varje förberett
tool-call faktiskt returnerade en beständig `JournalRecord`.

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
→ kort naturligt assistantsvar
```

### Användaren korrigerar

```text
”Nej, jag menade idag”
→ food_log.resolve_registration(discard) körs först
→ modellen skapar en ny food_log.record med korrigerat datum
→ den nya operationen genomgår samma policy
```

Modellen kan i samma steg avvisa den gamla pending-bekräftelsen och skicka den nya
registreringen, men discard-anropet ska ligga först. Operationerna ska exekveras i stabil
verktygsordning; resolve-toolen märks därför inte `parallelSafe` när den kombineras med
andra måltidsmutationer.

## Filplacering och ansvar

- `src/lib/features/meals/contracts.ts`: publika typer för matchningsdetaljer och
  bekräftelseutfall som delas mellan chat och server.
- `src/lib/features/meals/duplicate-confirmation.ts`: presentationshelpers för
  bekräftelsesammanfattningar; ingen andra TypeScript-implementation av SQL-matchningen.
- `src/lib/server/meals/meals.ts`: typade wrappers för prepare/resolve och serververifierad
  mapping.
- `src/lib/server/chat/tools/food-log.ts`: befintligt record-tool och dess schema.
- `src/lib/server/chat/tools/food-log-confirmation.ts`: det separata resolve-toolet så att
  record-filen inte växer med ett andra beteende.
- `src/lib/server/chat/history.ts`: laddning, budgetering och symboliska bindings för
  pending-bekräftelser.
- `src/lib/server/chat/orchestrator.ts`: generisk hantering av confirmation-required utan
  måltidsspecifika textheuristiker.
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
- separat nylig operation med samma datum och identiska tidlösa payload ger pending och
  ingen andra meal
- samma itemnamn men okänt datum ger ingen semantisk varning
- itemordning ignoreras och multiplicitetskillnad respekteras
- exact/exact vid 30 minuter matchar och vid 31 minuter inte matchar
- exact/approximate och approximate/approximate vid 90 minuter matchar och vid 91 minuter
  inte matchar
- två verkliga tider utanför gränsen matchar inte ens för nyligen identisk payload
- kontrollerad tidsperiod fabricerar inget tidsankare
- måltidstyp-, mängd- och ingrediensskillnader bevaras i diffen när tid ankras
- identiska pending-retries returnerar samma confirmation
- confirm skapar exakt en meal; retry returnerar samma meal
- discard och expired skapar ingen meal
- annan användare eller konversation kan inte läsa eller lösa bekräftelsen
- parallella separata operationer för samma användare/datum resulterar deterministiskt i
  högst en direkt insert och därefter pending enligt policyn
- RLS, grants, foreign keys och cascade/set-null-beteenden är korrekta

### TypeScript och orkestrering

- record-tool mappar `created` respektive `confirmation_required` korrekt
- ingen JournalRecord eller registreringsbekräftelse skickas före användarens ja
- resolve register skapar record och använder befintlig deterministisk **Registrerat**
- resolve discard fortsätter modellen utan record
- endast egna, aktiva och ej utgångna confirmations projiceras med symboliska handles
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
- bakgrundsjobb för cleanup; utgångna rader markeras lazy i RPC-flödet
- generell confirmation-infrastruktur för andra journaldomäner innan en andra konkret
  capability behöver samma beteende
