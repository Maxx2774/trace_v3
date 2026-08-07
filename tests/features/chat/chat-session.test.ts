import type {
	ChatStreamEvent,
	ConversationDetailPage,
	ConversationPage
} from '$lib/features/chat/contracts';
import type { TurnJournalRecord } from '$lib/features/journal/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mealFixture, mealRecordFixture } from '../../helpers/meals';

const { deleteConversation, getConversation, streamChat } = vi.hoisted(() => ({
	deleteConversation: vi.fn(),
	getConversation: vi.fn(),
	streamChat: vi.fn()
}));

vi.mock('$lib/features/chat/conversations.remote', () => ({
	deleteConversation,
	getConversation,
	listConversations: vi.fn(),
	renameConversation: vi.fn()
}));

vi.mock('$lib/features/chat/stream-client', () => ({ streamChat }));

const { createChatSession, upsertJournalRecord } =
	await import('$lib/features/chat/chat-session.svelte');

const initialConversationPage: ConversationPage = {
	conversations: [summary('10000000-0000-4000-8000-000000000000', 'Första konversationen')],
	nextCursor: null
};

beforeEach(() => {
	deleteConversation.mockReset();
	getConversation.mockReset();
	streamChat.mockReset();
});

describe('ChatSession streaming lifecycle', () => {
	it('stops offering cancellation as soon as the completed event arrives', async () => {
		const streamFinished = deferred<void>();
		let emit!: (event: ChatStreamEvent) => void;
		let signal!: AbortSignal;
		streamChat.mockImplementationOnce((input) => {
			emit = input.onEvent;
			signal = input.signal;
			return streamFinished.promise;
		});
		const session = createChatSession({
			initialConversationPage,
			onMessagesChanged: vi.fn()
		});

		session.submit('Hej');
		const turnId = session.messages[0].turnId;
		const conversation = summary('20000000-0000-4000-8000-000000000000', 'Hälsning och samtal');
		emit({
			type: 'conversation',
			turnId,
			conversation,
			message: {
				id: session.messages[0].id,
				conversationId: conversation.id,
				turnId,
				role: 'user',
				content: 'Hej',
				createdAt: session.messages[0].createdAt
			}
		});

		expect(session.streaming).toBe(true);
		expect(session.canStopResponse).toBe(true);

		emit({
			type: 'done',
			turnId,
			conversation,
			message: {
				id: session.messages[1].id,
				conversationId: conversation.id,
				turnId,
				role: 'assistant',
				content: 'Hej!',
				createdAt: '2026-08-06T10:00:01.000Z'
			}
		});

		expect(session.streaming).toBe(true);
		expect(session.canStopResponse).toBe(false);
		session.stopResponse();
		expect(signal.aborted).toBe(false);

		streamFinished.resolve(undefined);
		await vi.waitFor(() => expect(session.streaming).toBe(false));
	});
});

