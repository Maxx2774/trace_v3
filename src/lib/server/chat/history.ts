import {
	CHAT_CONTEXT_MAX_CHARACTERS,
	CHAT_HISTORY_MAX_TURNS,
	type ChatMessage
} from '$lib/features/chat/contracts';

export type ModelHistoryMessage = Pick<ChatMessage, 'role' | 'content' | 'turnId'>;

export function assertHistoryBudget(history: ModelHistoryMessage[], systemPrompt: string): void {
	const turnCount = new Set(history.map((message) => message.turnId)).size;
	const characterCount =
		systemPrompt.length + history.reduce((total, message) => total + message.content.length, 0);

	if (turnCount > CHAT_HISTORY_MAX_TURNS || characterCount > CHAT_CONTEXT_MAX_CHARACTERS) {
		throw new Error('Databasen returnerade historik utanför den låsta budgeten.');
	}
}
