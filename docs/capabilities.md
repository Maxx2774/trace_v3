# Nuvarande funktionalitet

Detta dokument beskriver verifierat beteende som finns implementerat i Trace v3 just nu.
Det är en nulägesbild, inte en roadmap eller en lista över beslutade produktlöften. Planerad
funktionalitet hör hemma i `product.md`.

## Autentisering och konto

- Appytan kräver en giltig Supabase-session som verifieras på servern med `getClaims()`.
- Användaren kan skapa konto och logga in med e-post och lösenord.
- Google OAuth och lokal utloggning är implementerade.
- Skyddade länkar bevarar den avsedda destinationen genom inloggningsflödet.

## Chatt

- Användaren kan skicka textmeddelanden och få ett direkt strömmat AI-svar när meddelandet
  inte enbart leder till en lyckad måltidsregistrering.
- Ett pågående svar kan avbrytas fram till att servern har skickat sitt färdiga event.
  Avbryt-knappen försvinner då direkt även om nätverksströmmen fortfarande håller på att
  stängas. Ett avbrutet eller ofullständigt assistantsvar sparas inte.
- AI-svar kan visa säker Markdown för rubriker, listor, betoning, länkar och inline-kod.
- Ett användarmeddelande får vara högst 5 000 tecken.
- Modellen får som mest 20 hela turer inklusive den aktuella och 40 meddelanden inom en total
  kontextbudget på 48 000 tecken och uppskattningsvis 12 000 tokens. Äldre meddelanden
  ligger fortfarande kvar i den sparade konversationen.
- Konversationslistan kan öppnas medan ett svar strömmas. Ny chatt är avstängd tills
  streamingen har avslutats.
- Tekniska fel som kan återhämtas visar **Försök igen** och återanvänder samma tur, så att
  redan sparade journalposter inte skapas en gång till.

## Måltider

- Användaren kan registrera mat eller dryck som hen faktiskt har konsumerat genom att
  beskriva det naturligt i chatten.
- Ett måltidskort motsvarar ett konsumtionstillfälle med en valfri måltidstyp, en gemensam
  tidsuppgift och ett eller flera items. Varje item är en separat rätt, mat, dryck eller ett
  tillbehör och kan ha sina egna uttryckligen angivna ingredienser.
- Måltidstypen kan vara Frukost, Lunch, Middag, Mellanmål eller Annat. Om modellen inte
  säkert känner typen sparas den som okänd tills användaren väljer en typ i kortet.
- En tur kan registrera flera tydligt åtskilda konsumtionstillfällen. Varje måltid, dess
  items och ingredienser sparas atomiskt och idempotent med stabila ID:n.
- Planerade, hypotetiska och andra personers måltider ska inte registreras. Modellen får
  inte lägga till ingredienser som användaren inte har nämnt eller bekräftat. Ett item utan
  sparade ingredienser visas utan antagna receptbeståndsdelar.
- Måltidens tidsuppgift bevarar skillnaden mellan exakt tid, ungefärlig tid, endast lokalt
  datum och helt okänd tid. Relativa tidsuttryck tolkas mot serverns tid och webbläsarens
  validerade IANA-tidszon.
- Kortet visar Idag, Igår eller veckodag för närliggande historiska datum och annars ett
  kort absolut datum. Framtida datum presenteras aldrig som exempelvis Imorgon.
- En ren, lyckad måltidsregistrering visas direkt efter användarmeddelandet som
  **✓ Registrerat** följt av ett strukturerat kort. Appen fortsätter inte AI-svaret för att
  formulera en separat bekräftelsetext.
- Om samma meddelande även innehåller en faktisk fråga registreras måltiden först och ett
  kort naturligt svar på frågan kan därefter visas efter kortet.
- Från en färdig, sparad konversation kan användaren ändra måltidstyp, datum och tid samt
  redigera, lägga till och ta bort enskilda items och ingredienser. Varje delåtgärd ersätter
  hela den kanoniska strukturen atomiskt med revisionsskydd och idempotent retry.
