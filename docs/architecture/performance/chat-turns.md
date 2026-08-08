# Tilläggsprotokoll för effektiva chatturns

> Detta dokument är inte fristående. Normativt beroende:
> [`core-protocol.md`](core-protocol.md). Läs [`README.md`](README.md) för kumulativ
> dokumentrouting och aktuell protokollversion.

Detta dokument definierar endast chattspecifika tillägg och striktare regler.

## Omfattning

Tillägget gäller hela en provider-backed chatturn:

- modellkontext och provideranrop
- tool calls och function outputs
- domän- och interaction-mutationer
- continuation och response finalization
- streaming och journal-/UI-events
- turn commit, retry och recovery

## Chattspecifika hårda krav

Utöver kärnprotokollets hårda krav gäller:

- Modellen får aldrig bli authority för interna ID:n, bindings, domänimplementation eller
  committed state.
- Ett persistent tool-/interaction-flöde ska vara idempotent och recovery-säkert.
- En ny orelaterad användarturn ska fungera efter varje persistent interaction-journey.
  Stale protokollstate får inte fortsätta styra samtalet.
- Provider-requesten ska vara giltig i den verkliga nätverksvägen.
- Retry eller continuation får inte duplicera en domänmutation.
- Chattelemetri får inte som standard innehålla råa användarmeddelanden, prompts,
  modellkontext, tool-argument, function outputs eller journaldata.

## Chatturnens journey-kategorier och useful UI

Varje benchmark ska välja tillämpliga basmått och definiera `useful` per turnkategori.

```text
vanlig strömmad konversation
→ första meningsfulla providerinnehållet som presenterats
  tydligt som ett pågående svar

stateful registrering
→ verifierat journalkort från committed canonical domänstate

pending confirmation
→ committad och besvarbar confirmation-fråga

registrering + ytterligare avsikt
→ verifierat journalkort får vara TTUI
→ turn completion kräver även authoritative slutfört svar

discard eller annan terminal interaction
→ kontraktsgiltigt acknowledgement efter nödvändig
  interaction- och turnstate
```

Strömmad text behöver inte vara terminalt sparad för att räknas som useful när UI tydligt
visar att svaret fortfarande pågår. Den får inte presenteras som ett authoritative
terminalt svar före turn commit.

Spekulativ domänstate får aldrig räknas som ett verifierat journalkort. Ett pending
förslag är inte en committed journalpost.

`turn_completion_time` är chattspecialiseringen av kärnprotokollets
`journey_completion_time` för en submitted turn. `time_to_first_useful_ui` behåller
samma namn men specialiseras av turnkategorierna ovan.

## Submitted turn, attempt och model call

Mätprotokollets generella resursnivåer specialiseras så här:

```text
submitted turn
→ chattspecialisering av journey instance
→ ett användarskickat unikt turn-ID

attempt
→ en sammanhängande orchestration-körning för detta turn-ID
  från start eller retry till success, failure eller cancellation

model call
→ ett enskilt provideranrop inom ett attempt

tool call
→ ett enskilt modellbegärt tool-anrop inom ett attempt
```

En continuation är ytterligare ett model call inom samma attempt. En retry är ett nytt
attempt för samma submitted turn.

```text
submitted turn
├─ attempt #1
│  ├─ model call #1
│  ├─ tool/RPC
│  └─ model call #N
└─ attempt #2 (retry)
   └─ recovery eller ny orchestration
```

Rapportera minst:

- attempts per submitted turn
- model calls per attempt
- tool calls per attempt
- tokens och providerkostnad per attempt
- tokens och providerkostnad per submitted turn
- tokens och providerkostnad per korrekt slutförd turn

Misslyckade och avbrutna attempts samt retries ska ingå i kostnaden per korrekt slutförd
turn.

Om inga turns slutförs korrekt ska resurser per korrekt slutförd turn rapporteras som
odefinierade och experimentet som misslyckat.

## Provider-, tool- och commit-tidslinje

En stateful turn ska vid behov kunna observeras som:

