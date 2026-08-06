# Feedback på planen för AI-chatt

Status: dokumenterad för bedömning. Punkterna i detta dokument är feedback och ändrar inte huvudplanens låsta beslut förrän de uttryckligen accepteras.

## Beslutsstatus

- Punkt 1, minimalt `turn_id`: accepterad och införd i huvudplanen 2026-08-06.
- Punkt 2, atomiska begin/commit-gränser: accepterad och införd i huvudplanen 2026-08-06.
- Punkt 3, explicit modellstate: alternativ A med `reasoning.context: "current_turn"` är accepterat och infört i huvudplanen 2026-08-06. `reasoning.effort: "low"` behålls.
- Punkt 4, kombinerad historik- och outputbudget: accepterad och införd i huvudplanen 2026-08-06. Aktuell fråga plus högst 19 tidigare kompletta turns, 48 000 tecken total inputbudget, högst 5 000 tecken per användarmeddelande, `max_output_tokens: 4096` och ingen automatisk trunkering.
- Punkt 5, lagring, retention och hälsodata: accepterad och införd i huvudplanen 2026-08-06. `store: false`, explicit cacheläge utan breakpoints, korrekt avgränsning till strukturerad journaldata och en stängd lanseringsgate för extern behandling av eventuell hälsodata.
- Punkt 6, leveransen som infrastrukturslice: accepterad och införd i huvudplanen 2026-08-06. Chatten visas med tydliga begränsningar efter lanseringsgaten, utan en separat feature flag. Den första systemprompten ska vara en kort destillation av `product.md`; större promptoptimering väntar tills journaloperationer och tools finns.
- Punkt 7, tabellnamnsmigreringen: accepterad och införd i huvudplanen 2026-08-06. De nya tabellerna blir `public.conversations` och `public.messages`. Trace v2:s konversationsdata och beroende runtime avvecklas först i en separat, verifierad och irreversibel migrering; ingen v2-data migreras till v3.
- Mindre korrigering, auktoritativ finaltext: accepterad och införd i huvudplanen 2026-08-06. Deltas används för preliminär UI-state, medan den slutförda responsens `output_text` sparas. En mismatch korrigeras med ett innehållsfritt diagnostiserat `replace`-event.
- Mindre korrigering, konversationslistan vid fel: accepterad och införd i huvudplanen 2026-08-06. Efter ett beständigt `conversation`-event uppdateras listan exakt en gång i klientens `finally`, även när försöket avslutas utan `done`.
- Mindre korrigering, HTTP-fel kontra streamfel: accepterad och införd i huvudplanen 2026-08-06. Före första stream-eventet används vanlig JSON med korrekt HTTP-status; därefter används korrelerade NDJSON `error`-event.
- Mindre korrigering, modellens hela livscykel: accepterad och införd i huvudplanen 2026-08-06. Endast completed med icke-tom finaltext får committas; failed, incomplete, upstreamfel, timeout, klientabort, tom output och persistensfel har uttryckliga terminala utfall utan partiellt assistantsvar.
- Mindre korrigering, klientlåsets begränsning: accepterad som en dokumenterad MVP-begränsning och införd i huvudplanen 2026-08-06. Låset gäller aktuell klientinstans; olika flikar kan fortfarande starta olika turns utan en serverägd lease.
- Produktkrav, manuellt avbryt: accepterat och infört i huvudplanen 2026-08-06. Stopp väntar vid behov in persistenskvittot, aborterar klientstreamen och upstream-anropet, behåller användarmeddelandet och sparar ingen partiell assistenttext.
- Mindre korrigering, låst SvelteKit-version: accepterad och införd i projektet och huvudplanen 2026-08-06. `@sveltejs/kit` är exakt låst till `2.70.2`, och remote function-ytan begränsas till tre små exporter med server-only helpers bakom sig.
- Mindre korrigering, separata Supabase-klienter: accepterad och införd i huvudplanen 2026-08-06. Sessionsklienten används för RLS-skyddade läsningar; en separat server-only admin-klient används för mutationer med obligatoriska ägarskapsfilter. RLS och adminfiltren verifieras i separata tester.
- Mindre korrigering, HMAC-baserad `safety_identifier`: accepterad och införd i huvudplanen 2026-08-06. Formatet är `trace-safety-v1:<base64url(HMAC-SHA256(claims.sub))>` med en separat serverhemlighet; base64url håller hela värdet inom API-gränsen på 64 tecken.
- Övriga punkter: ännu inte beslutade.