- Det sista itemet kan inte tas bort från kortet. Varje lyckad ändring använder serverns
  fullständiga returvärde och överlever omladdning; en samtidig versionskonflikt erbjuder
  omladdning i stället för att visa osparad data som kanonisk.
- Måltidskort återställs från referenser i den sparade konversationen och batchhydreras med
  den senaste kanoniska revisionen. Startsidan visar ingen separat måltidsöversikt.

## Sparade konversationer

- Konversationer och meddelanden sparas i Supabase och är knutna till den autentiserade
  användaren.
- De 25 senaste konversationssammanfattningarna förladdas på servern innan appytan visas.
- Tomläget för en ny chatt visar de tre senaste konversationerna direkt under skrivfältet och
  låter användaren öppna dem utan att först gå till hela konversationslistan. Raderna visar
  tid för dagens samtal, **Igår** för gårdagens och kort datum för äldre samtal.
- Ytterligare 20 sammanfattningar hämtas när användaren närmar sig slutet av listan.
- Listan grupperar samtal adaptivt under Idag, Igår, Den här veckan, Förra veckan och
  äldre månadsrubriker. Dagens och gårdagens rader visar tid, veckogrupper visar veckodag
  och tid, och äldre rader visar kort datum utan att upprepa grupprubriken i varje rad.
- När en konversation väljs visas konversationsvyn omedelbart med en tom meddelandeyta.
  De senaste 20 hela chattvändorna, normalt upp till 40 meddelanden, tonas in när ett
  sammanslaget serveranrop har hämtat både meddelanden och tillhörande måltidskort.
- När användaren närmar sig början av den laddade historiken hämtas 15 äldre hela vändor,
  normalt upp till 30 meddelanden, med cursor-paginering. Äldre innehåll läggs ovanför utan
  att flytta den synliga scrollpositionen, och sena svar från äldre val ignoreras.
- En konversation kan raderas från både listvyn och den öppna konversationen.

## Konversationstitlar

- En ny konversation får först en provisorisk titel från användarens första meddelande.
- Efter det första sparade AI-svaret genereras en kort titel separat från chattsvaret.
- Den automatiska titeln följer användarens språk, är högst 60 tecken och ska inte lägga
  till diagnoser, orsaker eller andra antaganden.
- Om titelgenereringen misslyckas behålls den provisoriska titeln.
- Användaren kan ändra titeln manuellt från listvyn. Ett manuellt namn skrivs inte över
  av en senare automatisk titeluppdatering.

## Gränssnitt

- Chatten visas i en responsiv panel med separata vyer för aktuell konversation och historik.
- Ljust och mörkt tema kan väljas i Inställningar och sparas lokalt i webbläsaren.
- Laddning av konversationsmeddelanden respekterar `prefers-reduced-motion`.

## Inte implementerat ännu

- Hela måltider kan ännu inte raderas. Chatten har inget läsverktyg för historiska
  måltidsfrågor utanför den begränsade konversationskontexten.
- Symtom, vikt, sparade rätter och annan strukturerad hälsodata kan ännu inte registreras,
  läsas, ändras eller raderas via chatten.
- Evidensanalys och presentation av personliga mönster är inte implementerat.
- Dataexport och permanent kontoradering är inte implementerat.
- Manuell ändring av en konversationstitel finns endast i listvyn.

## Verifiering

Appkoden verifieras med:

```sh
pnpm check
pnpm test
pnpm lint
pnpm build
```

Databaskontrakten finns i `supabase/tests/chat.sql` och `supabase/tests/meal_logging.sql`.
De verifierar bland annat lease/fencing, replay, idempotens, cursor-paginering på hela
chattvändor, måltidshydrering, tidsprecision, RLS, grants, index och cascade-beteende.
