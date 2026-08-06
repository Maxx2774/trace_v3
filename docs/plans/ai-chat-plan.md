# Plan för AI-chatt i Trace v3

Status: implementerad och databasmigrerad. Live-verifiering mot OpenAI väntar på lokal
konfiguration av `SUPABASE_SECRET_KEY` och `TRACE_SAFETY_HMAC_KEY`.

## Mål

Första versionen ska ge Trace en enkel, autentiserad AI-chatt med sparade konversationer. Svaret ska börja visas så snart modellen skickar text. Användarens meddelande sparas innan modell-anropet, medan assistentens kompletta svar sparas först när streamingen har avslutats korrekt. Användaren ska kunna avbryta ett pågående svar utan att det redan sparade användarmeddelandet tas bort.

Denna version ska endast hantera konversationer. Den har ingen åtkomst till och kan inte läsa eller ändra strukturerad data om vikt, mat, måltider eller andra journalposter, och den ska inte innehålla tool calls. Text som användaren själv skriver i chatten kan däremot innehålla hälsodata och behandlas då som konversationsdata.

## Låsta beslut

- OpenAI Responses API används från servern.
- Modell: `gpt-5.6-luna`.
- Reasoning effort: `low`.
- Reasoning context: `current_turn`.
- Varje modellanrop använder `safety_identifier` i formatet `trace-safety-v1:<base64url(HMAC-SHA256(claims.sub))>`, beräknat med en separat serverhemlighet.
- De kanoniska tabellnamnen är `conversations` och `messages`.
- De nya tabellerna ligger i `public` som `public.conversations` och `public.messages`.
- Trace v2:s konversationsdata och tillhörande runtime avvecklas permanent i en separat, verifierad och irreversibel migrering innan de nya tabellerna skapas. Ingen v2-konversationsdata migreras till v3.
- En API route används för AI-streaming; remote functions används för övrig konversationsdata.
- SvelteKit låses till exakt version `2.70.2`. Remote function-ytan isoleras till tre små exporter i `conversations.remote.ts`; testbar databas- och domänlogik ligger i server-only helpers.
- Supabase-åtkomst delas i två separata serverklienter: den sessionsbundna `event.locals.supabase` används för RLS-skyddade läsningar, medan en dedikerad server-only admin-klient används för mutationer och alltid kombineras med ett uttryckligt `user_id`-filter från verifierade `claims.sub`.
- Chattens mappstruktur är låst: UI och webbläsarbeteende ligger i `src/lib/features/chat`, hemligheter och auktoritet i `src/lib/server`, streamingens HTTP-gräns i `src/routes/api/chat/stream/+server.ts` och databasmigrationer samt SQL-tester i `supabase`.
- Varje skickat användarmeddelande får ett klientgenererat `turn_id` som delas med tillhörande assistentsvar och återanvänds vid retry.
- Databasskrivningarna delas i två korta, atomiska gränser: `begin_chat_turn` före modellanropet och `commit_chat_turn` efter fullbordad modellrespons.
- Ett lyckat nytt chattmeddelande får göra exakt två appdatabasanrop: `begin_chat_turn` före modellen och `commit_chat_turn` efter en fullbordad respons. Avbrott och modellfel efter begin får göra exakt ett. Streamade deltas får aldrig skriva till eller läsa från databasen.
- Klienten uppdaterar konversationslistans cache från de auktoritativa värden som returneras i stream-events och mutationsresultat. Ingen automatisk list-refresh görs efter skickat meddelande eller radering.
- Svaret streamas direkt till klienten.
- Supabase är Traces kanoniska källa för produktens konversationsstate. OpenAI-anropet använder `store: false` och skapar ingen providerägd konversationsstate.
- GPT-5.6-anropet använder `prompt_cache_options: { mode: "explicit" }` utan explicita cache-breakpoints, vilket innebär att prompt caching inte används i den första versionen.
- Trace sparar och återspelar den synliga konversationstexten, men sparar inte OpenAI:s opaka eller krypterade reasoning-items.
- Användarens meddelande sparas före OpenAI-anropet.
- Assistentens meddelande sparas efter `response.completed`, innan klienten får den avslutande `done`-händelsen.
- Assistentens kanoniska innehåll hämtas från den slutförda responsens `output_text`. Den lokalt konkatenerade deltabufferten är endast preliminär UI-state.
- Modellinput innehåller alltid aktuell användarfråga och högst 19 tidigare synliga turns. En tidigare turn får bestå av ett användarmeddelande med eller utan ett sparat assistentsvar. Systeminstruktion och synlig historik får tillsammans innehålla högst 48 000 tecken.
- Modellanropet använder `max_output_tokens: 4096` och `truncation: "disabled"`.
- Composern, servern och databasen begränsar användarmeddelanden till 5 000 tecken. Klientgränsen är endast UX; servern är auktoritativ.
- En konversation får bara ha ett pågående svar åt gången i klienten.
- Medan ett svar pågår ersätts skicka-handlingen av en stoppkontroll. Ett manuellt stopp avbryter klientens stream och vidarebefordras till det pågående modellanropet, lämnar användarmeddelandet sparat och sparar inget partiellt assistantsvar.
- Konversationen skapas först när användaren skickar sitt första meddelande.
- Titeln skapas deterministiskt från det första användarmeddelandet. Ett extra AI-anrop för titel görs inte.
- UI:t visar vanlig text i första versionen. Markdown-rendering ingår inte.
- Leveransen är den första infrastrukturen för autentiserad, sparad och streamad konversation, inte den färdiga Trace-assistenten.
- Chatten visas med tydliga begränsningar när lanseringsgaten är uppfylld; ingen separat feature flag införs enbart för att journaloperationer ännu saknas.
- Systemprompten destilleras från `product.md`, hålls under cirka 1 200 tecken i denna slice och innehåller inga instruktioner för framtida databasoperationer eller tools.

