# Trace performance protocols

Status: aktiv och låst protokollsvit. Ändras endast när verkliga implementationer eller
benchmarkresultat visar en konkret brist.

```text
App performance protocol suite: version 1
Chat addendum: version 1
Gäller från: 2026-08-08
```

## Syfte

Den här katalogen är ingången för allt performancearbete i Trace. README äger ensam:

- dokumentrouting
- appsvitens versionsnummer
- chat-tilläggets versionsnummer

Normativa performance-regler finns i de länkade protokolldokumenten. README är en karta,
inte ett ytterligare protokoll.

Varje optimeringsrapport ska ange den appsvitversion och, när chat-tillägget används,
den tilläggsversion som gällde när experimentet genomfördes.

## Versionspolicy

- En normativ ändring i `core-protocol.md`, `measurement-protocol.md` eller
  `app-flows.md` höjer appsvitversionen.
- En normativ ändring endast i `chat-turns.md` höjer chat-tilläggsversionen.
- En normativ ändring som berör både bassviten och chat-tillägget höjer båda versionerna.
- Redaktionella ändringar som stavning, formatering och korrigerade länkar kräver ingen
  versionshöjning.
- En ändring som påverkar betydelsen av ett mått, hårt krav, journey-kontrakt,
  verifieringskrav eller beslutsregel är normativ.
- Historiska rapporter behåller och bedöms enligt de versioner som gällde när
  experimentet genomfördes.

## Versionshistorik

| Appsvit | Chat-tillägg | Datum      | Sammanfattning              |
| ------: | -----------: | ---------- | --------------------------- |
|       1 |            1 | 2026-08-08 | Initial låst protokollsvit. |

## Kumulativ dokumentrouting

Läs alltid:

- [`core-protocol.md`](core-protocol.md) för allt performancearbete.

Lägg dessutom till samtliga dokument som matchar förändringens scope:

- [`measurement-protocol.md`](measurement-protocol.md) när arbetet benchmarkar,
  instrumenterar, jämför varianter eller ska hävda att något är snabbare, billigare eller
  effektivare.
- [`app-flows.md`](app-flows.md) för navigation, initial load, post-navigation loading,
  RPC, datahämtning, client-/serverpayloads, cache, invalidation, mutationer, rendering
  eller klientarbete.
- [`chat-turns.md`](chat-turns.md) för modeller, tools, providers, streaming,
  chatorkestrering, continuation eller chat recovery.
- [`experiment-report-template.md`](experiment-report-template.md) som kopierbar mall
  när en mätt jämförelse rapporteras.

Dokumenten väljs kumulativt. En förändring kan kräva flera specialiseringar. Läs inte
performance-dokument som inte matchar uppgiftens scope.

## Exempel

```text
chat-backend eller tool-arkitektur utan performancepåstående
→ core + chat-turns

mätt chat-backend- eller tool-optimering
→ core + measurement + chat-turns

chat-UI, streaming eller rendering utan performancepåstående
→ core + app-flows + chat-turns

mätt A/B-experiment av chat-UI
→ core + measurement + app-flows + chat-turns

navigationens beteendekontrakt
→ core + app-flows

mätt navigationsoptimering
→ core + measurement + app-flows
```

## Normativ hierarki

```text
README
→ äger routing och versioner

core-protocol
→ gemensamma normativa regler

measurement-protocol
→ gemensamma regler för mätning och performancepåståenden

app-flows / chat-turns
→ kumulativa, scopespecifika tillägg

experiment-report-template
→ icke-normativ kopierbar mall
```

Kärnprotokollet äger reglerna för hur specialiseringar förhåller sig till basen. Vid
konflikt gäller den normativa fil som äger begreppet. Rapportmallen är alltid
icke-normativ.
