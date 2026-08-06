import { CHAT_MODEL, createSafetyIdentifier, getOpenAIClient } from './model';

const TITLE_MAX_LENGTH = 60;

const TITLE_SYSTEM_PROMPT = `Skapa en neutral ämnestitel på 3–7 ord på samma språk som användarens första meddelande. Återge bara sådant användaren uttryckligen har uppgett. Formulera möjliga samband som ”X och Y”, aldrig som orsak eller ”möjliga orsaker”. Svara endast med titeln.`;

export async function generateConversationTitle(
	firstUserMessage: string,
	userId: string,
	signal: AbortSignal
): Promise<string | null> {
	const response = await getOpenAIClient().responses.create(
		{
			model: CHAT_MODEL,
			instructions: TITLE_SYSTEM_PROMPT,
			input: firstUserMessage,
			reasoning: { effort: 'none', context: 'current_turn' },
			max_output_tokens: 32,
			store: false,
			tools: [],
			text: { verbosity: 'low' },
			safety_identifier: createSafetyIdentifier(userId)
		},
		{ signal }
	);

	if (response.status !== 'completed') return null;
	return normalizeGeneratedTitle(response.output_text);
}

export function normalizeGeneratedTitle(value: unknown): string | null {
	if (typeof value !== 'string') return null;

	const title = value
		.trim()
		.replace(/^["'“”‘’]+|["'“”‘’]+$/gu, '')
		.replace(/[.!?;:]+$/u, '')
		.replace(/\s+/gu, ' ')
		.trim();

	if (!title || title.length > TITLE_MAX_LENGTH) return null;
	return title;
}
