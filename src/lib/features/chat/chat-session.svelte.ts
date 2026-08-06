import {
	deleteConversation as deleteConversationRemote,
	getConversation,
	listConversations,
	renameConversation as renameConversationRemote
} from './conversations.remote';
import {
	type ChatMessage,
	type ChatStreamEvent,
	type ConversationCursor,
	type ConversationHistoryCursor,
	type ConversationPage,
	type ConversationSummary,
	upsertConversation
} from './contracts';
import type { TurnJournalRecord } from '$lib/features/journal/contracts';
import type { Meal } from '$lib/features/meals/contracts';
import { streamChat } from './stream-client';

export type DisplayMessage = ChatMessage & { pending?: boolean };

type ActiveStream = {
	turnId: string;
	assistantId: string;
	controller: AbortController;
	persisted: boolean;
	stopRequested: boolean;
	manualStop: boolean;
	terminal: boolean;
	message: string;
	conversationId: string | null;
};

type ChatSessionOptions = {
	initialConversationPage: ConversationPage;
	onMessagesChanged: () => void | Promise<void>;
	onJournalRecordCreated?: (entry: TurnJournalRecord) => void | Promise<void>;
};

export function createChatSession(options: ChatSessionOptions) {
	return new ChatSession(options);
}

class ChatSession {
	messages = $state.raw<DisplayMessage[]>([]);
	journalRecords = $state.raw<TurnJournalRecord[]>([]);
	conversations = $state.raw<ConversationSummary[]>([]);
	activeConversationId = $state<string | null>(null);
	historyOpen = $state(false);
	startedAt = $state<string | null>(null);
	statusMessage = $state<string | null>(null);
	historyLoading = $state(false);
	historyError = $state<string | null>(null);
	paginationError = $state<string | null>(null);
	conversationLoading = $state(false);
	olderMessagesLoading = $state(false);
	olderMessagesError = $state<string | null>(null);
	private activeStream = $state<ActiveStream | null>(null);
	private nextConversationCursor = $state<ConversationCursor | null>(null);
	private olderMessagesCursor = $state<ConversationHistoryCursor | null>(null);
	private conversationSelection = 0;
	private retryableTurn = $state<{
		turnId: string;
		message: string;
		conversationId: string | null;
	} | null>(null);
	streaming = $derived(this.activeStream !== null);
	canStopResponse = $derived(this.activeStream !== null && !this.activeStream.terminal);
	canRetry = $derived(this.retryableTurn !== null && this.activeStream === null);
	hasMoreConversations = $derived(this.nextConversationCursor !== null);
	hasOlderMessages = $derived(this.olderMessagesCursor !== null);

	constructor(private readonly options: ChatSessionOptions) {
		this.conversations = options.initialConversationPage.conversations;
		this.nextConversationCursor = options.initialConversationPage.nextCursor;
	}

	destroy() {
		this.conversationSelection += 1;
		this.activeStream?.controller.abort();
	}

	submit = (message: string) => {
		if (this.activeStream || this.conversationLoading) return;

		const turnId = crypto.randomUUID();
		const now = new Date().toISOString();
		const userId = crypto.randomUUID();
		const assistantId = crypto.randomUUID();
		const controller = new AbortController();

		this.startedAt ??= now;
		this.statusMessage = null;
		this.retryableTurn = null;
		this.messages = [
			...this.messages,
			{
				id: userId,
				conversationId: this.activeConversationId ?? '',
				turnId,
				role: 'user',
				content: message,
				createdAt: now,
				pending: true
			},
			{
				id: assistantId,
				conversationId: this.activeConversationId ?? '',
				turnId,
				role: 'assistant',
				content: '',
				createdAt: now,
				pending: true
			}
		];

		this.activeStream = {
			turnId,
			assistantId,
			controller,
			persisted: false,
			stopRequested: false,
			manualStop: false,
			terminal: false,
			message,
			conversationId: this.activeConversationId
		};

		void this.options.onMessagesChanged();
		void this.runStream(message, this.activeConversationId, this.activeStream);
	};

	startNewConversation = () => {
		if (this.activeStream) return;
		this.conversationSelection += 1;
		this.messages = [];
		this.journalRecords = [];
		this.startedAt = null;
		this.activeConversationId = null;
		this.statusMessage = null;
		this.retryableTurn = null;
		this.historyError = null;
		this.conversationLoading = false;
		this.olderMessagesLoading = false;
		this.olderMessagesError = null;
		this.olderMessagesCursor = null;
		this.historyOpen = false;
	};

