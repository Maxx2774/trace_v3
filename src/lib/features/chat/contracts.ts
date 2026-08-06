export const CHAT_MESSAGE_MAX_LENGTH = 5_000;
export const CHAT_HISTORY_MAX_TURNS = 20;
export const CHAT_CONTEXT_MAX_CHARACTERS = 48_000;
export const INITIAL_CONVERSATION_COUNT = 25;
export const CONVERSATION_PAGE_SIZE = 20;

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

export type ConversationDetail = ConversationSummary & {
	messages: ChatMessage[];
};

export type ChatStreamRequest = {
	conversationId: string | null;
	turnId: string;
	message: string;
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
			type: 'done';
			turnId: string;
			message: ChatMessage;
			conversation: ConversationSummary;
	  }
	| {
			type: 'error';
			turnId: string;
			code:
				| 'upstream_error'
				| 'incomplete_response'
				| 'timeout'
				| 'empty_response'
				| 'persistence_error';
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