## Samlad bedömning

Planen bedöms som stark, disciplinerad och betydligt mindre än Trace v2:s runtime. Den undviker spekulativa tabeller, provider-state, verktygskontrakt och annan arkitektur innan den behövs.

Rekommendationen i feedbacken är ändå **godkänn med ändringar**. Som intern infrastrukturslice anses planen bra, men som första produktversion för tunn. De största tekniska invändningarna gäller:

1. säker turn-korrelation och idempotens,
2. atomiska databasgränser,
3. ett uttryckligt beslut om GPT-5.6:s konversationsstate,
4. budgetering av input och output,
5. en mer exakt beskrivning av providerlagring och hälsodata.

## Beslut som feedbacken vill behålla

- En vanlig SvelteKit-route för POST-streaming och remote functions för övrig data.
- NDJSON i stället för att exponera OpenAI:s eventformat för klienten.
- Användarmeddelandet sparas före modellanropet.
- Assistentmeddelandet sparas först efter fullbordad modellrespons.
- `done` skickas först när svaret är varaktigt sparat.
- Supabase är Traces kanoniska konversationsdatabas.
- Ingen tom konversation skapas när användaren bara öppnar “Ny konversation”.
- Ingen AI-genererad titel, summering, branching eller provider-payload i första versionen.
- Ägarskap hämtas från verifierade claims, aldrig från klientens `user_id`.
- Den sammansatta foreign keyn `(conversation_id, user_id)` behålls som extra ägarskapsskydd.
- Inga partiella assistentsvar sparas.

Detta ger ett tydligt commit-kontrakt: texten på skärmen är preliminär fram till `done` och blir därefter kanonisk.

## 1. Lägg till ett minimalt `turn_id`

Feedbacken föreslår att beslutet att helt sakna `turn_id` ändras. Det behövs inte en separat turn-tabell eller Trace v2:s runtime, men varje användarfråga och tillhörande assistentsvar bör ha en gemensam korrelations- och idempotensnyckel.

Problemet som ska lösas är den tvetydiga commit-zonen:

1. Assistentmeddelandet sparas.
2. Nätverket bryts innan klienten får `done`.
3. Klienten kan inte veta att commit lyckades.
4. Användaren försöker igen.
5. Samma användarmeddelande och modellkörning riskerar att skapas igen.

Föreslaget requestkontrakt:

```json
{
	"conversationId": "valfritt uuid",
	"turnId": "klientgenererat uuid",
	"message": "användarens meddelande"
}
```

Föreslagen kolumn och constraint:

```text
messages.turn_id uuid not null
unique (user_id, turn_id, role)
```

Både användarens och assistentens meddelande använder samma `turn_id`.

Förväntade vinster:

- Retry av samma request skapar inte ett nytt användarmeddelande.
- Retry efter lyckad commit kan returnera det redan sparade svaret.
- `done` kan korreleras till rätt turn.
- Användarmeddelanden utan assistentsvar kan identifieras.
- Historiken kan begränsas vid hela turngränser.
- Klienten kan återhämta sig efter tappad anslutning.
- Tester kan uttrycka exakt vilket meddelande ett assistentsvar hör till.

Föreslaget eventkontrakt:

```json
{"type":"conversation","conversationId":"...","turnId":"..."}
{"type":"delta","turnId":"...","text":"Hej"}
{"type":"done","turnId":"...","messageId":"..."}
```