## Tabellnamn

Domänmodellen använder `conversations` och `messages`. Namnen beskriver produktens faktiska begrepp och är oberoende av modell, leverantör, gränssnitt och versionsnummer. Vi använder därför inte prefix som `chat_`, `ai_`, `trace_` eller `v3_`.

Den befintliga `public.conversations` och `public.conversation_messages` är kopplade till Trace v2:s runtime och återanvänds inte. De har bland annat:

- triggers och skrivskydd för Trace v2,
- obligatorisk koppling från meddelanden till `trace_runtime.runtime_invocations`,
- `turn_id`, sekvensregler och ett större `assistant_payload`-kontrakt,
- RPC:er och provenance-regler för den gamla exekveringsmodellen.

Att pressa in en enkel chatt i dessa kontrakt skulle göra den nya funktionen beroende av beteende vi uttryckligen inte behöver. Eftersom Trace v2 ska avvecklas helt och dess konversationsdata inte ska bevaras frigörs namnet genom en separat avvecklingsmigration före chattslicen.

Avvecklingsmigrationen ska:

- kräva att all Trace v2-trafik är stoppad,
- ta bort beroende v2-funktioner, triggers, foreign keys och berörda runtime-objekt i uttrycklig ordning,
- radera `public.conversation_messages` och därefter `public.conversations`, inklusive all data,
- inte använda ett blint `DROP ... CASCADE` som ersättning för beroendekartläggning,
- verifiera efteråt att inga trasiga eller kvarvarande v2-konversationsberoenden finns,
- dokumenteras som irreversibel; ingen dataåterställning eller semantisk migrering till v3 ingår.

Först efter godkänd verifiering skapas de nya, rena `public.conversations` och `public.messages`.

Vi återanvänder användaridentiteten i `auth.users` och relevanta databasprinciper, exempelvis ägarskap, RLS och sammansatta foreign keys.

## Föreslagen arkitektur

```text
ConversationSheet
      │ POST /api/chat/stream
      ▼
SvelteKit-server
  1. verifierar claims.sub
  2. gör ett begin_chat_turn-anrop som skapar/verifierar konversation,
     sparar användarmeddelandet och returnerar budgeterad historik
  5. streamar gpt-5.6-luna till klienten
  6. gör ett commit_chat_turn-anrop som sparar komplett assistentsvar
  7. skickar done
      │
      ├── OpenAI Responses API
      └── Supabase/Postgres
```

OpenAI-nyckeln och Supabase secret key ska bara användas i servermoduler. Klienten skickar aldrig `user_id`; ägarskapet kommer alltid från den autentiserade användarens `claims.sub`.

## Låst mappstruktur

```text
src/lib/features/chat/
├── ChatComposer.svelte
├── ConversationSheet.svelte
├── ConversationList.svelte
├── conversations.remote.ts
├── contracts.ts
└── stream-client.ts

src/lib/server/
├── supabase/
│   └── admin.ts
└── chat/
    ├── conversations.ts
    ├── turns.ts
    ├── history.ts
    ├── model.ts
    └── stream.ts

src/routes/api/chat/stream/
└── +server.ts

supabase/
├── migrations/
│   ├── ..._remove_trace_v2_conversation_runtime.sql
│   └── ..._create_chat.sql
└── tests/
    └── chat.sql
```

Ansvarsgränser:

- `ConversationSheet.svelte` äger den lokala chattens UI-state och samordnar vyerna.
- `ChatComposer.svelte` äger textinmatning, 5 000-teckensgränsen och skicka/stopp-kontrollen.
- `ConversationList.svelte` visar, väljer och initierar radering av sparade konversationer.
- `contracts.ts` innehåller endast gemensamma, serialiserbara typer och eventkontrakt.
- `stream-client.ts` läser NDJSON, korrelerar events och hanterar `AbortController`; den innehåller ingen serverauktoritet.
- `conversations.remote.ts` exponerar endast `listConversations`, `getConversation` och `deleteConversation`.
- `server/chat/conversations.ts` innehåller testbara serverhelpers för lista, hämta och radera.
- `server/chat/turns.ts` äger de atomiska begin/commit-anropen.
- `server/chat/history.ts` äger den rena och deterministiska historikbudgeten.
- `server/chat/model.ts` äger OpenAI-klienten, modellkonfigurationen, systemprompten och HMAC-identifieraren.
- `server/chat/stream.ts` äger providerstreamen, terminalmodellen och persistensordningen.
- API-routen är en tunn HTTP-gräns för auth, requestvalidering och anrop till streammodulen.
- `server/supabase/admin.ts` är den enda chattrelaterade modulen som får skapa klienten med `SUPABASE_SECRET_KEY`.
- TypeScript-tester samlokaliseras som `*.test.ts` bredvid den rena servermodul de verifierar; databasens RLS- och kontraktstester ligger i `supabase/tests/chat.sql`.

Vi inför inte generiska lager eller mappar som `services`, `repositories`, `adapters` eller `use-cases`, ingen global chatt-store, ingen klass per databasoperation och inga separata CRUD-routes. Meddelanderenderingen stannar i `ConversationSheet.svelte` tills ett verifierat återanvändnings- eller storleksbehov motiverar en egen komponent.

## Datamodell

Två tabeller används i `public`-schemat.

### `conversations`

| Kolumn            | Typ           | Kontrakt                                          |
| ----------------- | ------------- | ------------------------------------------------- |
| `id`              | `uuid`        | Primärnyckel, genereras i databasen               |
| `user_id`         | `uuid`        | Obligatorisk FK till `auth.users`, cascade delete |
| `title`           | `text`        | Obligatorisk, max 160 tecken                      |
| `created_at`      | `timestamptz` | Standard `now()`                                  |
| `updated_at`      | `timestamptz` | Uppdateras vid nytt meddelande                    |
| `last_message_at` | `timestamptz` | Används för sortering                             |

