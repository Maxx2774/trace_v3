# Performanceexperiment: minimal `process_interaction_response`-output

Status: genomfört 2026-08-08.

## Version och miljö

- Appsvitversion: 1
- Chat-tilläggsversion: 1
- Kodrevision: `996cd46` med experimentändringar i arbetskopian
- Instrumentation: `tests/live/process-interaction-response-output.live.test.ts`
- Runtime: Node.js/Vitest på macOS arm64
- Provider: OpenAI Responses API, `gpt-5.6-luna`, reasoning `low`, `store: false`
- Databas: länkad Trace-utvecklingsinstans i Supabase, PostgreSQL 17
- Browser, viewport och presenterad UI: inte tillämpliga; ingen browser eller UI mättes

## Definition

Hypotesen var att byta function output efter en bekräftad måltidsregistrering från ett
fullständigt kanoniskt meal-objekt till `{"status":"registered"}`. Den förväntade
direkta effekten var mindre payload och färre input-tokens i continuation-anropet, utan
ändrat antal modell- eller tool-anrop.

Journeyn var `confirmed_with_additional_intent` med den syntetiska frågan “Ja,
registrera den. Vad innehöll måltiden?”. Korrekt completion krävde:

- exakt `process_interaction_response` med rätt interaction-ref och response meaning
- en enda syntetisk resolution utan databasmutation i live-evalen
- bevarad pending interaction-projektion i continuation-requesten
- ett korrekt svar som nämnde havregröt och banan
- två modellsteg och ett tool-resultat, utan retry eller extra call

Baseline och variant använde samma modell, inställningar, request-builder, systemprompt,
verktyg, historik, dynamiska kontext och första provider-output. Den delade första
provider-outputen fångades en gång live och återanvändes för att isolera function
output-payloaden som enda avsiktliga skillnad. Ordningen var `A B B A A B`, där A var
full output och B minimal output.

Hårda acceptanskrav var 100 % deterministisk kontraktskorrekthet, bibehållen authority,
idempotens och recovery, oförändrat call count samt färre continuation-input-tokens.
Latency var diagnostik och inte ensam beslutande i det lilla stickprovet.

## Privacy och telemetri

Alla livefall använde syntetisk måltids- och användardata. Endast timings, tokenusage,
payloadstorlek, call count och pass/fail behölls. Inga riktiga användarmeddelanden,
journalposter, interna databas-ID:n eller autentiseringsuppgifter loggades.

## Resultat

Alla sex A/B-körningar slutfördes korrekt:

- correct completions: 6
- failures: 0
- cancellations: 0
- retries: 0
- provider errors: 0
- success rate: 100 %
- model calls per konstruerad turn: 2
- tool calls per konstruerad turn: 1

| Mått                                | Full output, n=3 | Minimal output, n=3 |             Skillnad |
| ----------------------------------- | ---------------: | ------------------: | -------------------: |
| Function output                     |        512 bytes |            23 bytes | −489 bytes (−95,5 %) |
| Input tokens, continuation          |            2 043 |               1 863 |        −180 (−8,8 %) |
| Uncached input tokens, continuation |            2 043 |               1 863 |        −180 (−8,8 %) |
| Totala input tokens per turn        |            3 855 |               3 675 |        −180 (−4,7 %) |
| Modellsteg per turn                 |                2 |                   2 |                    0 |
| Tool calls per turn                 |                1 |                   1 |                    0 |

Ingen körning rapporterade cached input tokens; resultatet är därför en observerad
cold-ish kohort och gör inget påstående om warm-cacheeffekt.

### Latency

| Mått                        |                            Full output |                         Minimal output | Median skillnad |
| --------------------------- | -------------------------------------: | -------------------------------------: | --------------: |
| Continuation provider time  | median 1 333 ms, intervall 1 097–1 446 | median 1 235 ms, intervall 1 137–1 250 | −99 ms (−7,4 %) |
| Konstruerad total turn time | median 2 376 ms, intervall 2 139–2 488 | median 2 277 ms, intervall 2 179–2 292 | −99 ms (−4,2 %) |

Parade skillnader för minimal minus full continuation-latency var `−309 ms`, `+153 ms`
och `−99 ms`. Medianen var lägre men intervallet visar providervariation; stickprovet
motiverar därför inget exakt produktlatencypåstående. Den delade första providerkörningen
tog 1 042 ms och första tool-eventet kom efter 822 ms. Syntetisk function-resultat-
serialisering tog 0,017–0,040 ms och ersätter inte en mätning av verklig RPC-latency.

Output- och reasoning-tokens varierade mellan körningarna och var inte den direkta
optimeringsytan. Fulla turn-resultat låg på 80–120 output-tokens och 19–56 reasoning-
tokens; minimala låg på 80–89 respektive 19–29.

## Korrekthetsgrindar

- Deterministiskt provider-request-kontrakt: 1/1 passerade genom den riktiga
  produktionsbyggaren.
- Live-provideracceptans: 2/2 passerade.
- Live semantisk eval: 2/2 passerade.
- SQL-journey för fidelity, idempotens och recovery efter commit: passerade med rollback
  mot utvecklingsdatabasen.
- Runtime-recovery använde den återhämtade kanoniska journalposten och körde ingen andra
  resolution.
- Full automatiserad testsvit: 138 passerade, 13 avsiktligt villkorsstyrda livefall
  hoppades över i standardkörningen.
- `pnpm check`: 0 fel och 0 varningar.
- `pnpm lint`: passerade.
- `pnpm build`: passerade; adapter-auto rapporterade den förväntade upplysningen att
  produktionsadapter ännu inte är vald.
- Kumulativ `supabase/tests/chat.sql`: passerade med rollback mot utvecklingsdatabasen.

## Beslut

Den minimala outputen antas. Den ger en deterministisk minskning på 180 input-tokens i
continuation-anropet och 489 payload-bytes utan extra modellsteg, tool calls eller
observerad semantisk försämring. Latencyresultatet är riktat åt rätt håll men behandlas
endast som stödjande diagnostik, inte som bevis för en exakt användarupplevd förbättring.

Ej observerat: warm prompt-cache, browserpresentation, verklig UI completion och verklig
RPC-latency. Dessa gränser påverkar inte den verifierade payload- och tokenminskningen.