En separat `turns`-tabell behövs inte förrän det finns verkliga behov av exempelvis lease, status, parallella körningar eller tools.

## 2. Gör början och slutet atomiska

Skapande/verifiering av konversation, sparande av användarmeddelande, titel och tidsstämplar bör inte vara flera oberoende PostgREST-anrop. Det kan annars uppstå exempelvis en tom konversation eller inkonsekvent `last_message_at`.

Feedbackens föreslagna flöde är:

```text
begin_chat_turn
→ Luna
→ commit_chat_turn
```

### `begin_chat_turn`

En atomisk databasoperation som:

- verifierar eller skapar konversationen,
- slår upp ett befintligt `turnId`,
- kontrollerar att ett retryat turn har samma innehåll,
- sparar användarmeddelandet idempotent,
- sätter titel vid första meddelandet,
- uppdaterar konversationens tidsstämplar,
- returnerar konversationen och ett fryst, budgeterat historikunderlag.

### `commit_chat_turn`

En atomisk databasoperation som:

- verifierar att turnet tillhör användaren och konversationen,
- sparar assistentsvaret exakt en gång,
- uppdaterar konversationens tidsstämplar,
- returnerar assistentmeddelandets id.

Ingen databastransaktion ska hållas öppen under modellanropet. Flödet består fortfarande bara av två databasgränser och ett Luna-anrop.

## 3. Bestäm hur GPT-5.6-state ska hanteras

Feedbacken invänder mot att kombinera `store: false` med att endast återspela synliga `user`- och `assistant`-texter utan att uttryckligen välja modellens reasoning-context.

När Responses-state hanteras manuellt kan full kontinuitet kräva att tidigare response output-items, inklusive krypterade reasoning-items, återspelas. Om endast sluttext sparas behöver det därför vara ett medvetet text-only-beslut.

### Alternativ A – avsiktligt text-only

Föreslagen inställning:

```ts
reasoning: {
  effort: 'low',
  context: 'current_turn'
}
```

Konsekvensen är att endast synlig konversation återspelas. Detta ska testas med representativa följdfrågor, korrigeringar och pronomenreferenser.

Feedbacken föreslår även ett litet eval mellan:

```text
reasoning effort: none
mot
reasoning effort: low
```

Modellvalet `gpt-5.6-luna` behålls, men effort bör enligt feedbacken låsas efter eval av kvalitet och latens.

### Alternativ B – full Responses-kontinuitet

Spara modellens återspelbara `response.output` som en opak, serverägd continuation-payload för varje assistant-turn och skicka tillbaka output-items i nästa request.

Detta kan ge bättre modellkontinuitet men inför provider-specifik state. Feedbacken rekommenderar alternativ A för den första slicen, under förutsättning att beslutet är uttryckligt och testat.

Det som ska undvikas är att använda ett standardläge för kontinuitet över alla turns samtidigt som nödvändig kontinuitetsstate tyst kastas bort.

## 4. Kombinera meddelandegräns med en inputbudget

En gräns på 40 meddelanden är inte tillräcklig eftersom varje användarmeddelande enligt planen kan vara upp till 16 384 tecken. Fyrtio sådana meddelanden kan tillsammans innehålla 655 360 tecken.

Föreslagen formulering:

> Högst de senaste 40 meddelandena från hela turn, begränsade av en separat inputbudget. Det aktuella användarmeddelandet inkluderas alltid.

Urvalet ska alltså begränsas av både:

```text
max antal meddelanden
och
max inputtokens eller max tecken
```

Historiken får inte börja med ett löst assistentsvar från ett halvt turn. Ett `turn_id` gör kapning vid hela turngränser möjlig.

Planen bör också ange `max_output_tokens`. Assistentens maximala output måste rymmas i databasens `content`-constraint. Alternativen är:

- generösare lagringsgräns för assistentmeddelanden än användarmeddelanden, eller
- en outputgräns som säkert ryms inom samma constraint.

