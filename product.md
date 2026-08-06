# Trace — produktdefinition

**Status:** Beslutad produktdefinition och initialt fokus.  
**Produktkategori:** Personlig hälsojournal för systematisk mönsterundersökning.

> **Sluta gissa. Börja undersöka.**

Trace hjälper människor att dokumentera och systematiskt undersöka återkommande
förändringar i sina symtom och sitt mående.

Den aktuella journal-first-produktupplevelsen och informationsarkitekturen
beskrivs i [PRODUCT_EXPERIENCE.md](PRODUCT_EXPERIENCE.md).

Produkten omvandlar vardagliga observationer till strukturerad data, skiljer det
som är okänt från det som uttryckligen dokumenterats som frånvarande och visar vad
som talar för och emot möjliga personliga mönster.

Trace avgör inte vad som orsakar ett symtom. Produkten gör osäkerheten synlig,
spårbar och undersökningsbar.

## Nuvarande leveransstadium

Trace utvecklas först som en privat, ägarstyrd MVP som endast produktägaren
använder för att validera produktens nytta. Produktägaren får använda sina egna
verkliga uppgifter i denna uttryckligen privata testmiljö.

Detta är inte en publik lansering och innebär inte att kraven för externa
testanvändare eller allmänheten är uppfyllda. Innan någon annan får tillgång måste
grindarna för offentlig lansering passera, inklusive `OPEN-001`, faktiska
provider- och driftinställningar samt verifierad radering över externa system och
backuper.

## Initialt fokus

Trace optimeras initialt för personer med återkommande magbesvär, hudbesvär eller
båda, som vill undersöka om mat kan samvariera med förändringarna.

Onboarding, exempel, check-ins, produktutveckling och de första användartesterna
utgår främst från dessa problem. Det begränsar inte Traces långsiktiga identitet
eller journalens möjlighet att stödja andra symtom och välmåendesignaler.

Trace kan hjälpa användaren att logga och följa ett symtom eller en signal även
när produkten ännu inte kan erbjuda en validerad analys av möjliga samband kring
den.

Analysarkitekturen är metodöppen, men varje faktisk evidensanalys är
metodspecifik. Ett personligt utfall får endast analyseras när dess verifierade
observationskällor passar en versionerad, validerad och aktiverad analysmetod.
Den initiala metodutvecklingen, användningen i det egna teamet och valideringen
fokuserar främst på möjliga matsamband med mag- och hudbesvär. Metod väljs efter
hur utfallet observeras över tid, inte efter kroppsdel. Händelser med en tydlig
start och tillstånd som följs återkommande kan därför kräva olika metoder även när
de gäller samma symtom.

Den första användaren:

- har svårt att minnas och jämföra måltider, symtom och bättre perioder
- dokumenterar i anteckningar, kalkylark eller andra appar, eller inte alls
  eftersom det är för arbetsamt
- provar eller överväger kostförändringar men har svårt att utvärdera dem
- förstår att återkommande mönster kräver observationer över tid, men behöver att
  den dagliga loggningen tar sekunder snarare än minuter
- vill förstå vad den egna datan faktiskt visar

## Problemet

Personer som försöker förstå personliga mönster stöter ofta på samma hinder:

- vardaglig loggning kräver för mycket manuell inmatning
- måltider, symtom och annan relevant kontext dokumenteras på olika platser
- historik visas utan att datakvalitet, motbevis eller alternativa förklaringar
  framgår
- förändringar kan följa efter en möjlig exponering med olika fördröjning
- en ologgad period förväxlas lätt med en symtomfri eller stabil period
- många möjliga faktorer och tidsfönster gör slumpmässiga mönster sannolika

Resultatet blir ofta fler gissningar, fler restriktioner och mer data utan större
klarhet.

## Så fungerar Trace

Trace består av två delar:

