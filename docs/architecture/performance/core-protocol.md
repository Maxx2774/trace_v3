# Kärnprotokoll för performance

> Detta är protokollsvitens normativa kärna. Läs [`README.md`](README.md) för kumulativ
> dokumentrouting och aktuell protokollversion.

## Syfte och omfattning

Detta är den gemensamma normativa basen för hur Trace utformar och utvärderar
användarupplevd performance. Den gäller alla performanceförändringar oavsett om de berör
appflöden, chat eller andra specialiserade områden.

Specialiserade protokoll får skärpa reglerna men inte försvaga eller omdefiniera dem.

## Övergripande mål

> Minimera användarupplevd end-to-end-latency per korrekt slutförd journey, samtidigt som
> nätverksarbete, serverarbete, resursåtgång och systemkomplexitet hålls så låga som
> möjligt.

En lokal förbättring är inte automatiskt en produktförbättring. Färre RPC-anrop är inte
bättre om resultatet blir stale. Tidigare visuell feedback är inte bättre om den
felaktigt framställer pending eller spekulativ state som färdig.

## Hårda krav

En variant får inte accepteras om den försämrar något av följande utanför en före
experimentet definierad acceptansnivå:

- funktionell och semantisk korrekthet
- autentisering, safety och authority
- tillgänglighet
- datakonsistens och idempotens
- recovery
- retry-, cancellation- eller felfrekvens
- semantiskt ärlig och kontraktsgiltig UI
- privacy och dataminimering i performance-telemetri

Kritiska deterministiska journeys ska normalt passera till 100 %.

## Journey-kontrakt

Innan en performanceförändring utvärderas eller används som grund för ett beslut, och
alltid före mätning, ska varje berörd journey definiera:

- vilken händelse som startar mätningen, exempelvis user activation, `navigationStart`,
  app launch eller server request received
- vilka primära produktmått som är tillämpliga
- vad som räknas som första lokal feedback
- vad som räknas som kontraktsgiltig och användbar UI
- vilken authoritative state som krävs
- vad som räknas som korrekt completion
- vad som räknas som settled
- vilka success-, failure-, cancellation- och retryvägar som ingår

Definitionerna får inte ändras efter att experimentresultatet har granskats.

## Gemensamma primära produktmått

Endast de mått som journey-kontraktet markerar som tillämpliga används för beslut.

### `interaction_feedback_time`

Tid från användarens aktivering till den första presenterade frame där UI:t synligt
bekräftar att handlingen har mottagits. Feedbacken måste vara semantiskt ärlig: pending
är inte samma sak som completed.

### `time_to_first_useful_ui`

Tid från journey-start tills semantiskt ärlig och kontraktsgiltig UI som användaren
faktiskt kan använda har presenterats.

Regeln specialiseras per kategori:

```text
stateful canonical result
→ måste bygga på nödvändig authoritative commit

strömmat icke-stateful innehåll
→ får räknas när meningsfullt innehåll visas tydligt som pågående

pending navigation
→ räknas som interaction feedback, inte automatiskt som useful page

stale cache
→ får räknas endast när journey-kontraktet tillåter det och UI visar dess status ärligt

spekulativ domänstate
→ får aldrig framställas som verifierat useful UI
```

Varje journey ska före körningen definiera vad `useful` betyder.

### `journey_completion_time`

Tid från journey-start tills:

```text
alla nödvändiga authoritative villkor är uppfyllda
+ eventuell state som måste förändras är committed
+ klienten har presenterat journeyens korrekta terminala utfall
```

En read-only-journey kräver alltså ingen påhittad mutationscommit.

Optimistiskt terminalt UI före den nödvändiga authority- eller commit-gränsen får inte
stoppa mätningen.

### `time_to_settled_ui`

Tid tills all nödvändig foreground-laddning och rendering för journeyn är färdig. Ren
bakgrundsuppdatering som inte blockerar användning ska definieras och mätas separat.

## Sekundära mål

- överförda bytes och payloadstorlek
- antal nätverks-, provider- och RPC-anrop
- server-, databas- och klientarbete
- cacheeffektivitet
- resurs- eller providerkostnad
- systemkomplexitet och underhållskostnad

## Beslutsregel

1. Avvisa en variant som bryter ett hårt krav.
2. Föredra en variant som förbättrar minst ett tillämpligt primärt produktmål utan
   materiell försämring av något annat tillämpligt primärt produktmål, sekundära mål
   eller komplexitet.
3. När tillämpliga primära mål går åt olika håll ska den före experimentet definierade
   journeykategori-policyn användas. Saknas den är resultatet otillräckligt för beslut.
   Definiera gränsen och kör om.
4. När ett primärt mål förbättras men ett sekundärt mål eller komplexiteten försämras
   materiellt ska den före experimentet definierade tradeoff-policyn användas. Saknas
   den är resultatet otillräckligt för beslut. Definiera gränsen och kör om.
5. När tillämpliga primära mål är likvärdiga ska resursåtgång, externt arbete och
   komplexitet avgöra enligt de fördefinierade acceptansnivåerna.
6. Skapa ingen dold viktning eller godtycklig `efficiency score`.
7. Beskriv en omätt förändring som en hypotes, inte en förbättring.

`Materiell` ska alltid betyda den gräns som definierades innan experimentet kördes.

## Agentens arbetssätt

Agenten ska själv definiera tekniska baselines, fixtures och säkra standardkrav när de
kan härledas från kod och protokollsviten. Agenten ska inte fråga användaren om mekaniska
testbeslut.

Agenten ska fråga användaren när ett nytt produkttradeoff påverkar beslutet och ingen
policy redan finns.

Om körningen inte är interaktiv ska resultatet markeras som blockerat av ett
produktbeslut. Agenten får inte välja en dold tradeoff.

Om en oförutsedd konflikt upptäcks efter mätningen ska agenten:

```text
rapportera resultatet som otillräckligt för beslut
→ inhämta eller invänta produktgränsen
→ köra om med fördefinierad policy
```
