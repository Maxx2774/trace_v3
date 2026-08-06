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

- Användaren kan skicka textmeddelanden och få ett direkt strömmat AI-svar.
- Ett pågående svar kan avbrytas. Ett avbrutet eller ofullständigt assistantsvar sparas inte.
- AI-svar kan visa säker Markdown för rubriker, listor, betoning, länkar och inline-kod.
- Ett användarmeddelande får vara högst 5 000 tecken.
- Modellen får som mest de 20 senaste turerna inom en total kontextbudget på 48 000 tecken.
  Äldre meddelanden ligger fortfarande kvar i den sparade konversationen.
- Konversationslistan kan öppnas medan ett svar strömmas. Ny chatt är avstängd tills
  streamingen har avslutats.

## Sparade konversationer

- Konversationer och meddelanden sparas i Supabase och är knutna till den autentiserade
  användaren.
- De 25 senaste konversationssammanfattningarna förladdas på servern innan appytan visas.
- Ytterligare 20 sammanfattningar hämtas när användaren närmar sig slutet av listan.
- Listan visar titel och relativt datum, exempelvis Idag, Igår eller Förra veckan.
- När en konversation väljs visas konversationsvyn omedelbart med en tom meddelandeyta.
  Meddelandena tonas in när hämtningen är klar, och sena svar från äldre val ignoreras.
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

- Chatten har inga verktyg och kan inte läsa, registrera, ändra eller radera strukturerad
  journal-, måltids-, symtom-, vikt- eller annan hälsodata.
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

Databaskontraktet finns i `supabase/tests/chat.sql` och körs med Supabase CLI.
