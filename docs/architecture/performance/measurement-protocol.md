# Mätprotokoll för performance

> Detta dokument är inte fristående. Normativt beroende:
> [`core-protocol.md`](core-protocol.md). Läs [`README.md`](README.md) för kumulativ
> dokumentrouting och aktuell protokollversion.

## Omfattning

Detta protokoll gäller när Trace benchmarkar, instrumenterar, jämför varianter eller
påstår att en förändring är snabbare, billigare eller effektivare. Det äger den
gemensamma metoden för mätning, telemetri, reproducerbarhet, verifiering och rapportering.

## Presenterad UI och mätproxy

Ett UI-mått stoppas av den presenterade UI som journey-kontraktet definierar, inte bara av
en intern state- eller DOM-ändring.

När direkt presenterad UI inte kan observeras får DOM commit, `requestAnimationFrame`,
browser screenshot eller annan i förväg definierad signal användas som mätproxy.
Rapporten ska då uttryckligen ange:

- att måttet är en proxy
- vilken signal som faktiskt observerades
- vilken presenterad UI signalen avser att approximera

En proxy får inte rapporteras som om exakt browser-paint direkt observerades.

## Diagnostiska mått

Diagnostiken förklarar varför produktmåtten förändras. Den är inte automatiskt ett
produktmål.

- latency per segment på den kritiska vägen
- total arbetsmängd per segment
- request-, RPC-, retry- och cancellation-utfall
- event sent, received och rendered
- JavaScript- och CSS-bytes när relevant
- hydration- och startup-tid när relevant
- long tasks och blockerad main thread
- render- och update-duration
- layout shift
- DOM-arbete
- minnes- eller listenerläckor i längre sessioner när relevant
- overhead från själva performance-instrumenteringen

Mät endast diagnostik som är relevant för förändringens risk och hypotes. Varje
benchmark behöver inte bli en fullständig frontend-audit.

## Performance-telemetri och privacy

Performanceinstrumentering får inte skapa en ny väg för användarinnehåll, journaldata
eller modellkontext att lämna sin avsedda säkerhetsgräns.

Som standard ska telemetri endast innehålla metadata som behövs för experimentet,
exempelvis:

- pseudonyma trace-, journey-, turn- och operation-ID:n
- journey- och turnkategori
- status- och felkategorier
- timings och durations
- payloadstorlekar och tokenantal
- antal calls, retries och attempts
- cacheutfall
- build-, protokoll- och miljöinformation

Performance-telemetri får som standard inte innehålla:

- rå journal- eller hälsodata
- användarmeddelanden
- prompts eller full modellkontext
- råa tool-argument eller function outputs
- access tokens, sessionsdata eller autentiseringshemligheter
- interna databas-ID:n när pseudonyma korrelations-ID:n räcker

Rått innehåll får endast användas inom ett uttryckligt och avgränsat testkontrakt, helst
med syntetiska fixtures. Kontraktet ska definiera:

- varför innehållet behövs
- vilken miljö som får användas
- vem som får åtkomst
- retention och radering
- vilka fält som ska maskeras eller uteslutas

Instrumentation ska vara jämförbar mellan A och B. Synkron loggning, serialisering eller
export på den kritiska vägen ska undvikas. Om instrumentationens overhead kan påverka
beslutet ska den mätas och rapporteras separat.

## Kritisk väg och total arbetsmängd

```text
total work
≠
critical-path latency
```

Två parallella anrop på 100 ms vardera är cirka 200 ms externt arbete men cirka 100 ms
critical-path latency. Överlappande segment får inte summeras och presenteras som
journey completion.

Varje relevant journey bör kunna beskrivas som:

```text
journey start event
→ local feedback
→ navigation/operation start
→ external calls
→ eventuell authoritative domain commit
→ useful event received
→ useful UI presented
→ authoritative journey completion
→ terminal UI presented
```

Mät monotona durations inom varje process och korrelera segment med stabila journey-,
turn- och operation-ID:n. Subtrahera inte okorrigerade väggklockor på olika maskiner.

## Kontrollerad jämförelse

### Versionering och reproducerbarhet

Varje rapport ska minst ange:

- appsvitversionen från `README.md`
- eventuell specialiserad tilläggsversion
- kodrevision och build
- experiment- eller instrumentationrevision
- fixture- eller evalsvitversion när den versioneras separat från koden
- runtime mode
- browser och version när klienten ingår
- device och operativsystem
- viewport när rendering ingår
- relevanta nätverks- och CPU-förutsättningar
- relevant server-, databas- eller providermiljö

