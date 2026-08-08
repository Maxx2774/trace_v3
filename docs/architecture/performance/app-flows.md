# Performancekontrakt för appflöden

> Detta dokument är inte fristående. Normativt beroende:
> [`core-protocol.md`](core-protocol.md). Läs [`README.md`](README.md) för kumulativ
> dokumentrouting och aktuell protokollversion.

## Omfattning

Detta dokument definierar appspecifika kontrakt för navigation, initial load,
post-navigation loading, RPC- och dataarbete, cache, mutationer, rendering och
klientarbete.

## Navigation

### Hård navigation-invariant

**Implementationsinvariant:**

> Lokal navigation-feedback ska schemaläggas synkront från aktiveringen och får inte
> invänta routing, route-data, nätverksarbete eller annan asynkron operation.

**Produktmål:**

> Feedbacken ska vara synlig i den första efterföljande presenterade frame som
> applikationen kan påverka. Kontraktsgiltigt innehåll visas först när dess
> journey-kontrakt tillåter det.

Detta är Traces definition av instant navigation. Den lovar omedelbar feedback på
användarens avsikt, inte att routen eller all route-data redan är färdig.

### Active och pending route

```text
active route
→ den route som routern faktiskt har committat

pending route
→ den senaste begärda target-routen som ännu inte har committats
```

Kontraktet kan uttryckas konceptuellt som:

```ts
type NavigationState = {
	activeRoute: Route;
	pendingRoute: Route | null;
};
```

Protokollet kräver inte en fristående store med denna typ. State ska så långt möjligt
härledas från routerns verkliga state för att undvika dubbla sanningar. Lokal
aktiveringsstate får användas för första-frame-feedback innan routerstate hunnit
reflekteras och ska omedelbart reconcileras med routern.

### Navigationens normala flöde

```text
user activates Journal
→ pending route = Journal
→ Journal schemalägger lokal pending-feedback synkront
→ feedbacken visas i första efterföljande presenterade frame
→ routing och dataladdning fortsätter
→ route committas
→ active route = Journal
→ pending route = null
→ kontraktsgiltigt innehåll fylls in enligt route-kontraktet
```

Pending och active får se nästan likadana ut visuellt, men de är inte samma semantiska
state.

- `aria-current="page"` ska endast representera active route.
- Pending-state ska inte beskrivas som färdig navigation för hjälpmedel.
- En spinner eller stark progressindikator får fördröjas för att undvika flimmer, men den
  grundläggande lokala feedbacken ska vara omedelbar.

### Navigationens edge cases

- Vid flera snabba navigationer är senaste target den enda pending route.
- Vid failure eller cancellation nollställs pending route och active route förblir
  authoritative.
- Back/forward och programmatisk navigation ska följa samma active-/pending-kontrakt.
- Ett klick på redan active route ska inte skapa falsk pending-state om ingen verklig
  navigation eller refresh startar.
- Auth- och authority-kontroller får blockera innehåll men inte lokal
  aktiveringsfeedback.
- Stale eller spekulativ data får inte framställas som verifierat aktuell för att göra
  navigationen visuellt snabbare.

### Navigationens mått mappar till basen

```text
navigation_feedback_time
→ interaction_feedback_time för navigation

time_to_useful_page
→ time_to_first_useful_ui för navigation

time_to_settled_page
→ time_to_settled_ui för navigation

navigation_commit_time
→ navigationsspecifikt diagnostiskt mått
```

Journey-kontraktet får göra `navigation_commit_time` beslutande när route commit i sig är
produktrelevant, men det skapar inte ett separat globalt produktmål.

### Verifiering av synlig navigation-feedback

Deterministiska navigationstester ska inspektera verklig router- och renderad UI-state.
De får inte endast kontrollera en intern lokal variabel som senare kan tappas på vägen
till rendering.

När mätning ingår ska observationer av presenterad UI och eventuella DOM-,
`requestAnimationFrame`- eller screenshot-proxyer klassificeras enligt
[`measurement-protocol.md`](measurement-protocol.md).

## Initial sidladdning

Initial load kan starta vid exempelvis app launch, `navigationStart`, första serverrequest
eller en annan i förväg vald plattformsgräns. Startgränsen ska vara samma i baseline och
variant.

Tillämpliga gränser kan vara:

```text
initial shell presented
initial useful UI presented
hydration/client interaction ready
initial foreground work settled
```

Alla behöver inte mätas i varje experiment. Journey-kontraktet väljer de mått som krävs
för beslutet.

Initial load får inte förbättras genom att flytta nödvändigt arbete till ett omätt
foreground-steg efter den deklarerade completion-gränsen. Undvik även dubbel datahämtning
mellan serverrendering, hydration och component mount utan ett uttryckligt kontrakt.

## Post-navigation loading

Varje route ska skilja på:

