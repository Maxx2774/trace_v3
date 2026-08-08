# Mall för performanceexperiment

> Detta är en icke-normativ, kopierbar rapportmall. Den skapar inga egna regler eller
> definitioner. Vid konflikt gäller [`measurement-protocol.md`](measurement-protocol.md)
> och tillämpliga normativa specialiseringar. Läs [`README.md`](README.md) för routing och
> aktuella protokollversioner.

Ta bort fält som protokollen uttryckligen gör otillämpliga för den aktuella journeyn.
Lägg till chatsektionen endast när `chat-turns.md` gäller.

```text
# Performanceexperiment

Appsvitversion:
Specialiserad tilläggsversion:
Kodrevision/build:
Experiment-/instrumentationrevision:

## Miljö

- runtime mode:
- browser/version:
- device/OS:
- viewport:
- network/CPU conditions:
- server/DB/provider environment:

## Definition

Hypotes:
Ändrad variabel:
Journeykategori, journey instances och fixtures:
Fixture-/evalsvitversion:
Baseline:
Start-, feedback-, useful-, completion- och settled-gränser:
Tillämpliga primära mått:
Fördefinierade acceptansnivåer:
Primary-primary-tradeoff-policy:
Primary-secondary/complexity-tradeoff-policy:
Cachekohort och körordning:

UI-observation:
- direkt presenterad UI eller proxy:
- använd proxy:

## Telemetri

- insamlade datakategorier:
- syntetiska eller verkliga fixtures:
- retention/åtkomst när relevant:
- uppmätt instrumentation-overhead:

## Hårda krav

- correctness:
- authority/safety:
- accessibility:
- consistency/idempotency/recovery:
- retry/error/cancellation rate:
- honest contract-valid UI:
- telemetry privacy:

## Primära resultat

- applicable feedback metric:
- time_to_first_useful_ui:
- applicable completion metric:
- applicable settled metric:

## Utfall

- correct completions:
- failures:
- cancellations:
- retries:
- success rate:

## Resurser

- external calls per attempt/journey instance/correct journey:
- payload and transferred bytes:
- server/client work:
- resources from failed/cancelled attempts included:

## Diagnostik

- critical-path segments:
- total work versus critical-path time:
- event sent/received/rendered:
- client execution when relevant:
- paired B - A differences:

## Beslut

Beslut:
Blockerat produktbeslut:
Osäkerheter och ej observerade segment:

## Chat — endast när chat-tillägget gäller

Chat-tilläggsversion:
Turnkategori och definition av useful UI:
Domain-commit-gräns:
Turn-commit-gräns:

Providerinställningar:
- model:
- reasoning effort:
- övriga relevanta settings:

Fixtures och privacy:
- syntetiskt eller verkligt innehåll:
- loggade datakategorier:
- rått innehåll insamlat:
- retention/åtkomst när relevant:

Usage per model call:
- input/cached/uncached/output/reasoning tokens:

Orchestration:
- attempts per submitted turn:
- model calls per attempt:
- tool calls per attempt:
- continuation/recovery path:

Utfall:
- correct completions:
- failures:
- cancellations:
- retries:
- provider errors:

Latency:
- first tool event / first useful streamed text:
- provider calls:
- tool/RPC:
- response finalizer:
- domain commit → useful UI:
- turn commit → terminal UI:
- presenterad UI eller använd proxy:

Verifiering:
- provider-contract cases:
- live-provider acceptance cases:
- live semantic eval cases:
- stateful/SQL journeys:
- browser/chat journeys:
```