```text
client submit
│
├─ server request received
├─ begin turn / history / model context
├─ provider call #1
│  ├─ request sent
│  ├─ first tool event eller första användbara strömmade text
│  └─ response completed
├─ tool execution
│  ├─ DB/RPC
│  └─ eventuell domain-/interaction-commit
├─ eventuellt verifierat delresultat sent
│  ├─ received
│  └─ presented                             ← möjlig TTUI
├─ ytterligare provider calls inom den tillåtna tool-loopen
├─ response finalization
├─ turn commit
├─ terminal event sent
├─ terminal event received
└─ terminal UI presented                    ← turn completion
```

Domain commit och turn commit är semantiskt olika gränser:

```text
domain commit
→ exempelvis måltiden eller interaction-resolutionen är canonical

turn commit
→ assistantsvaret och hela turnens terminala utfall är authoritative slutförda
```

De kan i vissa flöden inträffa i samma transaktion eller vid samma tidpunkt. Protokollet
kräver inte att de alltid är temporalt separerade.

Ett verifierat journalkort får därför vara useful före turn completion när domain commit
redan har inträffat. Optimistiskt terminalt chat-UI får inte stoppa
`turn_completion_time` före turn commit.

Mät monotona durations inom varje process och korrelera klient-, server-, provider- och
databassegment med stabila turn- och operation-ID:n enligt mätprotokollet.

## Chattspecifik telemetri och privacy

Mätprotokollets privacyregler gäller fullt ut.

Chatbenchmarkar ska som standard logga metadata, inte innehåll:

- modell och modellinställningar
- tool-namn
- status- och felkategorier
- response-meaning- eller decision-kategori när den inte innehåller användardata
- tokenusage
- payloadstorlek
- timings
- cacheutfall
- attempts och model calls
- pseudonyma turn- och operation-ID:n

Följande får inte loggas från riktiga användarflöden utan ett uttryckligt, avgränsat
testkontrakt:

- användarmeddelanden
- full prompt eller modellkontext
- råa tool-argument
- råa function outputs
- rå modelltext
- journalposter eller hälsodata
- interna databas-ID:n
- autentiseringsdata

Provider-kontraktstest och live-evals ska använda syntetiska fixtures när rå request-shape
eller semantiskt innehåll behöver inspekteras.

## Chattspecifik diagnostik

Utöver mätprotokollets diagnostik ska relevanta experiment rapportera:

- input tokens
- cached input tokens
- uncached input tokens när de kan härledas
- output tokens
- reasoning tokens när providern rapporterar dem
- tid till första tool-event
- tid till första användbara strömmade text
- provider-latency per model call
- tool- och DB-/RPC-latency
- response-finalizer-latency
- model calls per attempt
- tool calls per attempt
- retry-, cancellation- och providerfel

Antalet model calls är en stark förklaringsvariabel för latency och kostnad, inte ett
absolut produktmål. Flera calls kan vara korrekta när användarens avsikt kräver det.

## Modellgränsens principer

### Skicka endast semantiskt nödvändig information

> Minimera semantisk information som modellen inte behöver, inte endast antalet tecken.

Ett kortare men otydligare kontrakt som orsakar fel tool call, retry eller extra
continuation är en nettoförlust.

### Canonical object är inte automatiskt model payload

Kanoniska serverobjekt ägs av domän-, journal-, UI- och recovery-flöden. Modellen ska få
en uttrycklig projektion eller ett delta som innehåller endast vad nästa model call
behöver.

```text
canonical server object
≠
model-facing projection
```

### Skicka ny information, inte hela state igen

När tidigare modellinput bevaras ska en function output i första hand beskriva vad som
förändrades eller om operationen lyckades. Redan tillgänglig domändata ska inte
dupliceras utan ett verifierat semantiskt behov.

### Authority ska aldrig flyttas till modellen

Kortare payload får inte innebära att modellen börjar välja intern typ, databas-ID,
operation eller domänimplementation. Symboliska referenser ska verifieras genom
serverägda bindings.

### Namn optimeras sist

Model-facing namn ska vara de kortaste namn som fortfarande är lokalt entydiga.

