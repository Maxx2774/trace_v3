import type {
	ChatMessage,
	ChatStreamEvent,
	ConversationSummary
} from '$lib/features/chat/contracts';
import { orchestrateChatTurn } from '$lib/server/chat/orchestrator';
import { ProviderStepError } from '$lib/server/chat/provider';
import type { BeginChatTurnResult } from '$lib/server/chat/turns';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { mealFixture } from '../../helpers/meals';

const conversation: ConversationSummary = {
	id: '10000000-0000-4000-8000-000000000000',
	title: 'Måltid',
	createdAt: '2026-08-06T10:00:00.000Z',
	updatedAt: '2026-08-06T10:00:00.000Z',
	lastMessageAt: '2026-08-06T10:00:00.000Z'
};

const userMessage: ChatMessage = {
	id: '20000000-0000-4000-8000-000000000000',
	conversationId: conversation.id,
	turnId: '30000000-0000-4000-8000-000000000000',
	role: 'user',
	content: 'Jag åt gröt',
	createdAt: conversation.createdAt
};

const assistantMessage: ChatMessage = {
	id: '40000000-0000-4000-8000-000000000000',
	conversationId: conversation.id,
	turnId: userMessage.turnId,
	role: 'assistant',
	content: 'Din gröt är registrerad.',
	createdAt: '2026-08-06T10:00:01.000Z'
};

describe('orchestrateChatTurn', () => {
	it('starts the first model step before begin resolves but keeps commit behind the barrier', async () => {
		const pendingBegin = deferred<BeginChatTurnResult>();
		const complete = vi.fn(async () => ({ message: assistantMessage, conversation }));
		const runner = vi.fn(async () => textStep(assistantMessage.content));
		const events: ChatStreamEvent[] = [];

		const resultPromise = orchestrateChatTurn(turnInput(pendingBegin.promise, events), {
			runModelStep: runner as never,
			completeChatTurn: complete,
			failChatTurn: vi.fn()
		});

		await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1));
		expect(complete).not.toHaveBeenCalled();
		pendingBegin.resolve(createdBegin());
		await resultPromise;

		expect(complete).toHaveBeenCalledTimes(1);
		expect(events.map((event) => event.type)).toEqual(['conversation', 'replace', 'done']);
	});

	it('uses the post-completion conversation in the canonical done event', async () => {
		const renamedConversation = { ...conversation, title: 'Ny titel' };
		const afterComplete = vi.fn(async () => renamedConversation);
		const events: ChatStreamEvent[] = [];

		await orchestrateChatTurn(
			{
				...turnInput(Promise.resolve(createdBegin()), events),
				afterComplete
			},
			{
				runModelStep: vi.fn(async () => textStep('Klart.')) as never,
				completeChatTurn: vi.fn(async () => ({ message: assistantMessage, conversation })),
				failChatTurn: vi.fn()
			}
		);

		expect(afterComplete).toHaveBeenCalledTimes(1);
		expect(events.at(-1)).toMatchObject({ type: 'done', conversation: renamedConversation });
	});

	it('executes independent meal calls concurrently and emits canonical records in call order', async () => {
		const calls = [mealCall('call_1', 'Gröt'), mealCall('call_2', 'Kaffe')];
		const runner = vi
			.fn()
			.mockResolvedValueOnce({ mode: 'tool', text: '', output: calls, functionCalls: calls });
		let active = 0;
		let maxActive = 0;
		const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			const index = args.p_operation_index as number;
			await new Promise((resolve) => setTimeout(resolve, index === 0 ? 15 : 1));
			active -= 1;
			const items = args.p_items as Array<{ name: string }>;
			return { data: meal(index, items[0].name), error: null };
		});
		const events: ChatStreamEvent[] = [];

		const complete = vi.fn(async (_client: SupabaseClient, input: { content: string }) => ({
			message: { ...assistantMessage, content: input.content },
			conversation
		}));
		const outcome = await orchestrateChatTurn(
			{ ...turnInput(Promise.resolve(createdBegin()), events), client: { rpc } as never },
			{
				runModelStep: runner as never,
				completeChatTurn: complete,
				failChatTurn: vi.fn()
			}
		);

		expect(maxActive).toBe(2);
		expect(
			events
				.filter((event) => event.type === 'journal_record_created')
				.map((event) => event.record.value.items[0].name)
		).toEqual(['Gröt', 'Kaffe']);
		expect(outcome.status).toBe('succeeded');
		expect(runner).toHaveBeenCalledTimes(1);
		expect(complete).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ content: 'Registrerat' })
		);
		expect(events.map((event) => event.type)).toEqual([
			'conversation',
			'journal_record_created',
			'journal_record_created',
			'done'
		]);
	});

	it('continues to a natural answer when a registration also contains a real question', async () => {
		const call = mealCall('call_1', 'Gröt', true);
		const runner = vi
			.fn()
			.mockResolvedValueOnce({ mode: 'tool', text: '', output: [call], functionCalls: [call] })
			.mockResolvedValueOnce(textStep('Det är svårt att uppskatta utan mängder.'));
		const complete = vi.fn(async (_client: SupabaseClient, input: { content: string }) => ({
			message: { ...assistantMessage, content: input.content },
			conversation
		}));
		const events: ChatStreamEvent[] = [];
		const client = {
			rpc: vi.fn(async () => ({ data: meal(0, 'Gröt'), error: null }))
		} as unknown as SupabaseClient;

		await orchestrateChatTurn(
			{ ...turnInput(Promise.resolve(createdBegin()), events), client },
			{
				runModelStep: runner as never,
				completeChatTurn: complete,
				failChatTurn: vi.fn()
			}
		);

		expect(runner).toHaveBeenCalledTimes(2);
		expect(complete).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ content: 'Det är svårt att uppskatta utan mängder.' })
		);
		expect(events.some((event) => event.type === 'journal_record_created')).toBe(true);
	});

	it('keeps a created record when a correctable sibling call is followed by a model failure', async () => {
		const call = mealCall('call_1', 'Gröt');
		const invalidCall = { ...mealCall('call_2', 'Ogiltig'), arguments: '{}' };
		const runner = vi
			.fn()
			.mockResolvedValueOnce({
				mode: 'tool',
				text: '',
				output: [call, invalidCall],
				functionCalls: [call, invalidCall]
			})
			.mockRejectedValueOnce(new ProviderStepError('upstream_error', 'Svaret föll bort.', true));
		const events: ChatStreamEvent[] = [];
		const fail = vi.fn(async () => {});
		const client = {
			rpc: vi.fn(async () => ({ data: meal(0, 'Gröt'), error: null }))
		} as unknown as SupabaseClient;

		const outcome = await orchestrateChatTurn(
			{ ...turnInput(Promise.resolve(createdBegin()), events), client },
			{
				runModelStep: runner as never,
				completeChatTurn: vi.fn(),
				failChatTurn: fail
			}
		);

		expect(outcome.status).toBe('partially_succeeded');
		expect(events.some((event) => event.type === 'journal_record_created')).toBe(true);
		expect(events.at(-1)).toMatchObject({ type: 'error', retryable: true });
		expect(fail).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ retryable: true, turnId: userMessage.turnId })
		);
	});
});