describe('ChatSession.selectConversation', () => {
	it('navigates immediately and fills the empty conversation when messages arrive', async () => {
		const pending = deferred<ConversationDetailPage>();
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
		expect(getConversation).toHaveBeenCalledWith({
			id: initialConversationPage.conversations[0].id,
			before: null
		});
		expect(onMessagesChanged).toHaveBeenCalledTimes(1);
	});

	it('returns to history after deleting a conversation opened from history', async () => {
		const conversation = detail(initialConversationPage.conversations[0]);
		getConversation.mockResolvedValueOnce(conversation);
		deleteConversation.mockResolvedValueOnce({ id: conversation.id });
		const session = createChatSession({ initialConversationPage, onMessagesChanged: vi.fn() });

		session.openHistory();
		await session.selectConversation(conversation.id);
		await session.deleteConversation();

		expect(session.activeConversationId).toBeNull();
		expect(session.historyOpen).toBe(true);
	});

	it('opens a new chat after deleting a directly opened conversation', async () => {
		const conversation = detail(initialConversationPage.conversations[0]);
		getConversation.mockResolvedValueOnce(conversation);
		deleteConversation.mockResolvedValueOnce({ id: conversation.id });
		const session = createChatSession({ initialConversationPage, onMessagesChanged: vi.fn() });

		await session.selectConversation(conversation.id);
		await session.deleteConversation();

		expect(session.activeConversationId).toBeNull();
		expect(session.historyOpen).toBe(false);
	});

	it('ignores an older response after another conversation has been selected', async () => {
		const secondSummary = summary('20000000-0000-4000-8000-000000000000', 'Andra konversationen');
		const firstPending = deferred<ConversationDetailPage>();
		const secondPending = deferred<ConversationDetailPage>();
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
		const pending = deferred<ConversationDetailPage>();
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

	it('restores canonical meal cards from conversation history', async () => {
		const conversation = detail(initialConversationPage.conversations[0]);
		conversation.journalRecords = [mealRecord(conversation.messages[0].turnId)];
		getConversation.mockResolvedValueOnce(conversation);
		const session = createChatSession({ initialConversationPage, onMessagesChanged: vi.fn() });

		await session.selectConversation(conversation.id);

		expect(session.journalRecords).toEqual(conversation.journalRecords);
	});

	it('prepends older complete history pages without triggering bottom scrolling', async () => {
		const conversation = detail(initialConversationPage.conversations[0]);
		const currentMessage = conversation.messages[0];
		conversation.olderCursor = {
			createdAt: '2026-08-05T10:00:00.000Z',
			turnId: '30000000-0000-4000-8000-000000000000'
		};
		const olderMessage = {
			...currentMessage,
			id: '31000000-0000-4000-8000-000000000000',
			turnId: '32000000-0000-4000-8000-000000000000',
			content: 'Äldre meddelande',
			createdAt: '2026-08-04T10:00:00.000Z'
		};
		const olderPage: ConversationDetailPage = {
			...conversation,
			messages: [olderMessage],
			journalRecords: [],
			olderCursor: null
		};
		const onMessagesChanged = vi.fn();
		getConversation.mockResolvedValueOnce(conversation).mockResolvedValueOnce(olderPage);
		const session = createChatSession({ initialConversationPage, onMessagesChanged });

		await session.selectConversation(conversation.id);
		expect(session.hasOlderMessages).toBe(true);
		expect(session.startedAt).toBeNull();

		const loaded = await session.loadOlderMessages();

		expect(loaded).toBe(true);
		expect(getConversation).toHaveBeenLastCalledWith({
			id: conversation.id,
			before: conversation.olderCursor
		});
		expect(session.messages.map((message) => message.content)).toEqual([
			'Äldre meddelande',
			'Testmeddelande'
		]);
		expect(session.hasOlderMessages).toBe(false);
		expect(session.startedAt).toBe(olderMessage.createdAt);
		expect(onMessagesChanged).toHaveBeenCalledTimes(1);
	});

	it('ignores an older history page after changing conversations', async () => {
		const conversation = detail(initialConversationPage.conversations[0]);
		conversation.olderCursor = {
			createdAt: '2026-08-05T10:00:00.000Z',
			turnId: '33000000-0000-4000-8000-000000000000'
		};
		const olderPending = deferred<ConversationDetailPage>();
		getConversation.mockResolvedValueOnce(conversation).mockReturnValueOnce(olderPending.promise);
		const session = createChatSession({ initialConversationPage, onMessagesChanged: vi.fn() });
		await session.selectConversation(conversation.id);

		const loading = session.loadOlderMessages();
		session.startNewConversation();
		olderPending.resolve({ ...conversation, olderCursor: null });
		await loading;

		expect(session.activeConversationId).toBeNull();
		expect(session.messages).toEqual([]);
		expect(session.olderMessagesLoading).toBe(false);
	});

	it('keeps the older cursor available after an error so loading can be retried', async () => {
		const conversation = detail(initialConversationPage.conversations[0]);
		conversation.olderCursor = {
			createdAt: '2026-08-05T10:00:00.000Z',
			turnId: '34000000-0000-4000-8000-000000000000'
		};
		const olderPage = {
			...conversation,
			messages: [],
			journalRecords: [],
			olderCursor: null
		};
		getConversation
			.mockResolvedValueOnce(conversation)
			.mockRejectedValueOnce(new Error('Tillfälligt fel'))
			.mockResolvedValueOnce(olderPage);
		const session = createChatSession({ initialConversationPage, onMessagesChanged: vi.fn() });
		await session.selectConversation(conversation.id);

		await expect(session.loadOlderMessages()).resolves.toBe(false);
		expect(session.olderMessagesError).toBe('Äldre meddelanden kunde inte hämtas.');
		expect(session.hasOlderMessages).toBe(true);

		await expect(session.loadOlderMessages()).resolves.toBe(true);
		expect(session.olderMessagesError).toBeNull();
		expect(session.hasOlderMessages).toBe(false);
	});

	it('upserts replayed records without duplicating the meal', () => {
		const record = mealRecord('30000000-0000-4000-8000-000000000000');

		expect(upsertJournalRecord(upsertJournalRecord([], record), record)).toEqual([record]);
	});

	it('replaces a saved meal after inline editing', async () => {
		const conversation = detail(initialConversationPage.conversations[0]);
		conversation.journalRecords = [mealRecord(conversation.messages[0].turnId)];
		getConversation.mockResolvedValueOnce(conversation);
		const session = createChatSession({ initialConversationPage, onMessagesChanged: vi.fn() });
		await session.selectConversation(conversation.id);
		const original = conversation.journalRecords[0].record.value;
		const updated = {
			...original,
			revision: original.revision + 1,
			items: [
				{ ...original.items[0], name: 'Chiapudding' },
				{
					id: '43000000-0000-4000-8000-000000000000',
					name: 'Äggröra',
					amountText: null,
					ingredients: [
						{
							id: '44000000-0000-4000-8000-000000000000',
							name: 'Ägg',
							amountText: '4'
						}
					]
				}
			]
		};

		session.updateMealRecord(updated);

		expect(session.journalRecords[0].record.value).toEqual(updated);
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

function detail(conversation: ReturnType<typeof summary>): ConversationDetailPage {
	return {
		...conversation,
		journalRecords: [],
		olderCursor: null,
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

function mealRecord(turnId: string): TurnJournalRecord {
	return {
		turnId,
		record: mealRecordFixture(mealFixture())
	};
}