Kontrakt och index:

- unik constraint på `(id, user_id)` för säkra ägarskaps-FK:er,
- index på `(user_id, last_message_at desc, id)`.

### `messages`

| Kolumn            | Typ           | Kontrakt                                           |
| ----------------- | ------------- | -------------------------------------------------- |
| `id`              | `uuid`        | Primärnyckel, genereras i databasen                |
| `conversation_id` | `uuid`        | Del av sammansatt FK till konversationen           |
| `user_id`         | `uuid`        | Del av sammansatt FK och ägarskap                  |
| `turn_id`         | `uuid`        | Klientgenererad korrelations- och idempotensnyckel |
| `role`            | `text`        | Endast `user` eller `assistant`                    |
| `content`         | `text`        | Obligatorisk med rollspecifik validering           |
| `created_at`      | `timestamptz` | Standard `now()`                                   |

Kontrakt och index:

- sammansatt FK `(conversation_id, user_id)` till `conversations(id, user_id)` med cascade delete,
- unik constraint på `(user_id, turn_id, role)`,
- index på `(conversation_id, created_at, id)`,
- användarmeddelanden måste efter trimning innehålla 1–5 000 tecken; gränsen finns i UI, servervalidering och databas,
- assistentmeddelanden måste vara icke-tomma men delar inte användarmeddelandets databasgräns på 5 000 tecken; deras generering begränsas i stället av `max_output_tokens: 4096`.

Användarens och assistentens meddelande för samma samtalsrunda använder samma `turn_id`. Constrainten tillåter högst ett meddelande per roll och turn för samma användare och ger samtidigt ett index för retry-uppslag.

Vi lägger inte till en `turns`-tabell, statusfält, tool-payload, modelldata eller provider-id innan ett verifierat behov finns. `turn_id` ger idempotent persistens och korrelation, men är inte en serverlease och garanterar inte exakt ett modellanrop vid parallella requests.

## Åtkomst och RLS

- RLS aktiveras på båda tabellerna.
- Rollen `authenticated` får endast läsa rader där `(select auth.uid()) = user_id`.
- Klienten får inga policies eller grants för insert, update eller delete.
- `event.locals.supabase` är den befintliga sessionsbundna SSR-klienten med publishable key och användarens cookies/JWT. Remote queries använder den så att RLS verkställs för den autentiserade användaren.
- Alla mutationer sker med en separat admin-klient skapad via `@supabase/supabase-js` och `SUPABASE_SECRET_KEY` i en server-only modul. Den använder inte SSR-klienten, cookies eller användarsessioner och konfigureras med `persistSession: false`, `autoRefreshToken: false` och `detectSessionInUrl: false`.
- Admin-klienten får aldrig importeras i klientkod eller läggas på serialiserbar page-data. Den används endast av den smala serverägda persistensytan för `begin_chat_turn`, `commit_chat_turn` och radering.
- Varje mutation filtreras uttryckligen på både resurs-id och autentiserat `user_id`, även när servern använder secret key.
- Streaming-routen och remote functions ger `401` vid saknad identitet och `404` när en resurs inte tillhör användaren. De ska inte avslöja om någon annans resurs existerar.

Servern ska använda det befintliga auth-flödet från `src/hooks.server.ts` och lita på verifierade claims, inte klientstate.

## Serverkontrakt

### Streaming

`POST /api/chat/stream`

Request:

```json
{
	"conversationId": "valfritt uuid",
	"turnId": "klientgenererat uuid",
	"message": "användarens meddelande"
}
```

Validering:

- autentiserad användare krävs,
- `turnId` måste vara ett giltigt UUID,
- `message` trimmas och får inte vara tomt,
- maxlängd 5 000 tecken,
- ett angivet `conversationId` måste ägas av användaren,
- ett återanvänt `turnId` måste avse samma användare, konversation och meddelandeinnehåll; annars returneras `409`.

Fel som upptäcks innan det första stream-eventet returneras som vanlig JSON med korrekt HTTP-status och `Content-Type: application/json`:

- `400` för ogiltigt requestformat, UUID eller meddelandeinnehåll,
- `401` när verifierad identitet saknas,
- `404` när en angiven konversation inte tillhör användaren,
- `409` vid `turnId`-konflikt eller ett redan pågående eller tvetydigt turn.

En sådan respons använder inte NDJSON och skickar inget stream-event.

När det första stream-eventet skickas är HTTP-status redan låst till `200`. Därefter skickas svaret som newline-delimited JSON (`application/x-ndjson`) så att en vanlig `fetch` med POST kan läsa streamen. Vi exponerar ett litet eget kontrakt i stället för OpenAI:s provider-specifika event.

```json
{"type":"conversation","conversation":{"id":"...","title":"...","createdAt":"...","updatedAt":"...","lastMessageAt":"..."},"message":{"id":"...","conversationId":"...","turnId":"...","role":"user","content":"...","createdAt":"..."},"turnId":"..."}
{"type":"delta","turnId":"...","text":"Hej"}
{"type":"delta","turnId":"...","text":"!"}
{"type":"replace","turnId":"...","text":"Hej!"}
{"type":"done","turnId":"...","message":{"id":"...","conversationId":"...","turnId":"...","role":"assistant","content":"...","createdAt":"..."},"conversation":{"id":"...","title":"...","createdAt":"...","updatedAt":"...","lastMessageAt":"..."}}
```

`conversation` innehåller den sparade användarraden och den kompakta konversationssammanfattning som `begin_chat_turn` redan har returnerat. `done` innehåller motsvarande assistentrad och slutliga sammanfattning från `commit_chat_turn`. Klienten kan därför uppdatera sin lokala historik och list-cache utan en ny databasfråga. `replace` skickas endast om den lokala deltabufferten avviker från den slutförda responsens auktoritativa `output_text`. Klienten ersätter då den preliminära assistenttexten före `done`. Det normala flödet skickar endast `delta` och `done`.