1. **Den intelligenta journalen** gör loggning, rättelser, tidslinje och
   uppföljning enkel genom naturligt språk och tydliga UI-handlingar.
2. **Evidensmotorn** är ett gemensamt säkerhets- och spårbarhetsramverk för
   specifika analysmetoder. Endast en validerad och aktiverad metod får undersöka
   dokumenterade perioder och presentera möjliga associationer med motbevis,
   dataluckor och metod.

Journalen samlar bland annat:

- måltider och uttryckligen uppgivna eller bekräftade ingredienser
- fristående symtomhändelser och personliga check-ins
- sömn och andra relevanta observationer
- vikt som ett valfritt sekundärt mått
- personliga signaler som användaren vill följa över tid
- användarstyrda preferenser, restriktioner, mål och undersökningsfokus
- strukturerade observationer i en gemensam tidslinje, med konversationen som
  gränssnitt för att registrera, rätta och undersöka dem

Produktloopen är:

> **Ordning → täckning → tidig observation → möjligt återkommande mönster → fortsatt utvärdering**

Journalen skapar den dagliga nyttan. Evidensmotorn är avsedd att skapa produktens
differentierade långsiktiga värde. Betalningsviljan och den mest värdefulla formen
för analysen är produkthypoteser som måste valideras.

En användare kan själv markera en avsiktlig förändringsperiod, exempelvis en period
då kosten ändras. Trace dokumenterar då användarens val och får jämföra perioden
endast med en metod som uttryckligen stöder det. Markeringen är inte en
rekommendation, behandlingsplan eller bedömning av att förändringen är säker.

## Produktlöftet

> **Logga vad som händer. Trace hjälper dig se möjliga mönster och vad som krävs
> för att undersöka dem bättre.**

Trace hjälper användaren att förstå:

- vad som faktiskt har dokumenterats
- vad som är känt, okänt eller uttryckligen frånvarande
- hur ofta en möjlig exponering förekommer före en förändring
- vad jämförbara bättre eller stabilare perioder visar
- vilka tidsfönster och hur många jämförelser som undersökts
- vilka andra faktorer som förekommer samtidigt
- om observationen återkommer i senare data

## Kärnprinciper

### Så lite friktion som möjligt

Loggning ska kännas som att skicka ett meddelande, inte fylla i ett formulär.
Bekräftelse efterfrågas när den skyddar datans betydelse, inte rutinmässigt efter
varje detalj.

### Användaruppgift och inferens hålls isär

Om användaren skriver:

> Åt köttpaj vid 19.

får Trace lagra måltidsnamnet och tidpunkten. Produkten får inte tyst skapa grädde,
ost eller gluten som ingredienser. Förslag måste bekräftas innan de behandlas som
uppgifter om vad användaren åt.

### Okänt är inte frånvaro

Saknad symtomrapport betyder inte symtomfri. Saknad matlogg betyder inte
oexponerad. En utebliven check-in är alltid okänd data.

Personliga check-ins hjälper användaren att dokumentera förekomst, frånvaro eller
nivå för en signal vid en viss tidpunkt. Trace ska visa när underlaget är
ofullständigt i stället för att fylla luckorna med antaganden.

### Bevis och motbevis ska vara synliga

Användaren ska kunna se varför en observation lyfts, vad som talar emot den, vilken
data som saknas och hur undersökningen genomfördes. Trace får inte leta fritt och
bara visa den kombination som råkar se starkast ut.

### Användaren har kontroll över sin data

Användaren ska förstå vad som sparas och kunna exportera eller permanent radera
sin data. Personliga hälsouppgifter får inte delas eller användas utanför det
nödvändiga produktflödet utan ett tydligt och informerat val.

## Fyra kunskapsnivåer

Trace håller fyra nivåer åtskilda:

1. **Registrerad uppgift**  
   Det användaren uttryckligen har loggat eller bekräftat. Okända ingredienser,
   tider och frånvaroperioder fylls inte i.