function turnInput(beginPromise: Promise<BeginChatTurnResult>, events: ChatStreamEvent[]) {
	return {
		client: {} as SupabaseClient,
		userId: '50000000-0000-4000-8000-000000000000',
		turnId: userMessage.turnId,
		timezone: 'Europe/Stockholm',
		modelInput: [{ role: 'user' as const, content: userMessage.content }],
		beginPromise,
		signal: new AbortController().signal,
		emit: (event: ChatStreamEvent) => events.push(event)
	};
}

function createdBegin(): Extract<BeginChatTurnResult, { status: 'created' }> {
	return {
		status: 'created',
		conversation,
		message: userMessage,
		leaseExpiresAt: '2026-08-06T10:02:00.000Z',
		journalRecords: []
	};
}

function textStep(text: string) {
	return {
		mode: 'text' as const,
		text,
		output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
		functionCalls: []
	};
}

function mealCall(callId: string, description: string, responseRequired = false) {
	return {
		type: 'function_call' as const,
		namespace: 'food_log',
		name: 'record',
		call_id: callId,
		arguments: JSON.stringify({
			responseRequired,
			mealType: null,
			items: [{ name: description, amountText: null, ingredients: [] }],
			occurred: { date: null, time: null }
		})
	};
}

function meal(index: number, description: string) {
	return mealFixture({
		id: `60000000-0000-4000-8000-00000000000${index}`,
		items: [
			{
				id: `61000000-0000-4000-8000-00000000000${index}`,
				name: description,
				amountText: null,
				ingredients: []
			}
		]
	});
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}