Fel som inträffar efter att streamen har startat uttrycks i eventströmmen eftersom HTTP-status inte längre kan ändras:

```json
{
	"type": "error",
	"turnId": "...",
	"code": "upstream_error",
	"message": "Svaret kunde inte slutföras."
}
```

Tillåtna terminala felkoder i denna slice är `upstream_error`, `incomplete_response`, `timeout`, `empty_response` och `persistence_error`. De är produktkoder och exponerar inte providerfel, intern diagnostik eller meddelandeinnehåll.

#### Atomiska databasgränser

`begin_chat_turn` är en server-only databasoperation som körs i en kort transaktion. Den:

- verifierar eller skapar konversationen,
- hanterar `(user_id, turn_id)` idempotent,
- kontrollerar att ett återanvänt turn har samma konversation och innehåll,
- sparar användarmeddelandet exakt en gång,
- sätter den deterministiska titeln vid det första meddelandet,
- uppdaterar konversationens tidsstämplar,
- returnerar ett utfall, den sparade användarraden, en kompakt konversationssammanfattning och ett fryst historikunderlag för modellanropet.

Utfallet skiljer mellan `created`, `completed`, `pending` och `conflict`. Ett redan slutfört turn returnerar det sparade assistentmeddelandet. Ett pågående eller tvetydigt turn startar inte ett parallellt modellanrop. En konflikt ger `409`.

`commit_chat_turn` är en separat server-only databasoperation som körs efter fullbordad modellrespons. Den:

- verifierar användare, konversation och `turn_id`,
- sparar assistentsvaret exakt en gång,
- returnerar ett redan sparat meddelande om samma commit upprepas med samma innehåll,
- avvisar försök att skriva ett annat svar för ett redan slutfört turn,
- uppdaterar konversationens tidsstämplar,
- returnerar den sparade assistentraden och en kompakt konversationssammanfattning.

Ingen databastransaktion hålls öppen under OpenAI-anropet. Om databasgränserna implementeras som Postgres-funktioner ska de endast kunna anropas från servern: `EXECUTE` återkallas från `PUBLIC`, `anon` och `authenticated`, och servern skickar alltid det verifierade användar-id:t från `claims.sub`.

Serverflöde:

1. Läs `claims.sub` och validera requesten.
2. Anropa `begin_chat_turn`.
3. Vid `completed`: returnera det kanoniska, sparade svaret utan nytt modellanrop och avsluta med samma `turnId` och `messageId`.
4. Vid `pending` eller `conflict`: starta inget modellanrop och returnera korrekt fel.
5. Vid `created`: använd det returnerade historikunderlaget som modellinput.
6. Skicka `conversation`-eventet som kvitto på att användarmeddelandet är beständigt. Koppla därefter requestens abortsignal, tillsammans med serverns timeout, till upstream-anropet och kontrollera signalen före start.
7. Starta Responses API med `gpt-5.6-luna`, `reasoning: { effort: "low", context: "current_turn" }`, `prompt_cache_options: { mode: "explicit" }`, `max_output_tokens: 4096`, `truncation: "disabled"`, `stream: true`, `store: false` och utan tools eller cache-breakpoints.
8. Vid `response.output_text.delta`: skicka texten direkt till klienten och bygg samtidigt upp en preliminär deltabuffer i minnet.
9. Vid `response.completed`: hämta den slutförda responsens auktoritativa `output_text` och jämför den med deltabufferten. Vid avvikelse skickas `replace` och en innehållsfri diagnostisk mismatch-händelse loggas.
10. Kontrollera att abortsignalen inte har löst ut och anropa därefter `commit_chat_turn` med den auktoritativa finaltexten och samma `turn_id`.
11. Skicka `done` med `turnId` och det returnerade `messageId` först när `commit_chat_turn` lyckats.

Om OpenAI-streamen avbryts eller ger fel sparas inget partiellt assistentmeddelande. Användarmeddelandet ligger kvar så att det är tydligt vad som hände. Om modellen hann visas klart men slutlagringen misslyckas skickas ett persistensfel; UI:t ska då tala om att svaret inte sparades.

#### Modellresponsens terminalmodell

Varje modellförsök får hanteras som exakt ett terminalt utfall:

- `response.completed` med icke-tom `output_text`: jämför med deltabufferten, spara finaltexten och skicka `done`,
- `response.failed`: spara inget assistantsvar och skicka `upstream_error`,
- `response.incomplete`: spara ingen partiell text och skicka `incomplete_response`,
- upstream- eller transportfel: spara inget assistantsvar och skicka `upstream_error`,
- serverns timeout: avbryt upstream-anropet, spara inget assistantsvar och skicka `timeout`,
- klientabort, inklusive användarens manuella stopp: vidarebefordra requestens abortsignal till upstream-anropet, spara inget partiellt assistantsvar och förutsätt inte att ett fel-event kan nå den bortkopplade klienten,
- `response.completed` utan synlig, icke-tom `output_text`: spara inget assistantsvar och skicka `empty_response`,
- misslyckad `commit_chat_turn`: skicka `persistence_error` och aldrig `done`.

En terminal guard förhindrar dubbel hantering om exempelvis en abort och ett upstream-fel observeras samtidigt. Om aborten observeras före commit får den vinna och inget assistantsvar sparas. Om `commit_chat_turn` redan har slutförts när stoppet når servern är svaret däremot färdigt och ska inte raderas i efterhand. Utfallet loggas strukturerat med request-, conversation- och turn-id, status och tider, men utan prompt, deltas, finaltext eller providerfel som kan innehålla kunddata.