```text
shell-critical
→ det minsta som krävs för att target-vyn ska kunna visas korrekt

useful-critical
→ data som krävs för att sidan ska bli kontraktsgiltig och användbar

post-navigation
→ data som får laddas efter omedelbar navigation-feedback

background
→ arbete som inte ska blockera användning eller settled-kontraktet
```

Icke-auktoritativ data ska normalt inte blockera lokal navigation-feedback. Auth,
authority och andra correctness-gränser får fortfarande styra när innehåll kan visas.

## RPC- och dataarbete

### Call inventory och budget

Varje kritisk journey ska kunna redovisa:

- förväntat antal nätverks- och RPC-anrop
- vilka anrop som ligger på den seriella kritiska vägen
- vilka anrop som är parallella
- vilka anrop som är mutations- eller authority-beroende
- vilka resultat som redan finns i cache eller lokalt authoritative state
- vilka anrop som är post-navigation eller background

När antal anrop är en del av förändringens hypotes ska ett deterministiskt test låsa det
faktiska nätverks-/RPC-beteendet för journeyn.

### Undvik duplicerade anrop

Samma data ska inte hämtas i layout, page och component mount utan ett uttryckligt behov.
Undvik även refetch som ett kanoniskt mutationsresultat säkert kan ersätta.

Färre anrop är dock inte ett självändamål. Slå inte ihop oberoende kontrakt till ett stort
RPC-resultat om det ökar coupling, payload eller invalidation utan uppmätt nettovinst.

### Undvik onödiga waterfalls

Oberoende queries får köras parallellt. Commands, authority-kontroller och operationer
med ordnings- eller transaktionskrav ska förbli seriella.

```text
oberoende
A ─┐
B ─┼→ nästa steg
C ─┘

beroende
A → B → C
```

### Cache och invalidation

Varje förändring ska kunna förklara:

- varför befintlig data kan eller inte kan återanvändas
- vad som invaliderar cachen
- om invalidationen är smal eller orsakar onödig refetch
- om ett kanoniskt mutationsresultat kan uppdatera lokal state direkt
- hur stale state markeras och när den får visas
- om prefetch ger nettovinst eller endast flyttar och ökar arbetet

Målet är minsta nödvändiga arbete med korrekt state, inte maximal caching.

### Payloads

Servern ska returnera den minsta semantiskt kompletta representation som konsumenten
behöver. Kanoniska databasobjekt ska inte automatiskt skickas över varje klient-,
server- eller modellgräns.

## Mutationer

Det normala mutationsflödet är:

```text
user action
→ omedelbar och semantiskt ärlig lokal feedback
→ mutation
→ authoritative server result
→ UI reconciliation
→ terminalt utfall
```

Regler:

- Lokal feedback får visas omedelbart, men pending får inte framställas som committed.
- Optimistic UI får endast användas när journey-kontraktet uttryckligen tillåter det och
  rollback samt reconciliation är definierade.
- Journal- och annan canonical domänstate får inte visas som verifierat registrerad före
  nödvändig servercommit.
- Dubbelsubmit ska förhindras eller göras ofarlig genom idempotens.
- Mutationens kanoniska returvärde ska återanvändas när det säkert kan undvika en bred
  refetch.
- En refetch får inte ersättas av lokal patchning när servern kan ha förändrat
  användarrelevant semantik som patchen saknar.
- Cancellation-kontraktet ska definiera om operationen fortfarande får commit efter att
  klienten avbrutit och hur UI därefter reconcileras.
- Retry får inte skapa en andra mutation eller ett motstridigt terminalt utfall.

## Rendering och klientarbete

- Gör inget tungt synkront arbete före lokal feedback om det kan skjutas efter nästa
  presenterade frame utan att bryta correctness.
- Undvik att samma data transformeras upprepade gånger i flera komponentlager.
- Behåll stabil layout när data fylls in. En snabb men hoppig sida är inte en
  användarupplevd förbättring.
- Tillgänglig state och visuell state ska beskriva samma verkliga läge.
- Mät hydration, startup, long tasks, main-thread-blockering, render duration,
  DOM-arbete, layout shift och långlivade läckor när de är relevanta för hypotesen.
- Browser- eller renderingsnära verifiering krävs för påståenden om feedback, layout,
  transitions och faktisk rendering.
- När presenterad UI inte observeras direkt ska använd proxy klassificeras enligt
  `measurement-protocol.md`.

## Optimeringsordning

Undersök normalt kandidater i denna ordning, justerad efter uppmätt kritisk väg:

```text
1. ge omedelbar och semantiskt ärlig lokal feedback
2. ta bort onödigt blockerande arbete från den kritiska vägen
3. eliminera duplicerade nätverks-/RPC-anrop
4. parallellisera oberoende arbete
5. undvik onödiga refetches och bred invalidation
6. minska payload och transformationsarbete
7. förbättra cache/prefetch när det ger mätt nettovinst
8. mikrooptimera implementationen
```