	deleteConversation = async (conversationId = this.activeConversationId) => {
		if (
			!conversationId ||
			this.activeStream ||
			this.conversationLoading ||
			this.olderMessagesLoading
		)
			return;

		try {
			const { id } = await deleteConversationRemote(conversationId);
			this.conversations = this.conversations.filter((conversation) => conversation.id !== id);
			if (this.activeConversationId === id) this.startNewConversation();
		} catch {
			this.statusMessage = 'Konversationen kunde inte raderas.';
		}
	};

	renameConversation = async (conversationId: string, title: string): Promise<boolean> => {
		try {
			const conversation = await renameConversationRemote({ id: conversationId, title });
			this.updateConversationCache(conversation);
			return true;
		} catch {
			return false;
		}
	};

	openHistory = () => {
		this.historyOpen = true;
		this.historyError = null;
	};

	loadMoreConversations = async () => {
		const cursor = this.nextConversationCursor;
		if (!cursor || this.historyLoading) return;

		this.historyLoading = true;
		this.paginationError = null;
		try {
			const page = await listConversations(cursor);
			const existingIds = new Set(this.conversations.map((conversation) => conversation.id));
			const newConversations = page.conversations.filter(
				(conversation) => !existingIds.has(conversation.id)
			);

			this.conversations = [...this.conversations, ...newConversations];
			this.nextConversationCursor = page.nextCursor;
		} catch {
			this.paginationError = 'Fler konversationer kunde inte hämtas.';
		} finally {
			this.historyLoading = false;
		}
	};

	selectConversation = async (conversationId: string) => {
		if (this.activeStream) return;
		const selection = ++this.conversationSelection;
		const summary = this.conversations.find((conversation) => conversation.id === conversationId);

		this.activeConversationId = conversationId;
		this.messages = [];
		this.journalRecords = [];
		this.startedAt = summary?.createdAt ?? null;
		this.historyOpen = false;
		this.conversationLoading = true;
		this.statusMessage = null;
		this.retryableTurn = null;
		this.historyError = null;
		this.olderMessagesLoading = false;
		this.olderMessagesError = null;
		this.olderMessagesCursor = null;

		try {
			const conversation = await getConversation({ id: conversationId, before: null });
			if (selection !== this.conversationSelection) return;

			this.messages = conversation.messages;
			this.journalRecords = conversation.journalRecords;
			this.olderMessagesCursor = conversation.olderCursor;
			this.startedAt = conversation.olderCursor
				? null
				: (conversation.messages[0]?.createdAt ?? conversation.createdAt);
			this.updateConversationCache(conversation);
			this.conversationLoading = false;
			await this.options.onMessagesChanged();
		} catch {
			if (selection === this.conversationSelection) {
				this.statusMessage = 'Konversationen kunde inte öppnas.';
			}
		} finally {
			if (selection === this.conversationSelection) this.conversationLoading = false;
		}
	};

	loadOlderMessages = async (): Promise<boolean> => {
		const conversationId = this.activeConversationId;
		const before = this.olderMessagesCursor;
		if (
			!conversationId ||
			!before ||
			this.activeStream ||
			this.conversationLoading ||
			this.olderMessagesLoading
		)
			return false;

		const selection = this.conversationSelection;
		this.olderMessagesLoading = true;
		this.olderMessagesError = null;

		try {
			const conversation = await getConversation({ id: conversationId, before });
			if (selection !== this.conversationSelection) return false;

			const existingMessageIds = new Set(this.messages.map((message) => message.id));
			const olderMessages = conversation.messages.filter(
				(message) => !existingMessageIds.has(message.id)
			);
			const existingRecordIds = new Set(
				this.journalRecords.map((entry) => `${entry.record.kind}:${entry.record.value.id}`)
			);
			const olderRecords = conversation.journalRecords.filter(
				(entry) => !existingRecordIds.has(`${entry.record.kind}:${entry.record.value.id}`)
			);

			this.messages = [...olderMessages, ...this.messages];
			this.journalRecords = [...olderRecords, ...this.journalRecords];
			this.olderMessagesCursor = conversation.olderCursor;
			this.startedAt = conversation.olderCursor
				? null
				: (this.messages[0]?.createdAt ?? conversation.createdAt);
			this.updateConversationCache(conversation);
			return true;
		} catch {
			if (selection === this.conversationSelection) {
				this.olderMessagesError = 'Äldre meddelanden kunde inte hämtas.';
			}
			return false;
		} finally {
			if (selection === this.conversationSelection) this.olderMessagesLoading = false;
		}
	};

	reloadActiveConversation = () => {
		if (this.activeConversationId && !this.activeStream) {
			void this.selectConversation(this.activeConversationId);
		}
	};

	close() {
		this.requestStop(false);
		this.historyOpen = false;
	}

	stopResponse = () => {
		this.requestStop(true);
	};