### Konversationer

Vanliga läsningar och mutationer implementeras som remote functions i `src/lib/features/chat/conversations.remote.ts`:

- `listConversations = query(...)` – lista användarens konversationer, senaste först.
- `getConversation = query(uuidSchema, ...)` – hämta en ägd konversation och dess meddelanden.
- `deleteConversation = command(uuidSchema, ...)` – radera en ägd konversation och dess meddelanden.

Varje funktion använder `getRequestEvent()` och den verifierade identiteten i `event.locals`; `user_id` tas aldrig emot som argument. Indata valideras med ett Standard Schema och returvärdena hålls små och serialiserbara.

Endast dessa tre exporter använder SvelteKits remote function-API direkt. Databasfrågor, ägarskapskontroller och mappning till returkontrakt läggs i server-only helpers som kan testas utan `$app/server`. En framtida SvelteKit-uppgradering görs uttryckligen tillsammans med typkontroll och remote function-tester, inte som en oavsiktlig följd av ett tillåtet semver-intervall.

Efter radering returnerar `deleteConversation` det raderade id:t och klienten filtrerar bort raden med `listConversations().set(...)`; ingen list-query körs om. Streaming-routen ligger utanför remote function-kontraktet. När klienten får ett `conversation`-event upsertas den returnerade konversationssammanfattningen i `listConversations()` med `.set(...)`. `done` upsertar den slutliga sammanfattningen på samma sätt. Modellfel, streamfel och persistensfel behöver ingen refresh eftersom `conversation`-eventet redan innehåller den sparade användarraden och korrekt metadata. Fel före en beständig turn ändrar inte cachen.

### Databasanropsbudget

Budgeten räknar nätverksrundor från appservern till Supabase/Postgres. Flera SQL-satser inne i en kort RPC-transaktion räknas som ett appdatabasanrop.

| Produktoperation                                | Högsta antal appdatabasanrop |
| ----------------------------------------------- | ---------------------------: |
| Lyckat nytt meddelande                          |                            2 |
| Avbrutet eller felande modellförsök efter begin |                            1 |
| Streamad delta                                  |                            0 |
| Retry av redan slutfört `turn_id`               |      1 och inget modellanrop |
| Lista konversationer                            |                            1 |
| Hämta konversation med meddelanden              |                            1 |
| Radera konversation med `ON DELETE CASCADE`     |                            1 |
| Skapa ny, ännu tom, konversation i UI           |                            0 |

Endast atomiska flerstegsoperationer använder RPC. Listning är en RLS-skyddad select, hämtning returnerar konversation och meddelanden i en request och radering är en ägarskapsfiltrerad delete med cascade och `RETURNING`. Det görs inga preflight-frågor, separata selects efter insert, per-delta-skrivningar, pollingfrågor eller automatiska cache-refreshes på sändningens hot path. `getClaims()` görs en gång vid requestgränsen och upprepas inte i chatthjälpare.

Det behövs ingen separat create-funktion i första versionen. “Ny konversation” återställer bara aktivt id i klienten; raden skapas av streaming-routen vid första skickade meddelandet.

## Konversationsstate för modellen

Trace skickar synliga `user`- och `assistant`-meddelanden från Supabase som historik. `reasoning.context: "current_turn"` innebär att Luna kan använda denna synliga konversation, men inte återanvänder opaka reasoning-items från tidigare turns.

Detta är ett avsiktligt text-only-kontrakt:

- `messages.content` är den kanoniska konversationshistoriken,
- tidigare synliga meddelanden återspelas som modellinput,
- `response.output` sparas inte som continuation-payload,
- krypterade reasoning-items sparas eller återspelas inte,
- `previous_response_id` används inte,
- Luna resonerar på nytt för varje svar utifrån den synliga historiken.

Vi använder inte GPT-5.6-standardläget `all_turns`, eftersom det med `store: false` skulle kräva att samtliga tidigare response output-items, inklusive krypterad reasoning-state, sparades och återspelades. `reasoning.context` ska anges uttryckligen i varje request och det effektiva värdet i den slutliga responsen ska verifieras som `current_turn`.

## Historik- och outputbudget

Modellinput byggs deterministiskt och får aldrig kapas mitt i ett meddelande eller en tidigare turn:

1. Den korta, stabila systeminstruktionen reserveras först.
2. Det aktuella användarmeddelandet inkluderas alltid.
3. Därefter läggs tidigare synliga turns till från nyast till äldst. En sådan enhet består av `user` och, om det finns, efterföljande `assistant` med samma `turn_id`. Ett ensamt assistentmeddelande är aldrig giltig historik.
4. Urvalet stoppas innan nästa hela turn skulle överskrida 20 `turn_id` inklusive aktuell turn eller 48 000 tecken totalt.
5. Det valda underlaget skickas till modellen i kronologisk ordning.

En aktuell, ännu ofullbordad turn och högst 19 tidigare turns innebär högst 39 faktiska meddelanden. Ett användarmeddelande vars svar avbröts eller misslyckades ingår därför i senare synlig modellhistorik precis som det gör i gränssnittet. Ingen summering eller långtidsminne införs nu.

Teckenbudgeten är ett enkelt produktkontrakt för förutsägbar latens och kostnad, inte modellens tekniska contextgräns. Den kräver inget extra tokenräkningsanrop före streamingen. Faktisk token usage loggas efter genomförda anrop så att budgeten kan kalibreras senare.

`max_output_tokens: 4096` begränsar modellens samlade reasoning- och outputtokens. `truncation: "disabled"` gör att ett kontraktsfel ger ett synligt fel i stället för att providern tyst tar bort äldre input. Varken modellinput, streamad output eller lagrad assistenttext får trunkeras tyst.

## Datahantering och lanseringsgate

