import type { TurnJournalRecord } from '$lib/features/journal/contracts';

export const CHAT_MESSAGE_MAX_LENGTH = 5_000;
export const CHAT_HISTORY_MAX_TURNS = 20;
export const CHAT_HISTORY_MAX_MESSAGES = 40;
export const CHAT_CONTEXT_MAX_CHARACTERS = 48_000;
export const CHAT_CONTEXT_MAX_ESTIMATED_TOKENS = 12_000;
export const INITIAL_CONVERSATION_COUNT = 25;
export const CONVERSATION_PAGE_SIZE = 20;
export const INITIAL_CONVERSATION_TURN_COUNT = 20;
export const CONVERSATION_HISTORY_TURN_PAGE_SIZE = 15;

export type ChatRole = 'user' | 'assistant';

export type ConversationSummary = {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	lastMessageAt: string;
};

export type ConversationCursor = {
	id: string;
	lastMessageAt: string;
};

export type ConversationPage = {
	conversations: ConversationSummary[];
	nextCursor: ConversationCursor | null;
};

export type ChatMessage = {
	id: string;
	conversationId: string;
	turnId: string;
	role: ChatRole;
	content: string;
	createdAt: string;
};

export type ConversationHistoryCursor = {
	createdAt: string;
	turnId: string;
};

export type ConversationDetailPage = ConversationSummary & {
	messages: ChatMessage[];
	journalRecords: TurnJournalRecord[];
	olderCursor: ConversationHistoryCursor | null;
};

export type ChatStreamRequest = {
	conversationId: string | null;
	turnId: string;
	message: string;
	timezone: string;
};

export type ChatStreamEvent =
	| {
			type: 'conversation';
			conversation: ConversationSummary;
			message: ChatMessage;
			turnId: string;
	  }
	| { type: 'delta'; turnId: string; text: string }
	| { type: 'replace'; turnId: string; text: string }
	| {
			type: 'journal_record_created';
			turnId: string;
			record: TurnJournalRecord['record'];
	  }
	| {
			type: 'done';
			turnId: string;
			message: ChatMessage;
			conversation: ConversationSummary;
	  }
	| {
			type: 'error';
			turnId: string;
			retryable: boolean;
			code:
				| 'upstream_error'
				| 'incomplete_response'
				| 'timeout'
				| 'empty_response'
				| 'persistence_error'
				| 'protocol_error'
				| 'tool_error'
				| 'turn_pending'
				| 'turn_conflict'
				| 'turn_failed_terminal'
				| 'not_found';
			message: string;
	  };

export type ChatHttpError = {
	code: string;
	message: string;
};

export function upsertConversation(
	conversations: ConversationSummary[],
	conversation: ConversationSummary
): ConversationSummary[] {
	const current = conversations.find((item) => item.id === conversation.id);
	const newestConversation =
		current && Date.parse(current.updatedAt) > Date.parse(conversation.updatedAt)
			? current
			: conversation;

	return [newestConversation, ...conversations.filter((item) => item.id !== conversation.id)].sort(
		(left, right) =>
			Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt) ||
			right.id.localeCompare(left.id)
	);
}
