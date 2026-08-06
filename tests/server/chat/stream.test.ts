import type {
	ChatMessage,
	ChatStreamEvent,
	ConversationSummary
} from '$lib/features/chat/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { replaceProvisionalConversationTitle } from '$lib/server/chat/conversations';
import type { createModelStream } from '$lib/server/chat/model';
import { createChatResponseStream } from '$lib/server/chat/stream';
import type { generateConversationTitle } from '$lib/server/chat/title';
import type { BeginChatTurnResult, commitChatTurn } from '$lib/server/chat/turns';

const conversation: ConversationSummary = {
	id: '10000000-0000-4000-8000-000000000000',
	title: 'Hej Trace',
	createdAt: '2026-08-06T10:00:00.000Z',
	updatedAt: '2026-08-06T10:00:00.000Z',
	lastMessageAt: '2026-08-06T10:00:00.000Z'
};

const userMessage: ChatMessage = {
	id: '20000000-0000-4000-8000-000000000000',
	conversationId: conversation.id,
	turnId: '30000000-0000-4000-8000-000000000000',
	role: 'user',
	content: 'Hej Trace',
	createdAt: conversation.createdAt
};

const assistantMessage: ChatMessage = {
	id: '40000000-0000-4000-8000-000000000000',
	conversationId: conversation.id,
	turnId: userMessage.turnId,
	role: 'assistant',
	content: 'Hej!',
	createdAt: '2026-08-06T10:00:01.000Z'
};

afterEach(() => vi.restoreAllMocks());

describe('createChatResponseStream', () => {
	it('streams deltas without database writes and commits exactly once after completion', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => {});
		const commit = vi.fn(async () => ({ message: assistantMessage, conversation }));
		const model = async function* () {
			yield { type: 'response.output_text.delta', delta: 'Hej' };
			expect(commit).not.toHaveBeenCalled();
			yield {
				type: 'response.completed',
				response: {
					output: [
						{
							type: 'message',
							content: [
								{
									type: 'output_text',
									text: 'Hej!'
								}
							]
						}
					],
					reasoning: { context: 'current_turn' }
				}
			};
		};

		const events = await collect(
			createdBeginResult(),
			model as unknown as typeof createModelStream,
			commit as unknown as typeof commitChatTurn,
			{ isNewConversation: false }
		);

		expect(events.map((event) => event.type)).toEqual(['conversation', 'delta', 'replace', 'done']);
		expect(events.find((event) => event.type === 'replace')).toEqual({
			type: 'replace',
			turnId: userMessage.turnId,
			text: 'Hej!'
		});
		expect(commit).toHaveBeenCalledTimes(1);
		expect(commit).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ content: 'Hej!', turnId: userMessage.turnId })
		);
	});

	it('generates and persists a title after the first completed response', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => {});
		const titledConversation = { ...conversation, title: 'Kort samtalstitel' };
		const commit = vi.fn(async () => ({ message: assistantMessage, conversation }));
		const generateTitle = vi.fn(async () => titledConversation.title);
		const replaceTitle = vi.fn(async () => titledConversation);
		const model = completedModel;

		const events = await collect(
			createdBeginResult(),
			model as unknown as typeof createModelStream,
			commit as unknown as typeof commitChatTurn,
			{
				generateConversationTitle: generateTitle as unknown as typeof generateConversationTitle,
				replaceProvisionalConversationTitle:
					replaceTitle as unknown as typeof replaceProvisionalConversationTitle
			}
		);

		expect(generateTitle).toHaveBeenCalledWith(
			userMessage.content,
			expect.any(String),
			expect.any(AbortSignal)
		);
		expect(replaceTitle).toHaveBeenCalledWith(
			expect.anything(),
			expect.any(String),
			conversation.id,
			conversation.title,
			titledConversation.title
		);
		expect(events.at(-1)).toEqual({
			type: 'done',
			turnId: userMessage.turnId,
			message: assistantMessage,
			conversation: titledConversation
		});
	});

	it('keeps the provisional title when title generation fails', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => {});
		const commit = vi.fn(async () => ({ message: assistantMessage, conversation }));
		const generateTitle = vi.fn(async () => {
			throw new Error('title_failed');
		});
		const replaceTitle = vi.fn();

		const events = await collect(
			createdBeginResult(),
			completedModel as unknown as typeof createModelStream,
			commit as unknown as typeof commitChatTurn,
			{
				generateConversationTitle: generateTitle as unknown as typeof generateConversationTitle,
				replaceProvisionalConversationTitle:
					replaceTitle as unknown as typeof replaceProvisionalConversationTitle
			}
		);

		expect(replaceTitle).not.toHaveBeenCalled();
		expect(events.at(-1)).toEqual({
			type: 'done',
			turnId: userMessage.turnId,
			message: assistantMessage,
			conversation
		});
	});

	it('does not commit a failed model response', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => {});
		const commit = vi.fn();
		const model = async function* () {
			yield { type: 'response.failed', response: {} };
		};

		const events = await collect(
			createdBeginResult(),
			model as unknown as typeof createModelStream,
			commit as unknown as typeof commitChatTurn
		);

		expect(events.map((event) => event.type)).toEqual(['conversation', 'error']);
		expect(commit).not.toHaveBeenCalled();
	});

	it('replays an already completed turn without model or commit calls', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => {});
		const model = vi.fn();
		const commit = vi.fn();
		const beginResult: Extract<BeginChatTurnResult, { status: 'completed' }> = {
			status: 'completed',
			conversation,
			message: userMessage,
			assistantMessage
		};

		const events = await collect(
			beginResult,
			model as unknown as typeof createModelStream,
			commit as unknown as typeof commitChatTurn
		);

		expect(events.map((event) => event.type)).toEqual(['conversation', 'replace', 'done']);
		expect(model).not.toHaveBeenCalled();
		expect(commit).not.toHaveBeenCalled();
	});
});