Supabase är Traces kanoniska källa för konversationsstate. `store: false` innebär att Trace inte använder OpenAI:s application-state för att spara eller fortsätta konversationer. Det är däremot inte samma sak som Zero Data Retention: beroende på OpenAI-organisationens och projektets datakontroller kan kundinnehåll fortfarande behandlas tillfälligt, exempelvis i abuse-monitoring-loggar.

Den första versionen anger `prompt_cache_options: { mode: "explicit" }` men inga `prompt_cache_breakpoint`. Därmed används ingen implicit prompt cache. Detta är ett avsiktligt beslut om dataminimering och förutsägbar kostnad; caching kan införas senare först för ett stabilt, mätbart återanvänt prefix.

Avgränsningen gäller strukturerad data, inte all hälsodata:

- modellen får endast använda information som uttryckligen finns i den skickade konversationen,
- modellen har ingen åtkomst till Traces journal, vikt-, mat- eller måltidstabeller,
- modellen får inte påstå att den har läst, sparat eller ändrat kontodata,
- text som användaren skriver kan innehålla hälsodata och skickas då till OpenAI samt sparas som konversationsdata i Supabase.

Innan chatten görs tillgänglig för andra användare ska en uttrycklig lanseringsgate verifiera och godkänna OpenAI-projektets datakontroller, produktens information till användaren och den avsedda externa behandlingen av eventuell hälsodata. Gaten behöver inte blockera lokal end-to-end-utveckling.

## Modellinstruktion

`product.md` är produktkällan men skickas aldrig i sin helhet till modellen. Före implementationen destilleras relevanta delar manuellt till en kort, versionsstyrd konstant i den serverägda chattfunktionen. Målet för denna slice är högst cirka 1 200 tecken och endast instruktioner som motsvarar funktioner som faktiskt finns.

Systeminstruktionen ska vara kort och stabil:

- modellen är Trace och hjälper användaren genom vanlig konversation,
- den svarar på användarens språk, med svenska som naturligt utgångsläge i den svenska produkten,
- den får använda hälsoinformation som användaren uttryckligen har skrivit i den skickade konversationen, men ska inte påstå att den har åtkomst till eller har läst eller sparat information i Traces journal,
- den ska inte ställa diagnos, göra en personlig orsaksbedömning eller ge en ordination eller behandlingsplan,
- den ska inte påstå att den kan utföra handlingar eller använda verktyg; en begäran om journalhandling besvaras kort och deterministiskt med att funktionen ännu inte finns,
- den svarar i vanlig text utan Markdown,
- den ska ha en kort och tydlig säkerhetsgräns för akuta situationer.

Vi inför inte en stor domänprompt, ett dynamiskt promptbyggarsystem eller instruktioner för framtida funktioner. Prompten utökas och utvärderas först när journaloperationer, tool calls eller andra verifierade förmågor läggs till.

Varje modellanrop skickar en stabil, integritetsskyddad `safety_identifier` som beräknas server-side från den verifierade användaridentiteten:

```text
trace-safety-v1:<base64url(HMAC-SHA256(claims.sub))>
```

HMAC-nyckeln läses från den separata serverhemligheten `TRACE_SAFETY_HMAC_KEY` och får inte återanvända Supabase- eller OpenAI-nyckeln. Ett fullständigt SHA-256-resultat kodas som base64url utan padding; med prefixet blir identifieraren 59 tecken och håller sig inom API-gränsen på 64 tecken. Rått Supabase-id, e-post och användarnamn skickas inte till OpenAI som identifierare. Värdet beräknas vid varje request och behöver inte lagras i databasen eller loggas. Vid en framtida nyckelrotation höjs versionsprefixet.

## Klientbeteende

Den befintliga in-memory-chatten i `ConversationSheet.svelte` byts stegvis mot detta beteende:

- Ladda sparad historik när panelen eller en konversation öppnas.
- Kontrollera `response.ok` och felresponsens JSON innan `response.body` behandlas som NDJSON.
- Visa användarmeddelandet optimistiskt efter att requesten har startat.
- Skapa ett `turnId` med `crypto.randomUUID()` när användaren skickar och behåll samma värde för retry av samma request.
- Skapa en tillfällig assistentrad och fyll på den för varje `delta`.
- Ersätt den tillfälliga assistenttexten om ett `replace`-event kommer före `done`.
- Korrelera provisoriska och sparade meddelanden med `turnId`.
- Markera turnen som beständig när `conversation`-eventet tas emot och upserta eventets konversationssammanfattning direkt i list-cachen utan refresh.
- Skapa en `AbortController` per pågående turn och skicka dess signal med streaming-requesten.
- Ersätt skicka-knappen med en stoppkontroll medan svaret pågår. Stoppkontrollen ska ha den tillgängliga etiketten “Avbryt svar”.
- Om användaren stoppar före `conversation`-eventet registrerar klienten först önskemålet, väntar in kvittot på att användarmeddelandet är sparat och aborterar därefter requesten omedelbart. Därmed kan ett snabbt stopp inte radera eller lämna det skickade användarmeddelandet enbart lokalt.
- Vid manuellt stopp tas den preliminära assistentraden bort, användarmeddelandet ligger kvar och klienten visar högst en liten lokal bekräftelse som “Svaret avbröts.” Ingen sådan status sparas som ett meddelande.
- Sätt `maxlength="5000"` på composern och validera samma gräns i submit-flödet.
- Visa ingen löpande teckenräknare. När gränsen är uppnådd visas endast det korta meddelandet “Meddelandet får vara högst 5 000 tecken.”
- Avbryt klientens request om panelen förstörs eller konversationen byts. Denna livscykelstädning delar abortmekanism med manuellt stopp men behöver inte visa bekräftelsen “Svaret avbröts.”
- Visa ett enkelt fel i chatten utan att skapa ett sparat assistentmeddelande.
- “Ny konversation” tömmer aktiv historik och aktivt konversations-id.
- Listan “Konversationer” hämtar sparade konversationer och låter användaren välja eller radera en.

