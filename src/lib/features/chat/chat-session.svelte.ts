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
	type ConversationPage,
	type ConversationSummary,
	upsertConversation
} from './contracts';
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
};

type ChatSessionOptions = {
	initialConversationPage: ConversationPage;
	onMessagesChanged: () => void | Promise<void>;
};

export function createChatSession(options: ChatSessionOptions) {
	return new ChatSession(options);
}

class ChatSession {
	messages = $state.raw<DisplayMessage[]>([]);
	conversations = $state.raw<ConversationSummary[]>([]);
	activeConversationId = $state<string | null>(null);
	historyOpen = $state(false);
	startedAt = $state<string | null>(null);
	statusMessage = $state<string | null>(null);
	historyLoading = $state(false);
	historyError = $state<string | null>(null);
	paginationError = $state<string | null>(null);
	conversationLoading = $state(false);
	private activeStream = $state<ActiveStream | null>(null);
	private nextConversationCursor = $state<ConversationCursor | null>(null);
	private conversationSelection = 0;
	streaming = $derived(this.activeStream !== null);
	hasMoreConversations = $derived(this.nextConversationCursor !== null);

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
			terminal: false
		};

		void this.options.onMessagesChanged();
		void this.runStream(message, this.activeConversationId, this.activeStream);
	};

	startNewConversation = () => {
		if (this.activeStream) return;
		this.conversationSelection += 1;
		this.messages = [];
		this.startedAt = null;
		this.activeConversationId = null;
		this.statusMessage = null;
		this.historyError = null;
		this.conversationLoading = false;
		this.historyOpen = false;
	};

	deleteConversation = async (conversationId = this.activeConversationId) => {
		if (!conversationId || this.activeStream || this.conversationLoading) return;

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
		this.startedAt = summary?.createdAt ?? null;
		this.historyOpen = false;
		this.conversationLoading = true;
		this.statusMessage = null;
		this.historyError = null;

		try {
			const conversation = await getConversation(conversationId);
			if (selection !== this.conversationSelection) return;

			this.messages = conversation.messages;
			this.startedAt = conversation.messages[0]?.createdAt ?? conversation.createdAt;
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

	close() {
		this.requestStop(false);
		this.historyOpen = false;
	}

	stopResponse = () => {
		this.requestStop(true);
	};

	private requestStop(manual: boolean) {
		if (!this.activeStream) return;
		this.activeStream.manualStop ||= manual;
		this.activeStream.stopRequested = true;
		if (this.activeStream.persisted) this.activeStream.controller.abort();
	}

	private async runStream(message: string, conversationId: string | null, stream: ActiveStream) {
		try {
			await streamChat({
				request: { conversationId, turnId: stream.turnId, message },
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
		}
	}

	private removePendingAssistant(assistantId: string) {
		this.messages = this.messages.filter((message) => message.id !== assistantId);
	}

	private updateConversationCache(conversation: ConversationSummary) {
		this.conversations = upsertConversation(this.conversations, conversation);
	}
}