Miljöfält får utelämnas när de bevisligen saknar betydelse för experimentet, men
utelämnandet ska vara synligt.

### Före experimentet

Definiera:

- hypotes och exakt ändrad variabel
- journey, fixtures och start-/slutgränser
- tillämpliga primära mått
- feedback, useful UI, authoritative completion och settled
- hårda acceptanskrav
- materiella gränser för primära och sekundära mål
- eventuell tradeoff-policy mellan tillämpliga primära mål
- eventuell tradeoff-policy mellan förbättrade primära mål och materiellt försämrade
  sekundära mål eller komplexitet
- minsta evidens som krävs

Kritiska deterministiska journeys ska normalt passera till 100 %. Små stickprov får inte
ges statistiskt precisa gränser som de inte kan bära.

### Isolera variabeln

Håll relevanta produkt-, data-, miljö-, instrumentation- och cacheförutsättningar
identiska. Baseline ska mätas före produktionskodändringen eller genom en kontrollerad
variant i samma kodläge.

### Körordning och pairing

När nätverk eller externa tjänster gör latency brusig ska A och B interleavas i
balanserad eller randomiserad ordning, exempelvis `ABBA BAAB`.

Samma fixture ska paras när det är möjligt och varje `B - A`-differens rapporteras
tillsammans med båda varianternas egna fördelningar.

### Cachekohorter

Cold-ish, warm och andra relevanta cachelägen ska hållas i separata kohorter. Rapportera
observerad cacheanvändning. Anta den inte från testets namn.

### Statistik

Små utvecklarbenchmarkar ska rapportera:

- `n`
- median
- observerat intervall
- enskilda körningar
- relevanta segment
- failure-, cancellation- och retryutfall

Rapportera inte p95 från ett stickprov som inte kan bära det.

Större benchmark eller telemetri får rapportera p50, p90, p95 och p99 när
trafikmängden motiverar det.

### Resurser per utfall

```text
journey instance
→ en unik förekomst av journey-starten enligt kontraktet

attempt
→ en sammanhängande körning från start eller retry
  till success, failure eller cancellation

external call
→ ett enskilt nätverks-, provider- eller RPC-anrop inom ett attempt
```

Rapportera resurser per:

```text
attempt
journey instance
korrekt slutförd journey
```

Alla resurser från misslyckade eller avbrutna attempts och retries ska ingå i kostnaden
per korrekt slutförd journey.

Om inga journeys slutförs korrekt ska resurser per korrekt slutförd journey rapporteras
som odefinierade och experimentet som misslyckat, aldrig som noll kostnad.

Primära latencyresultat för korrekt slutförda journeys ska alltid rapporteras
tillsammans med:

- antal failures
- antal cancellations
- antal retries
- total success rate

Misslyckade eller avbrutna körningar får inte tyst filtreras bort.

## Verifieringsgränser

Olika verifieringar bevisar olika saker:

```text
unit/contract
→ lokala kontrakt, payloads och deterministiska call counts

integration
→ verkligt dataflöde, cache, invalidation och serverbeteende

browser journey
→ routerstate, synlig feedback, rendering och användarupplevda gränser

live external
→ verklig nätverks-/provideracceptans och externa tjänsters beteende
```

En intern state-assertion bevisar inte att UI faktiskt presenterades. Ett mockat RPC
bevisar inte extern latency. En manuell upplevelse bevisar inte ett deterministiskt call
count.

När en verifiering använder DOM commit, `requestAnimationFrame` eller annan signal som
proxy för presenterad UI ska detta rapporteras uttryckligen.

Följ alltid den tillämpliga leveransgrinden i `AGENTS.md`.

## Rapporteringskrav

En rapport ska göra samtliga tillämpliga krav ovan synliga, inklusive:

- protokollversioner, kodrevision, instrumentation och miljö
- hypotes, ändrad variabel, journeykontrakt, fixtures, eventuell fixture-/evalsvitversion
  och baseline
- fördefinierade acceptansnivåer och tradeoff-policyer
- UI-observation och eventuell proxy
- telemetrikategorier, privacygränser och instrumentationsoverhead
- hårda krav, primära resultat och samtliga success-, failure-, cancellation- och
  retryutfall
- resursåtgång från både lyckade och misslyckade attempts
- diagnostik, parade differenser, beslut, blockerade produktbeslut och osäkerheter

Använd den icke-normativa
[`experiment-report-template.md`](experiment-report-template.md) som kopierbar struktur.
Vid konflikt gäller detta protokoll.