Ingen automatisk retry, edit, regenerate, branching eller parallell stream byggs i denna version. Kontraktet stöder däremot en explicit transport-retry med samma `turnId`.

## Fel, avbrott och konsekvens

- Ett OpenAI-fel efter att användarmeddelandet sparats lämnar bara användarmeddelandet i historiken.
- Endast `response.completed` med icke-tom finaltext får anropa `commit_chat_turn`; failed, incomplete, timeout, klientabort och tom output sparar inget assistantsvar.
- Auth-, validerings-, ägarskaps- och turnkonflikter före första stream-eventet returneras som vanlig JSON med korrekt HTTP-status; de maskeras aldrig som `200` med ett error-event.
- Fel efter första stream-eventet skickas som ett korrelerat NDJSON `error`, eftersom HTTP-status då redan är skickad.
- `conversation`-eventet uppdaterar konversationslistan direkt även om inget efterföljande `done` skickas.
- Ett nätverksavbrott i webbläsaren avbryter läsningen. Inget partiellt assistentsvar sparas.
- Ett manuellt stopp behandlas inte som ett generiskt chattfel: den preliminära assistenttexten tas bort, den redan beständiga användartexten behålls och upstream-requesten avbryts.
- Om stoppet och en redan påbörjad eller slutförd commit möts i en race får en genomförd commit inte rullas tillbaka eller raderas. Stoppkontrollen försvinner när klienten tar emot det terminala utfallet.
- Ett misslyckat save efter avslutad modellstream visas explicit för användaren; servern skickar inte `done`.
- Den unika constrainten på `(user_id, turn_id, role)` förhindrar dubbla meddelanderader för samma retry.
- Ett befintligt assistentsvar för samma `turnId` återanvänds och ska inte utlösa ett nytt modellanrop.
- Ett användarmeddelande utan assistentsvar är ett tvetydigt läge. Utan serverlease startas inte ett automatiskt parallellt modellanrop för samma `turnId`.
- Klientlåset begränsar en pågående request per konversation i den aktuella klienten, men olika `turnId` från flera flikar är en accepterad MVP-begränsning.
- API:t loggar request-id, conversation-id, status och tider, men aldrig meddelandeinnehåll eller hemligheter.

Mätpunkter som loggas strukturerat är `auth_ms`, `db_begin_ms`, `openai_ttft_ms`, `openai_total_ms`, `db_commit_ms`, `db_round_trips` samt token usage när det finns tillgängligt. Tester ska bevaka att ett lyckat nytt meddelande använder exakt två appdatabasanrop och att inga databasoperationer sker för deltas.

## Leverans i tre verifierbara delar

### Del 1 – Persistenskontrakt

- Genomför och verifiera den separata, irreversibla avvecklingsmigrationen för Trace v2:s konversationsdata och runtime.
- Lägg därefter till migration för de kanoniska tabellerna `public.conversations` och `public.messages`.
- Lägg till `turn_id`, unik retry-constraint, övriga constraints, index, grants och RLS.
- Lägg till de server-only atomiska databasgränserna `begin_chat_turn` och `commit_chat_turn`.
- Lägg till en liten server-only datamodul för read, list och delete.
- Verifiera ägarskap och cross-user-isolering innan nästa del.

### Del 2 – En fungerande streamad konversation

- Lägg till den officiella OpenAI-SDK:n med låst version.
- Destillera den korta första systemprompten från `product.md` och håll den serverägd och versionsstyrd.
- Skapa server-only OpenAI-klient och streaming-route.
- Koppla composer och meddelandelista till NDJSON-streamen.
- Verifiera att första texten visas före slutfört svar och att events uppdaterar historik och list-cache utan refresh.

### Del 3 – Konversationshantering

- Lägg till `query()` för att lista och hämta konversationer.
- Lägg till `command()` för att radera en konversation och uppdatera list-queryns cache utan ny databasfråga.
- Koppla listan “Konversationer” till remote functions.
- Implementera ny, välj och radera i klienten.
- Lägg till deterministisk titel från första användarmeddelandet.
- Verifiera responsivt beteende i de redan valda brytpunkterna.

Varje del ska fungera end-to-end och ha passerat relevanta tester innan nästa del börjar.

## Verifieringskriterier

Funktionen är klar när följande är sant:

