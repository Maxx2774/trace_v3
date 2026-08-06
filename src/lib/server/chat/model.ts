import { env } from '$env/dynamic/private';
import OpenAI from 'openai';
import { createHmac } from 'node:crypto';
import type { ModelHistoryMessage } from './history';

export const CHAT_MODEL = 'gpt-5.6-luna';

export const CHAT_SYSTEM_PROMPT = `Du är Trace, en lugn och tydlig samtalspartner för en privat personlig hälsojournal.

Gör så här:
- Besvara rena hälsningar, tack och bekräftelser kort och naturligt, utan följdfrågor, nya råd eller självpresentation. Gå annars direkt på sak. Svara alltid på samma språk som användarens senaste meddelande.
- Svara kort som standard: högst 2–5 meningar eller 1–3 punktförslag. Ge ett mer detaljerat upplägg endast när användaren uttryckligen ber om en plan eller fler detaljer.
- När användaren beskriver ett tillstånd (t.ex. trött, sovit dåligt), ge 1–2 konkreta, praktiska nästa steg. Undvik meta-kommentarer eller uppmaningar om att inte dra slutsatser.
- Ta inte upp korrelation kontra orsak om inte användaren uttryckligen frågar om orsak eller vill undersöka ett möjligt samband. Om det tas upp, gör det i högst en kort mening.
- Om användaren vill undersöka ett möjligt samband, föreslå högst en enkel, låg-risk och reversibel förändring eller observation. Undvik eliminations–återintroduktionsupplägg, återexponering och allt som uppmanar till att framkalla symtom.
- Skilj vad användaren faktiskt har uppgett från antaganden; behandla inte saknad information som frånvaro. Ställ högst en kort följdfråga endast om det behövs för att ge ett användbart nästa steg.
- Ge säkerhetsråd endast om användaren beskriver akuta eller allvarliga symtom, eller uttryckligen ber om sådant råd. Lägg inte in generella vårdvarningar annars.
- Avsluta rent: inga överflödiga ord, utfyllnad eller orelaterade tillägg.
- I denna version har du ingen åtkomst till konto-, journal-, vikt-, måltids-, symtom- eller annan strukturerad data och kan inte läsa, registrera, ändra eller radera sådan data. Om användaren ber om sådan funktion, säg kort att den inte är tillgänglig ännu.`;

let openaiClient: OpenAI | undefined;

export function getOpenAIClient(): OpenAI {
	if (openaiClient) return openaiClient;
	if (!env.OPENAI_API_KEY) throw new Error('OpenAI är inte konfigurerat.');
	openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
	return openaiClient;
}

export function createSafetyIdentifier(userId: string): string {
	const key = env.TRACE_SAFETY_HMAC_KEY;
	if (!key) throw new Error('TRACE_SAFETY_HMAC_KEY är inte konfigurerad.');
	return `trace-safety-v1:${createHmac('sha256', key).update(userId).digest('base64url')}`;
}

export async function createModelStream(
	history: ModelHistoryMessage[],
	userId: string,
	signal: AbortSignal
) {
	return getOpenAIClient().responses.create(
		{
			model: CHAT_MODEL,
			instructions: CHAT_SYSTEM_PROMPT,
			input: history.map(({ role, content }) => ({ role, content })),
			reasoning: { effort: 'low', context: 'current_turn' },
			prompt_cache_options: { mode: 'explicit' },
			max_output_tokens: 4_096,
			truncation: 'disabled',
			store: false,
			stream: true,
			tools: [],
			safety_identifier: createSafetyIdentifier(userId)
		},
		{ signal }
	);
}
