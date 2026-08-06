import type { ConversationDetail, ConversationPage } from '$lib/features/chat/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getConversation } = vi.hoisted(() => ({ getConversation: vi.fn() }));

vi.mock('$lib/features/chat/conversations.remote', () => ({
	deleteConversation: vi.fn(),
	getConversation,
	listConversations: vi.fn(),
	renameConversation: vi.fn()
}));

const { createChatSession } = await import('$lib/features/chat/chat-session.svelte');

const initialConversationPage: ConversationPage = {
	conversations: [summary('10000000-0000-4000-8000-000000000000', 'Första konversationen')],
	nextCursor: null
};

beforeEach(() => getConversation.mockReset());

describe('ChatSession.selectConversation', () => {
	it('navigates immediately and fills the empty conversation when messages arrive', async () => {
		const pending = deferred<ConversationDetail>();
		const onMessagesChanged = vi.fn();
		getConversation.mockReturnValueOnce(pending.promise);
		const session = createChatSession({ initialConversationPage, onMessagesChanged });

		session.openHistory();
		const selection = session.selectConversation(initialConversationPage.conversations[0].id);

		expect(session.historyOpen).toBe(false);
		expect(session.activeConversationId).toBe(initialConversationPage.conversations[0].id);
		expect(session.messages).toEqual([]);
		expect(session.conversationLoading).toBe(true);

		const conversation = detail(initialConversationPage.conversations[0]);
		pending.resolve(conversation);
		await selection;

		expect(session.messages).toEqual(conversation.messages);
		expect(session.conversationLoading).toBe(false);
		expect(onMessagesChanged).toHaveBeenCalledTimes(1);
	});

	it('ignores an older response after another conversation has been selected', async () => {
		const secondSummary = summary('20000000-0000-4000-8000-000000000000', 'Andra konversationen');
		const firstPending = deferred<ConversationDetail>();
		const secondPending = deferred<ConversationDetail>();
		getConversation
			.mockReturnValueOnce(firstPending.promise)
			.mockReturnValueOnce(secondPending.promise);
		const session = createChatSession({
			initialConversationPage: {
				conversations: [...initialConversationPage.conversations, secondSummary],
				nextCursor: null
			},
			onMessagesChanged: vi.fn()
		});

		const firstSelection = session.selectConversation(initialConversationPage.conversations[0].id);
		const secondSelection = session.selectConversation(secondSummary.id);
		secondPending.resolve(detail(secondSummary));
		await secondSelection;
		firstPending.resolve(detail(initialConversationPage.conversations[0]));
		await firstSelection;

		expect(session.activeConversationId).toBe(secondSummary.id);
		expect(session.messages[0]?.conversationId).toBe(secondSummary.id);
		expect(session.conversationLoading).toBe(false);
	});

	it('ignores a pending response after starting a new conversation', async () => {
		const pending = deferred<ConversationDetail>();
		getConversation.mockReturnValueOnce(pending.promise);
		const session = createChatSession({
			initialConversationPage,
			onMessagesChanged: vi.fn()
		});

		const selection = session.selectConversation(initialConversationPage.conversations[0].id);
		session.startNewConversation();
		pending.resolve(detail(initialConversationPage.conversations[0]));
		await selection;

		expect(session.activeConversationId).toBeNull();
		expect(session.messages).toEqual([]);
		expect(session.conversationLoading).toBe(false);
	});
});

function summary(id: string, title: string) {
	return {
		id,
		title,
		createdAt: '2026-08-06T10:00:00.000Z',
		updatedAt: '2026-08-06T10:00:00.000Z',
		lastMessageAt: '2026-08-06T10:00:00.000Z'
	};
}

function detail(conversation: ReturnType<typeof summary>): ConversationDetail {
	return {
		...conversation,
		messages: [
			{
				id: crypto.randomUUID(),
				conversationId: conversation.id,
				turnId: crypto.randomUUID(),
				role: 'user',
				content: 'Testmeddelande',
				createdAt: conversation.createdAt
			}
		]
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}
