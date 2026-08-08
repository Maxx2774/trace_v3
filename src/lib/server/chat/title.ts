import { CONVERSATION_CATEGORIES, type ConversationCategory } from '$lib/features/chat/contracts';
import type OpenAI from 'openai';
import { CHAT_MODEL, createSafetyIdentifier, getOpenAIClient } from './model';

const TITLE_MAX_LENGTH = 60;

const TITLE_SYSTEM_PROMPT = `Skapa metadata för en konversation enbart från användarens första meddelande.

Titeln ska vara en neutral ämnestitel på 3–7 ord på samma språk som meddelandet. Återge bara sådant användaren uttryckligen har uppgett. Formulera möjliga samband som ”X och Y”, aldrig som orsak eller ”möjliga orsaker”.

Kategorin beskriver meddelandets huvudsakliga ämne eller avsikt:
- meal: mat eller dryck som användaren har ätit eller druckit, eller en måltid som huvudsakligt ämne
- symptom: kroppsliga eller psykiska symtom och besvär
- sleep: sömn, insomning, uppvaknanden eller sömnkvalitet
- weight: kroppsvikt, vägning eller viktförändring
- general: allt annat

Om flera ämnen nämns väljer du det som är meddelandets huvudsakliga avsikt. Klassificera inte efter en incidental detalj.`;

export type GeneratedConversationMetadata = {
	title: string;
	category: ConversationCategory;
};

export function createConversationTitleRequest(firstUserMessage: string, safetyIdentifier: string) {
	return {
		model: CHAT_MODEL,
		instructions: TITLE_SYSTEM_PROMPT,
		input: firstUserMessage,
		reasoning: { effort: 'none' as const, context: 'current_turn' as const },
		max_output_tokens: 64,
		store: false,
		tools: [],
		text: {
			verbosity: 'low' as const,
			format: {
				type: 'json_schema' as const,
				name: 'conversation_metadata',
				strict: true,
				schema: {
					type: 'object',
					properties: {
						title: { type: 'string', minLength: 1, maxLength: TITLE_MAX_LENGTH },
						category: { type: 'string', enum: [...CONVERSATION_CATEGORIES] }
					},
					required: ['title', 'category'],
					additionalProperties: false
				}
			}
		},
		safety_identifier: safetyIdentifier
	} satisfies OpenAI.Responses.ResponseCreateParamsNonStreaming;
}

export async function generateConversationTitle(
	firstUserMessage: string,
	userId: string,
	signal: AbortSignal,
	client: Pick<OpenAI, 'responses'> = getOpenAIClient(),
	safetyIdentifier = createSafetyIdentifier(userId)
): Promise<GeneratedConversationMetadata | null> {
	const response = await client.responses.create(
		createConversationTitleRequest(firstUserMessage, safetyIdentifier),
		{ signal }
	);

	if (response.status !== 'completed') return null;
	return normalizeGeneratedConversationMetadata(response.output_text);
}

export function normalizeGeneratedConversationMetadata(
	value: unknown
): GeneratedConversationMetadata | null {
	if (typeof value !== 'string') return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return null;
	}

	if (!isRecord(parsed) || !isConversationCategory(parsed.category)) return null;
	const title = normalizeGeneratedTitle(parsed.title);
	return title ? { title, category: parsed.category } : null;
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

function isConversationCategory(value: unknown): value is ConversationCategory {
	return (
		typeof value === 'string' && CONVERSATION_CATEGORIES.includes(value as ConversationCategory)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