	updateMealRecord = (meal: Meal) => {
		this.journalRecords = this.journalRecords.map((entry) =>
			entry.record.kind === 'meal' && entry.record.value.id === meal.id
				? { ...entry, record: { ...entry.record, value: meal } }
				: entry
		);
	};

	retryLastTurn = () => {
		const retry = this.retryableTurn;
		if (!retry || this.activeStream || this.conversationLoading) return;

		const assistantId = crypto.randomUUID();
		const controller = new AbortController();
		this.statusMessage = null;
		this.retryableTurn = null;
		this.messages = [
			...this.messages,
			{
				id: assistantId,
				conversationId: retry.conversationId ?? '',
				turnId: retry.turnId,
				role: 'assistant',
				content: '',
				createdAt: new Date().toISOString(),
				pending: true
			}
		];
		this.activeStream = {
			turnId: retry.turnId,
			assistantId,
			controller,
			persisted: true,
			stopRequested: false,
			manualStop: false,
			terminal: false,
			message: retry.message,
			conversationId: retry.conversationId
		};
		void this.runStream(retry.message, retry.conversationId, this.activeStream);
	};

	private requestStop(manual: boolean) {
		if (!this.activeStream || this.activeStream.terminal) return;
		this.activeStream.manualStop ||= manual;
		this.activeStream.stopRequested = true;
		if (this.activeStream.persisted) this.activeStream.controller.abort();
	}

	private async runStream(message: string, conversationId: string | null, stream: ActiveStream) {
		try {
			await streamChat({
				request: {
					conversationId,
					turnId: stream.turnId,
					message,
					timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
				},
				signal: stream.controller.signal,
				onEvent: (event) => this.handleStreamEvent(event, stream)
			});

			if (!stream.terminal && !stream.controller.signal.aborted) {
				throw new Error('Streamen avslutades utan terminalt event.');
			}
		} catch (error) {
			if (stream.persisted) {
				this.removePendingAssistant(stream.assistantId);
			} else {
				this.messages = this.messages.filter((message) => message.turnId !== stream.turnId);
			}
			if (stream.controller.signal.aborted) {
				if (stream.manualStop) this.statusMessage = 'Svaret avbröts.';
			} else {
				this.statusMessage = error instanceof Error ? error.message : 'Svaret kunde inte hämtas.';
			}
		} finally {
			if (this.activeStream?.turnId === stream.turnId) this.activeStream = null;
		}
	}

	private handleStreamEvent(event: ChatStreamEvent, stream: ActiveStream) {
		if (event.turnId !== stream.turnId) return;

		if (event.type === 'conversation') {
			stream.persisted = true;
			stream.conversationId = event.conversation.id;
			this.activeConversationId = event.conversation.id;
			this.messages = this.messages.map((message) =>
				message.turnId === event.turnId && message.role === 'user'
					? { ...event.message, pending: false }
					: message
			);
			this.updateConversationCache(event.conversation);
			if (stream.stopRequested) stream.controller.abort();
		} else if (event.type === 'delta') {
			this.messages = this.messages.map((message) =>
				message.id === stream.assistantId
					? { ...message, content: message.content + event.text }
					: message
			);
			void this.options.onMessagesChanged();
		} else if (event.type === 'replace') {
			this.messages = this.messages.map((message) =>
				message.id === stream.assistantId ? { ...message, content: event.text } : message
			);
		} else if (event.type === 'journal_record_created') {
			const entry = { turnId: event.turnId, record: event.record };
			this.journalRecords = upsertJournalRecord(this.journalRecords, entry);
			void this.options.onJournalRecordCreated?.(entry);
		} else if (event.type === 'done') {
			stream.terminal = true;
			this.messages = this.messages.map((message) =>
				message.id === stream.assistantId ? { ...event.message, pending: false } : message
			);
			this.updateConversationCache(event.conversation);
		} else if (event.type === 'error') {
			stream.terminal = true;
			this.removePendingAssistant(stream.assistantId);
			this.statusMessage = event.message;
			if (event.retryable) {
				this.retryableTurn = {
					turnId: stream.turnId,
					message: stream.message,
					conversationId: stream.conversationId
				};
			}
		}
	}

	private removePendingAssistant(assistantId: string) {
		this.messages = this.messages.filter((message) => message.id !== assistantId);
	}

	private updateConversationCache(conversation: ConversationSummary) {
		this.conversations = upsertConversation(this.conversations, conversation);
	}
}

export function upsertJournalRecord(
	records: TurnJournalRecord[],
	entry: TurnJournalRecord
): TurnJournalRecord[] {
	const existingIndex = records.findIndex(
		(candidate) =>
			candidate.record.kind === entry.record.kind &&
			candidate.record.value.id === entry.record.value.id
	);
	if (existingIndex === -1) return [...records, entry];
	return records.map((candidate, index) => (index === existingIndex ? entry : candidate));
}