Tyst trunkering efter streaming ska aldrig användas.

## 5. Förtydliga lagring, retention och hälsodata

Formuleringen:

> Supabase är den enda beständiga källan för konversationerna.

föreslås ersättas med:

> Supabase är Traces kanoniska källa för produktens konversationsstate. Trace skapar ingen providerägd konversationsstate och använder `store: false`.

Skälet är att `store: false` stänger av vanlig Responses application-state men inte automatiskt innebär Zero Data Retention. Beroende på organisationens inställningar kan exempelvis abuse-monitoring-loggar och prompt caching innebära annan eller tillfällig providerlagring.

Feedbacken föreslår att följande GPT-5.6-inställning övervägs:

```ts
prompt_cache_options: {
	mode: 'explicit';
}
```

Syftet är att undvika implicit promptcache när inga explicita cache-breakpoints används.

Planen ska dessutom skilja mellan:

```text
ingen åtkomst till strukturerad journaldata
```

och:

```text
ingen behandling av hälsodata
```

Den senare formuleringen är för absolut. Användaren kan själv skriva vikt, symtom, mat eller annan hälsodata i chatten, och då behandlar Trace och modellen texten. Begränsningen är att denna slice inte läser eller ändrar den strukturerade journalen.

Feedbacken noterar också att en uttrycklig gate för extern behandling av hälsodata måste vara stängd innan funktionen görs tillgänglig för andra användare.

## 6. Beskriv leveransen som en infrastrukturslice

Feedbacken föreslår en tydligare titel, exempelvis:

> Grund för autentiserad, sparad och streamad konversation i Trace v3

Motiveringen är att Trace-produktens kärna är den intelligenta journalen och evidensmotorn. Konversationen är ett gränssnitt till den produkten, inte i sig dess huvudsakliga värde.

Två möjliga produktval föreslås:

1. Håll slicen bakom en utvecklingsflagga tills den första `journal.records`-operationen finns.
2. Visa den öppet men gör begränsningen mycket tydlig och ge journalhandlingar ett deterministiskt svar om att de ännu inte kan utföras.

Systeminstruktionen bör enligt feedbacken även uttryckligen ange:

- ingen diagnos,
- ingen personlig orsaksbedömning,
- ingen ordination eller behandlingsplan,
- ingen antydan om åtkomst till sparad journal,
- inga påståenden om att något har sparats eller utförts,
- ren text utan Markdown när UI:t inte renderar Markdown.

Modellen får använda information som uttryckligen finns i den skickade konversationen men ska inte påstå att den har åtkomst till Traces journal eller annan kontodata.

## 7. Separera tabellnamnsmigreringen från chattslicen

Feedbacken accepterar `conversations` och `messages` som kanoniska tabellnamn men invänder mot att `public`-schemat behandlas som en produktprincip.

Ett alternativ är:

```text
chat.conversations
chat.messages
```

Tabellernas kanoniska namn är då fortfarande `conversations` och `messages`, medan schemat fungerar som teknisk namnrymd.

Om tabellerna ska ligga i `public` bör migreringen som frigör `conversations` vara en separat ADR och leverans med:

- full beroendekartläggning,
- exakt beslut om rename, arkivering eller borttagning,
- verifiering av gamla foreign keys, views, triggers och funktioner,
- radantal och integritetskontroller före och efter,
- dokumenterad rollback,
- tydlig formulering att v2-data inte semantiskt migreras till v3-chatten.

Feedbacken pekar på en möjlig feltolkning eftersom huvudplanen både kräver att ett befintligt namn frigörs och samtidigt placerar migrering av v2-konversationer utanför scope.

## Mindre men viktiga korrigeringar

### Spara den auktoritativa finaltexten

Deltabufferten används för UI:t, men databasen bör sparas från den slutliga responsens auktoritativa `output_text`, inte enbart från lokalt konkatenerade deltas. I tester kan deltabufferten jämföras med finaltexten.