2. **Beskrivande summering**  
   En deterministisk lista eller sammanräkning av registrerade uppgifter,
   exempelvis ”du loggade sju måltider”. Den kräver ingen evidensmetod.
3. **Analysresultat**  
   Ett versionerat, reproducerbart resultat från ett fryst dataunderlag och en
   exakt analysmetod. Resultatet är inte automatiskt lämpligt att visa som ett
   möjligt mönster.
4. **Evidenspresentation**  
   Ett analysresultat som har klarat metodens kontroll för användarvänd
   presentation och visar underlag, motbevis, dataluckor och begränsningar.

Språkmodellen får inte flytta ett påstående från en nivå till en annan. Avsaknad
av en aktiverad analysmetod blockerar aldrig registrering, tidslinje eller
beskrivande summeringar.

## Produkt–capability-matris

Matrisens första kolumn är den kanoniska, stabila identiteten för respektive
produktcapability. Arkitekturens operationer och verifieringar refererar till dessa
ID:n; en namnändring ändrar inte ID:t och ett semantiskt annat löfte får ett nytt
ID. Matrisen anger hur beslutade produktlöften får realiseras. `supported` betyder
att capabilityn ingår i målarkitekturen; det är inte ett påstående om aktuell
implementation. `required-before-public-release` måste vara verifierat innan Trace
släpps till andra användare eller allmänheten. Den privata, ägarstyrda MVP:n är
uttryckligen undantagen från denna publika releasegrind.
`required-before-method-release` gäller bara den namngivna evidenscapabilityn och
blockerar inte journalen eller en annan metod. Ett löfte som senareläggs eller
fortfarande kräver produktbeslut ska i stället märkas `deferred` respektive
`pending-decision`.

| Capability-ID                             | Produktlöfte                                         | Capability och ägare                                           | Ingång                                            | Status och gate                                                                                                                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `journal.records`                         | Registrera, rätta, läsa och ta bort journaluppgifter | Domänspecifika data- och runtime-capabilities                  | Naturligt språk eller explicit UI                 | `supported`; authority-, idempotens-, recovery- och undo-scenarier är `required-before-public-release`; sleep create/update kräver låst `SleepDurationConsistencyPolicy`; `RecoveryRetentionPolicy` måste vara låst |
| `journal.timeline`                        | Gemensam journaltidslinje                            | `journal.timeline.list`, härledd läsprojektion                 | Journal-UI eller verifierad query                 | `supported`; ordning och pagination är `required-before-public-release`                                                                                                                                             |
| `journal.check_ins`                       | Personliga signaler och check-ins                    | Check-in-domänen med conversation- och surface-neutral ingress | Chatt, check-in-kort eller notis                  | `supported`; concurrent submission är `required-before-public-release`                                                                                                                                              |
| `journal.summaries`                       | Beskrivande summeringar                              | Deterministiska query-capabilities                             | Chatt eller journal-UI                            | `supported`; får användas utan analysmetod                                                                                                                                                                          |
| `journal.experiment_periods`              | Användarinitierade experimentperioder                | `ExperimentPeriod` och vanliga runtime-commands                | Chatt eller explicit UI                           | `supported`; perioden måste märkas som användarinitierad                                                                                                                                                            |
| `analysis.evidence`                       | Evidensanalys                                        | Analysramverk plus en specifik `AnalysisMethodVersion`         | On-demand eller separat beslutad bakgrundskörning | `required-before-method-release` för exakt metodversion                                                                                                                                                             |
| `analysis.event_food_association`         | Händelsebaserad matassociation                       | Händelsebaserad metod                                          | Evidensanalys                                     | `required-before-method-release`; beslut, validering och aktivering återstår                                                                                                                                        |
| `analysis.tracked_state_food_association` | Tillståndsbaserad matassociation                     | Tillståndsbaserad metod                                        | Evidensanalys                                     | `required-before-method-release`; beslut, validering och aktivering återstår                                                                                                                                        |
| `account.data_export`                     | Komplett dataexport                                  | Exporttjänst med versionerat manifest                          | Kontoinställningar, valfritt även chatt           | `required-before-public-release`; komplett, retry-säker och utan LLM                                                                                                                                                |
| `account.privacy_erasure`                 | Permanent kontoradering                              | Skyddad account-lifecycle och raderingsledger                  | Kontoinställningar med särskild bekräftelse       | `required-before-public-release`; irreversibel och verifierad över alla lagringsytor; `OPEN-001` stänger provider-/backupgränsen och låser completion-replaypolicyn                                                 |
| `privacy.external_health_data_processing` | Extern behandling av hälsodata                       | Provider- och privacykonfiguration                             | Compiler, analys och driftintegrationer           | `required-before-public-release`; `OPEN-001` måste vara stängd                                                                                                                                                      |