Förkortningar och kortare enumvärden måste utvärderas mot:

- semantisk klassificering
- felanrop
- retries
- extra model calls

TypeScript-interna namn som aldrig passerar modellgränsen ska inte kortas av tokenhänsyn.

## Chattspecifik optimeringsordning

Mätprotokollets uppmätta kritiska väg styr. Inom modell- och tool-gränsen undersöks
normalt:

```text
1. undvik model calls som servern kan terminalisera deterministiskt
2. minimera modellens genererade arbete
3. minimera dynamisk modellinput
4. korta den seriella model → tool/RPC → model-vägen
5. minimera tool- och DB-roundtrips
6. förbättra prompt-cachebarhet och prefixstabilitet
7. ta bort redundanta function-output- och projection-fält
8. mikrooptimera model-facing schema, namn och enumvärden
```

Parallellisering får endast användas för oberoende operationer. Commands,
authority-kontroller och operationer med ordningskrav ska förbli seriella.

## Chattspecifika jämförelsekrav

[`measurement-protocol.md`](measurement-protocol.md) äger A/B-, cache-, pairing-,
statistik- och rapporteringsreglerna. Följande är chattspecifika tillägg när modellgränsen
är testvariabel.

När modellgränsen är testvariabel ska båda varianterna hålla följande identiskt:

- modell
- reasoning effort och övriga modellinställningar
- request-builder
- systemprompt och tool-definitioner, om de inte själva är testvariabeln
- historik och dynamisk kontext
- användarmeddelande och evalfall
- testmiljö och domänfixture
- instrumentation och telemetrikonfiguration

Logga alltid faktisk providerusage och rapporterad cacheanvändning. Cold-ish och warm ska
vara separata kohorter när cache är beslutspåverkande.

## Chattspecifika verifieringsgränser

```text
deterministiskt provider-kontraktstest
→ final request-shape, tools, tool choice,
  structured output och bevarad kontext

runtime-/integrationstest
→ verklig serverlogik, tool-resultat och orchestration

mutation-free live-provider-eval
→ providern accepterar produktionsrequesten
  och modellen klarar den semantiska uppgiften

stateful/SQL-journey
→ mutation, idempotens, authority,
  domain commit och recovery

browser/chat-journey
→ streaming, presenterad UI, journal-events
  och terminalt chat-state
```

Ett deterministiskt test får inte bero på en verklig modells stokastiska svar. En
mutation-free live-eval ska använda produktionsbyggaren men syntetiskt tool-resultat när
syftet är att verifiera continuation utan domänmutation. Runtime- och stateful tester ska
separat bevisa att den riktiga handlern producerar samma resultat.

När model-facing instruktioner, tool-beskrivningar, enums, classifications eller
decision categories ändras ska varje berörd semantisk kategori ha ett explicit förväntat
tool call och argumentutfall. Provideracceptans och semantisk live-eval ska rapporteras
som separata gates.

När UI-presentation bara observeras via DOM commit, `requestAnimationFrame` eller annan
proxy ska detta anges. Ett internt stream-event bevisar inte att användaren faktiskt såg
innehållet.

Följ alltid den fullständiga leveransgrinden i `AGENTS.md` för stateful, provider-backed
eller model-facing arbete.

## Chattspecifika rapporteringskrav

Utöver mätprotokollets rapporteringskrav ska en tillämplig chatrapport identifiera:

- chat-tilläggsversion
- turnkategori och definition av useful UI
- domain- och turn-commit-gränser
- providerinställningar och usage per model call
- fixturetyp, loggade datakategorier och eventuell hantering av rått innehåll
- attempts, model calls, tool calls samt continuation- och recoveryväg
- correct completions, failures, cancellations, retries och providerfel
- chattspecifika latencysegment och använd UI-proxy
- provider-contract-, live-provider-, semantic-eval-, stateful/SQL- och
  browser/chat-verifiering

Använd chatsektionen i den icke-normativa
[`experiment-report-template.md`](experiment-report-template.md) som kopierbar struktur.