function createdBeginResult(): Extract<BeginChatTurnResult, { status: 'created' }> {
	return {
		status: 'created',
		conversation,
		message: userMessage,
		history: [{ role: 'user', content: userMessage.content, turnId: userMessage.turnId }]
	};
}

async function collect(
	beginResult: Extract<BeginChatTurnResult, { status: 'created' | 'completed' }>,
	model: typeof createModelStream,
	commit: typeof commitChatTurn,
	options: {
		isNewConversation?: boolean;
		generateConversationTitle?: typeof generateConversationTitle;
		replaceProvisionalConversationTitle?: typeof replaceProvisionalConversationTitle;
	} = {}
): Promise<ChatStreamEvent[]> {
	const generateTitle = options.generateConversationTitle ?? (vi.fn(async () => null) as never);
	const replaceTitle =
		options.replaceProvisionalConversationTitle ?? (vi.fn(async () => null) as never);
	const stream = createChatResponseStream(
		{
			adminClient: {} as SupabaseClient,
			beginResult,
			userId: '50000000-0000-4000-8000-000000000000',
			turnId: userMessage.turnId,
			requestSignal: new AbortController().signal,
			requestId: 'request-test',
			dbBeginMs: 1,
			isNewConversation: options.isNewConversation ?? true
		},
		{
			createModelStream: model,
			commitChatTurn: commit,
			generateConversationTitle: generateTitle,
			replaceProvisionalConversationTitle: replaceTitle
		}
	);

	const text = await new Response(stream).text();
	return text
		.trim()
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as ChatStreamEvent);
}

async function* completedModel() {
	yield { type: 'response.output_text.delta', delta: assistantMessage.content };
	yield {
		type: 'response.completed',
		response: {
			output: [
				{
					type: 'message',
					content: [{ type: 'output_text', text: assistantMessage.content }]
				}
			],
			reasoning: { context: 'current_turn' }
		}
	};
}