### Uppdatera konversationslistan även vid fel

Användarmeddelandet är redan sparat när modellanropet startar. Om modellen därefter misslyckas finns konversationen och användarmeddelandet i databasen trots att inget `done` skickas. List-queryn behöver därför uppdateras även efter fel, exempelvis i ett `finally`-flöde.

### Skilj HTTP-fel från streamfel

Före det första stream-eventet ska fel returneras som vanlig JSON med korrekt HTTP-status, exempelvis:

```text
400
401
404
409
```

Efter att streamen har startat är HTTP-status redan skickad. Fel behöver då uttryckas i eventströmmen:

```json
{ "type": "error", "turnId": "...", "code": "persistence_error" }
```

### Hantera hela modellens livscykel

Streaming-routen bör uttryckligen hantera:

- completion,
- failed response,
- incomplete response,
- upstream error,
- timeout,
- klientabort,
- tom användarvänd output.

Det räcker inte att bara reagera på textdelta och `response.completed`.

### Dokumentera klientlåsets begränsning

“Inget parallellt svar per konversation” gäller endast den aktuella klientinstansen. Två flikar kan starta två olika turns samtidigt.

Detta kan accepteras och dokumenteras för en privat lokal MVP. Före en bredare lansering behövs en serverägd lease eller atomisk claim som ger `409` när ett turn redan är aktivt.

### Lås SvelteKit-versionen

Remote functions passar arkitekturen och `.updates(...)` är ett relevant mönster. Feedbacken föreslår att SvelteKit-versionen låses och att remote function-lagret isoleras bakom tre små exporterade funktioner.

### Separera Supabase-klienterna

Föreslagen uppdelning:

```text
session-scoped server client
→ reads där RLS verkställs

dedikerad admin client
→ servermutationer med explicit user_id-filter
```

Secret/service credentials kan kringgå RLS. Därför ska de uttryckliga ägarskapsfiltren testas separat från RLS-testerna.

### Använd HMAC för `safety_identifier`

Använd en versionsmärkt HMAC med en serverhemlighet i stället för en naken hash:

```text
trace-safety-v1:<hmac-sha256(user_id)>
```

Syftet är en stabil, integritetsskyddad identifierare utan att exponera det råa användar-id:t.

## Föreslagen implementationskärna

```text
Browser
  POST /api/chat/stream
  {
    conversationId?,
    turnId,
    message
  }

        │
        ▼

begin_chat_turn
  - verifiera claims.sub
  - skapa/verifiera conversation
  - deduplicera turnId
  - spara user message
  - skapa titel vid behov
  - uppdatera timestamps
  - returnera budgeterad historiksnapshot

        │
        ▼

OpenAI Responses API
  - gpt-5.6-luna
  - store: false
  - reasoning.context uttryckligen valt
  - max_output_tokens
  - inga tools
  - streama deltas

        │
        ▼

commit_chat_turn
  - spara final output_text idempotent
  - uppdatera timestamps
  - returnera assistant message id

        │
        ▼

done
  {
    turnId,
    messageId
  }
```

## Feedbackens obligatoriska ändringar före implementation

- Lägg till `turnId`.
- Inför atomiska begin/commit-gränser.
- Välj reasoning-context uttryckligen.
- Rätta formuleringen om provider-retention.

Med dessa ändringar bedöms planen fortfarande vara liten, men bättre rustad för retries, tappad `done`, hela turngränser och modellens faktiska state-semantik.

## Referenser från feedbacken

- [OpenAI – Model guidance för gpt-5.6-luna](https://developers.openai.com/api/docs/guides/model-guidance?model=gpt-5.6-luna)
- [OpenAI – Data controls](https://developers.openai.com/api/docs/guides/your-data)
- [OpenAI – Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [SvelteKit – Remote functions](https://svelte.dev/docs/kit/remote-functions)
- [Supabase – Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [OpenAI – Safety best practices](https://developers.openai.com/api/docs/guides/safety-best-practices)