- Oautentiserad streaming-request ger `401`.
- Ogiltig input, saknad identitet, okänd eller oägd konversation och turnkonflikt före streamstart ger vanlig JSON med respektive `400`, `401`, `404` eller `409`.
- Efter första stream-eventet uttrycks modell-, stream- och persistensfel som NDJSON `error`; servern försöker inte ändra HTTP-status.
- En användare kan inte läsa, skriva till eller radera en annan användares konversation.
- RLS-tester med den sessionsbundna klienten verifierar att en användare inte kan läsa en annan användares rader.
- Separata mutationstester med admin-klienten verifierar att de uttryckliga `user_id`-filtren hindrar operationer mot en annan användares rader trots att secret key kringgår RLS.
- Första textdelen visas medan modellen fortfarande streamar.
- Ingen assistentrad finns i databasen under pågående streaming.
- En komplett assistentrad sparas efter `response.completed` och före `done`.
- Den sparade assistenttexten kommer från den slutförda responsens `output_text`, inte från den lokalt konkatenerade deltabufferten.
- Deltabufferten jämförs med finaltexten; en avvikelse korrigerar klientens preliminära text med `replace` och loggas utan meddelandeinnehåll.
- Varje modellrequest anger `reasoning.context: "current_turn"`, och den slutliga responsen bekräftar samma effektiva context.
- Vanliga följdfrågor fungerar från den återspelade synliga historiken utan sparade reasoning-items.
- Aktuell användarfråga finns alltid i modellinput och tidigare historik kapas endast vid hela `turn_id`-gränser.
- Modellinput innehåller högst 20 `turn_id` och högst 48 000 tecken inklusive systeminstruktionen.
- Varje modellanrop använder `max_output_tokens: 4096` och `truncation: "disabled"`.
- Varje modellanrop använder `store: false` och `prompt_cache_options: { mode: "explicit" }` utan cache-breakpoints.
- Varje modellanrop skickar samma 59 tecken långa, versionsmärkta HMAC-baserade `safety_identifier` för samma användare, olika värden för olika användare och aldrig rått `claims.sub`.
- `TRACE_SAFETY_HMAC_KEY` är endast tillgänglig server-side, återanvänds inte som annan applikationsnyckel och förekommer inte i klientbundlar eller loggar.
- Modellen använder endast den skickade konversationstexten och påstår inte att den har åtkomst till strukturerad journal- eller kontodata.
- Den skickade systemprompten är destillerad från `product.md`, högst cirka 1 200 tecken och innehåller inga instruktioner för ännu ej implementerade förmågor.
- En begäran om att läsa eller ändra journalen får ett kort, deterministiskt begränsningssvar.
- Klienten stoppar input över 5 000 tecken och visar gränsmeddelandet utan en löpande räknare. Samma request avvisas även av servern om klientkontrollen kringgås.
- Avbruten eller felande modellstream sparar inget partiellt assistentsvar.
- Ett manuellt stopp efter mottagna deltas aborterar samma upstream-request, tar bort den preliminära assistentraden och lämnar exakt ett sparat användarmeddelande utan assistentsvar.
- Ett stopp som trycks före `conversation`-eventet verkställs direkt efter persistenskvittot; inget modellanrop fortsätter därefter och användarmeddelandet finns kvar i eventuppdaterad klientstate och vid nästa explicita hämtning.
- Ett avbrutet användarmeddelande ingår som en user-only-turn i modellhistoriken när användaren senare skickar ett nytt meddelande.
- Racet mellan abort och commit är deterministiskt: observerad abort före commit sparar inget svar, medan en redan slutförd commit behålls.
- Mockade `response.failed`, `response.incomplete`, timeout, klientabort och completed med tom output ger rätt produktutfall, anropar inte `commit_chat_turn` och skickar aldrig `done`.
- Samtidig abort och upstream-fel hanteras endast en gång av terminal guarden.
- Ett modell-, stream- eller persistensfel efter `conversation`-eventet kräver ingen databas-refresh och visar den redan sparade konversationen och användartexten.
- Ett requestfel före en beständig turn uppdaterar inte konversationslistans cache.
- Samma request med samma `turnId` skapar inte ett andra användarmeddelande.
- Retry efter lyckad commit returnerar samma assistentmeddelande utan ett nytt modellanrop.
- Återanvändning av samma `turnId` med annat innehåll eller annan konversation ger `409`.
- Alla conversation-, delta-, error- och done-events kan korreleras med rätt `turnId`.
- Ett eventuellt replace-event kan korreleras med rätt `turnId` och följs aldrig av `done` innan finaltexten har sparats.
- Ett fel inne i `begin_chat_turn` lämnar varken en tom konversation, ett ensamt nytt meddelande eller felaktiga tidsstämplar.
- Ett fel inne i `commit_chat_turn` lämnar varken ett ensamt assistentmeddelande eller felaktiga tidsstämplar.
- Ingen databastransaktion hålls öppen under modellanropet.
- Ett lyckat nytt meddelande gör exakt två appdatabasanrop, ett avbrutet eller felande modellförsök efter begin exakt ett och varje streamad delta noll.
- Refresh visar exakt den sparade historiken.
- Den budgeterade historiken skickas i korrekt kronologisk ordning utan lösa assistentsvar eller tyst trunkering.
- Ny, lista, välj och radera konversation fungerar.
- OpenAI-nyckeln och Supabase secret key förekommer inte i klientbundlen.
- `pnpm check` och projektets relevanta tester passerar.
- Databasens RLS- och prestandakontroller visar inga nya relevanta problem.
- Trace v2:s konversationstabeller, data och beroende runtime-objekt är borttagna utan kvarvarande trasiga beroenden innan de nya tabellerna skapas.

OpenAI-streamen ska testas med en kontrollerad mock som skickar flera deltas, completion och fel. Databastesterna ska täcka RLS och sammansatt ägarskap med två separata användare.

## Utanför scope

- tools och tool calls,
- vikt, mat, måltider och andra hälsodomäner,
- strukturerad tolkning eller dataskrivning från modellen,
- embeddings, minnen och semantisk sökning,
- filer, bilder, röst och realtime,
- AI-genererade titlar,
- automatisk summering av långa konversationer,
- edit, retry, regenerate och konversationsgrenar,
- migrering av Trace v2-konversationer,
- bakgrundsjobb och avancerad köhantering.

Rate limiting, innehållsmoderering, en fastställd retention-policy och lanseringsgaten för extern behandling av eventuell hälsodata måste vara beslutade före bred produktionslansering, men behöver inte blockera den första lokala end-to-end-versionen.

## Officiella referenser

- [OpenAI – Model guidance för gpt-5.6-luna](https://developers.openai.com/api/docs/guides/model-guidance?model=gpt-5.6-luna)
- [OpenAI – Streaming responses](https://developers.openai.com/api/docs/guides/streaming-responses?api-mode=responses)
- [OpenAI – Conversation state](https://developers.openai.com/api/docs/guides/conversation-state)
- [OpenAI – Safety identifiers](https://developers.openai.com/api/docs/guides/safety-best-practices#implement-safety-identifiers)
- [Supabase – Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
