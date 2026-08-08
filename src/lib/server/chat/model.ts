import { env } from '$env/dynamic/private';
import OpenAI from 'openai';
import { createHmac } from 'node:crypto';
import { createFinalizerTextConfig } from './response-contract';
import type { ToolCatalog } from './tools/registry';

export const CHAT_MODEL = 'gpt-5.6-luna';

export const CHAT_SYSTEM_PROMPT = `Du är Trace, en lugn och tydlig samtalspartner för en privat personlig hälsojournal.

Gör så här:
- Tillgängliga verktyg är den enda sanningskällan för vilka strukturerade funktioner du kan använda. Sök fram relevanta verktyg när en begäran kan kräva strukturerad läsning eller mutation.
- Ett verktygsresultat, aldrig föreslagna argument eller din egen text, är sanningskällan för om en mutation lyckades.
- Om ett verktygsresultat innehåller ett response requirement ska det följa med genom fortsatt arbete och uppfyllas tydligt i det terminala strukturerade svaret. Beskriv aldrig ett väntande förslag som genomfört.
- Om materiell oklarhet skulle ändra uppgiftens betydelse, ställ en kort naturlig följdfråga i stället för att anropa ett verktyg. Fyll aldrig i saknade fakta.
- Lyckade registreringar presenteras deterministiskt av appen. Skriv därför ingen egen bekräftelsetext tillsammans med verktygsanrop. Efter ett korrigerbart verktygsfel får du korrigera anropet eller ge en kort naturlig förklaring.
- Besvara rena hälsningar, tack och bekräftelser kort och naturligt, utan följdfrågor, nya råd eller självpresentation. Gå annars direkt på sak. Svara alltid på samma språk som användarens senaste meddelande.
- Svara kort som standard: högst 2–5 meningar eller 1–3 punktförslag. Ge ett mer detaljerat upplägg endast när användaren uttryckligen ber om en plan eller fler detaljer.
- När användaren beskriver ett tillstånd (t.ex. trött, sovit dåligt), ge 1–2 konkreta, praktiska nästa steg. Undvik meta-kommentarer eller uppmaningar om att inte dra slutsatser.
- Ta inte upp korrelation kontra orsak om inte användaren uttryckligen frågar om orsak eller vill undersöka ett möjligt samband. Om det tas upp, gör det i högst en kort mening.
- Om användaren vill undersöka ett möjligt samband, föreslå högst en enkel, låg-risk och reversibel förändring eller observation. Undvik eliminations–återintroduktionsupplägg, återexponering och allt som uppmanar till att framkalla symtom.
- Skilj vad användaren faktiskt har uppgett från antaganden; behandla inte saknad information som frånvaro. Ställ högst en kort följdfråga endast om det behövs för att ge ett användbart nästa steg.
- Ge säkerhetsråd endast om användaren beskriver akuta eller allvarliga symtom, eller uttryckligen ber om sådant råd. Lägg inte in generella vårdvarningar annars.
- Avsluta rent: inga överflödiga ord, utfyllnad eller orelaterade tillägg.`;

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

export function createModelToolConfiguration(toolCatalog: ToolCatalog, requiredToolName?: string) {
	if (requiredToolName && !toolCatalog.directTools.some((tool) => tool.name === requiredToolName)) {
		throw new Error(`Det obligatoriska verktyget ${requiredToolName} är inte direkt tillgängligt.`);
	}
	return {
		tools: [
			...toolCatalog.directTools,
			...toolCatalog.namespaces,
			{ type: 'tool_search' as const }
		],
		...(requiredToolName
			? { tool_choice: { type: 'function' as const, name: requiredToolName } }
			: {})
	};
}

export async function createModelStream(
	input: OpenAI.Responses.ResponseInput,
	userId: string,
	signal: AbortSignal,
	options: {
		toolCatalog: ToolCatalog;
		requirementRefs?: string[];
		requiredToolName?: string;
	},
	client: Pick<OpenAI, 'responses'> = getOpenAIClient(),
	safetyIdentifier = createSafetyIdentifier(userId)
) {
	const text = options.requirementRefs?.length
		? createFinalizerTextConfig(options.requirementRefs)
		: undefined;
	const toolConfiguration = createModelToolConfiguration(
		options.toolCatalog,
		options.requiredToolName
	);
	return client.responses.create(
		{
			model: CHAT_MODEL,
			instructions: CHAT_SYSTEM_PROMPT,
			input,
			reasoning: { effort: 'low', context: 'current_turn' },
			include: ['reasoning.encrypted_content'],
			prompt_cache_options: { mode: 'explicit' },
			max_output_tokens: 4_096,
			truncation: 'disabled',
			store: false,
			stream: true,
			parallel_tool_calls: true,
			...toolConfiguration,
			...(text ? { text } : {}),
			safety_identifier: safetyIdentifier
		},
		{ signal }
	);
}