Varken en metodskiss, en validering eller en aktivering ändrar de andra två.
Metodversionen är oföränderlig, valideringen visar vilka tester den versionen har
klarat och aktiveringen avgör separat om den får ge användarvända resultat i en
viss miljö. De två initiala metodfamiljerna får valideras och aktiveras oberoende.

## Undersökningsnivåer

Inom kunskapsnivån **evidenspresentation** skiljer Trace mellan fyra
användarvända undersökningsnivåer:

1. **Otillräckligt underlag**  
   Trace visar vilken data som saknas och varför en association ännu inte kan
   bedömas. Detta är inte ett evidenskort med ett fynd.
2. **Inget stött mönster i det undersökta underlaget**  
   Underlaget räckte för den valda metoden och Trace genomförde den
   förregistrerade sökningen, men ingen möjlig association klarade metodens
   effekt- och promotionskrav. Trace visar sökrymd, datatäckning och det negativa
   resultatet eller motbevisen. Det betyder inte att ett samband är omöjligt,
   och utfallet innehåller inget fynd eller någon rekommendation.
3. **Tidig observation**  
   En möjlig association har hittats i den period som undersöktes, men har ännu
   inte prövats mot senare data.
4. **Möjligt återkommande mönster**  
   Associationens riktning har återkommit i senare data som inte användes för att
   hitta den första observationen.

## Produktgränser

Trace:

- diagnostiserar inte
- framställer inte association som orsak
- ordinerar inte behandling eller kostförändring
- initierar inte elimineringar, återintroduktioner eller andra interventioner
- behandlar inte saknad data som bevis för frånvaro
- intygar inte att ett användarinitierat experiment är säkert eller medicinskt
  lämpligt

Trace får hjälpa användaren dokumentera ett eget experiment och jämföra perioder,
men resultatet förblir en observation av den personliga datan.

## Illustrativt evidenskort

Evidenskortet kan visas som ett visuellt kort, ett strukturerat chattmeddelande
eller en rapport. Följande visar den avsedda upplevelsen; siffrorna är exempel:

```text
Tidig observation
Mejerier och uppblåsthet

Observerat
Mejerier förekom inom 6 timmar före 7 av 9 dokumenterade försämringar.

Jämförelse
Mejerier förekom också i 6 av 11 jämförbara bättre perioder.

Undersökt tidsfönster
0–6 timmar före varje dokumenterad försämring.

Datatäckning
17 av 20 perioder kunde undersökas. Tre saknade tillräcklig information.

Bedömning
Sambandet har ännu inte prövats mot senare, tidigare osedd data.
```

Kortet visar underlaget och osäkerheten. Det är inte ett medicinskt råd.

## Fördjupning

- [Evidensmodell](docs/architecture/analysis/evidence.md)
- [Livsmedelsexponering](docs/architecture/analysis/food-exposure.md)
- [Målarkitektur](docs/architecture/README.md)
- [Beslut och öppna frågor](docs/architecture/decisions/README.md)
