import type {
	ChatMessage,
	ChatStreamEvent,
	ConversationSummary
} from '$lib/features/chat/contracts';
import type { MealDuplicateInteractionV1 } from '$lib/features/meals/contracts';
import { deriveNextAction, orchestrateChatTurn } from '$lib/server/chat/orchestrator';
import { ProviderStepError } from '$lib/server/chat/provider';
import { createToolCatalog } from '$lib/server/chat/tools/registry';
import type { BeginChatTurnResult } from '$lib/server/chat/turns';
import type { SupabaseClient } from '@supabase/supabase-js';
import type OpenAI from 'openai';
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
			runResponseFinalizer: vi.fn(),
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

	it('requires an explicit first interaction decision when verified pending state exists', async () => {
		const runner = vi.fn(async () => textStep('Fortsättningen styrs av modellkontraktet.'));
		const events: ChatStreamEvent[] = [];
		const input = turnInput(Promise.resolve(createdBegin()), events);

		await orchestrateChatTurn(
			{
				...input,
				toolCatalog: createToolCatalog({ hasPendingInteraction: true }),
				pendingInteractionBindings: [
					{
						interactionRef: 'interaction_1',
						kind: 'meal_duplicate',
						interactionId: '70000000-0000-4000-8000-000000000000'
					}
				]
			},
			{
				runModelStep: runner as never,
				runResponseFinalizer: vi.fn(),
				completeChatTurn: vi.fn(async () => ({ message: assistantMessage, conversation })),
				failChatTurn: vi.fn()
			}
		);

		expect((runner.mock.calls as unknown[][])[0][5]).toMatchObject({
			requiredToolName: 'process_interaction_response'
		});
	});

	it('processes a verified direct interaction response through the domain operation', async () => {
		const call = {
			type: 'function_call' as const,
			call_id: 'call_interaction',
			name: 'process_interaction_response',
			arguments: JSON.stringify({
				interactionRef: 'interaction_1',
				responseMeaning: 'confirmed_with_additional_intent'
			})
		};
		const runner = vi
			.fn()
			.mockResolvedValueOnce({ mode: 'tool', text: '', output: [call], functionCalls: [call] })
			.mockImplementationOnce(async (modelInput: OpenAI.Responses.ResponseInput) => {
				expect(modelInput.at(-1)).toMatchObject({
					type: 'function_call_output',
					call_id: 'call_interaction',
					name: 'process_interaction_response'
				});
				expect(modelInput.at(-1)).not.toHaveProperty('namespace');
				return textStep('Måltiden är registrerad. Jag hjälper dig med resten.');
			});
		const rpc = vi.fn(async () => ({
			data: { status: 'registered', meal: meal(0, 'Gröt'), replayed: false },
			error: null
		}));
		const events: ChatStreamEvent[] = [];

		await orchestrateChatTurn(
			{
				...turnInput(Promise.resolve(createdBegin()), events),
				client: { rpc } as unknown as SupabaseClient,
				toolCatalog: createToolCatalog({ hasPendingInteraction: true }),
				pendingInteractionBindings: [
					{
						interactionRef: 'interaction_1',
						kind: 'meal_duplicate',
						interactionId: '70000000-0000-4000-8000-000000000000'
					}
				]
			},
			{
				runModelStep: runner as never,
				runResponseFinalizer: vi.fn(),
				completeChatTurn: vi.fn(async () => ({ message: assistantMessage, conversation })),
				failChatTurn: vi.fn()
			}
		);

		expect(rpc).toHaveBeenCalledWith(
			'resolve_meal_duplicate_interaction',
			expect.objectContaining({
				p_interaction_id: '70000000-0000-4000-8000-000000000000',
				p_decision: 'register',
				p_reason: null
			})
		);
		expect(runner).toHaveBeenCalledTimes(2);
		expect(events.some((event) => event.type === 'journal_record_created')).toBe(true);
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
				runResponseFinalizer: vi.fn(),
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
			const index = args.p_tool_call_index as number;
			await new Promise((resolve) => setTimeout(resolve, index === 0 ? 15 : 1));
			active -= 1;
			const items = args.p_items as Array<{ name: string }>;
			return {
				data: { status: 'created', meal: meal(index, items[0].name), replayed: false },
				error: null
			};
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
				runResponseFinalizer: vi.fn(),
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
			rpc: vi.fn(async () => ({
				data: { status: 'created', meal: meal(0, 'Gröt'), replayed: false },
				error: null
			}))
		} as unknown as SupabaseClient;

		await orchestrateChatTurn(
			{ ...turnInput(Promise.resolve(createdBegin()), events), client },
			{
				runModelStep: runner as never,
				runResponseFinalizer: vi.fn(),
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

	it('uses one finalizer call for a duplicate without creating or projecting a meal', async () => {
		const call = mealCall('call_1', 'Gröt');
		const runner = vi.fn().mockResolvedValueOnce({
			mode: 'tool',
			text: '',
			output: [call],
			functionCalls: [call]
		});
		const finalizer = vi.fn(async () => ({
			text: 'Det liknar gröten du redan registrerade. Vill du registrera en till?',
			fulfilledRequirementRefs: ['response_1']
		}));
		const complete = vi.fn(async (_client: SupabaseClient, input: { content: string }) => ({
			message: { ...assistantMessage, content: input.content },
			conversation
		}));
		const events: ChatStreamEvent[] = [];
		const client = duplicateClient(duplicateInteraction());

		const outcome = await orchestrateChatTurn(
			{ ...turnInput(Promise.resolve(createdBegin()), events), client },
			{
				runModelStep: runner as never,
				runResponseFinalizer: finalizer as never,
				completeChatTurn: complete,
				failChatTurn: vi.fn()
			}
		);

		expect(outcome).toMatchObject({ status: 'succeeded', records: [] });
		expect(runner).toHaveBeenCalledTimes(1);
		expect(finalizer).toHaveBeenCalledWith(
			expect.objectContaining({
				verifiedResponseParts: [],
				responseRequirements: [
					expect.objectContaining({
						ref: 'response_1',
						interactionRef: 'interaction_1'
					})
				]
			}),
			expect.any(String),
			expect.any(AbortSignal)
		);
		expect(events.some((event) => event.type === 'journal_record_created')).toBe(false);
		expect(events.map((event) => event.type)).toEqual(['conversation', 'replace', 'done']);
	});

	it('finalizes a mixed created and duplicate batch with only the created record', async () => {
		const calls = [mealCall('call_1', 'Kaffe'), mealCall('call_2', 'Gröt')];
		const runner = vi.fn().mockResolvedValueOnce({
			mode: 'tool',
			text: '',
			output: calls,
			functionCalls: calls
		});
		const interaction = duplicateInteraction({ proposalOperationId: `${userMessage.turnId}:1` });
		const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) =>
			args.p_tool_call_index === 0
				? {
						data: { status: 'created', meal: meal(0, 'Kaffe'), replayed: false },
						error: null
					}
				: {
						data: { status: 'confirmation_required', interaction, replayed: false },
						error: null
					}
		);
		const finalizer = vi.fn(async () => ({
			text: 'Kaffet är registrerat. Gröten liknar en tidigare måltid – vill du registrera den också?',
			fulfilledRequirementRefs: ['response_2']
		}));
		const events: ChatStreamEvent[] = [];

		const outcome = await orchestrateChatTurn(
			{
				...turnInput(Promise.resolve(createdBegin()), events),
				client: { rpc } as unknown as SupabaseClient
			},
			{
				runModelStep: runner as never,
				runResponseFinalizer: finalizer as never,
				completeChatTurn: vi.fn(async (_client, input) => ({
					message: { ...assistantMessage, content: input.content },
					conversation
				})),
				failChatTurn: vi.fn()
			}
		);

		expect(outcome.records.map((record) => record.value.items[0].name)).toEqual(['Kaffe']);
		expect(finalizer).toHaveBeenCalledWith(
			expect.objectContaining({
				verifiedResponseParts: expect.arrayContaining([
					expect.objectContaining({ kind: 'text', text: 'Registrerat' }),
					expect.objectContaining({ kind: 'journal_record' })
				]),
				responseRequirements: [expect.objectContaining({ ref: 'response_2' })]
			}),
			expect.any(String),
			expect.any(AbortSignal)
		);
		expect(events.filter((event) => event.type === 'journal_record_created')).toHaveLength(1);
	});

	it('lets the full agent continue when a duplicate registration also needs an answer', async () => {
		const call = mealCall('call_1', 'Gröt', true);
		const runner = vi
			.fn()
			.mockResolvedValueOnce({ mode: 'tool', text: '', output: [call], functionCalls: [call] })
			.mockResolvedValueOnce(
				textStep(
					'Det liknar din tidigare gröt. Vill du registrera en till? Proteinmängden går inte att uppskatta utan mängder.',
					['response_1']
				)
			);
		const finalizer = vi.fn();
		const events: ChatStreamEvent[] = [];

		await orchestrateChatTurn(
			{
				...turnInput(Promise.resolve(createdBegin()), events),
				client: duplicateClient(duplicateInteraction())
			},
			{
				runModelStep: runner as never,
				runResponseFinalizer: finalizer,
				completeChatTurn: vi.fn(async (_client, input) => ({
					message: { ...assistantMessage, content: input.content },
					conversation
				})),
				failChatTurn: vi.fn()
			}
		);

		expect(runner).toHaveBeenCalledTimes(2);
		expect(runner.mock.calls[1][5]).toMatchObject({ requirementRefs: ['response_1'] });
		expect(finalizer).not.toHaveBeenCalled();
	});

	it('recovers a durable prepared duplicate without replaying its mutation', async () => {
		const interaction = duplicateInteraction();
		const finalizer = vi.fn(async () => ({
			text: 'Det ser ut som en dubblett. Vill du registrera den ändå?',
			fulfilledRequirementRefs: ['response_1']
		}));
		const rpc = vi.fn();
		const events: ChatStreamEvent[] = [];

		await orchestrateChatTurn(
			{
				...turnInput(Promise.resolve(resumedBegin([interaction])), events),
				client: { rpc } as unknown as SupabaseClient
			},
			{
				runModelStep: vi.fn(async () => textStep('ignoreras')) as never,
				runResponseFinalizer: finalizer as never,
				completeChatTurn: vi.fn(async (_client, input) => ({
					message: { ...assistantMessage, content: input.content },
					conversation
				})),
				failChatTurn: vi.fn()
			}
		);

		expect(rpc).not.toHaveBeenCalled();
		expect(finalizer).toHaveBeenCalledTimes(1);
		expect(events.map((event) => event.type)).toEqual(['conversation', 'replace', 'done']);
	});

	it('prioritizes continuation over requirements and requirements over deterministic completion', () => {
		expect(
			deriveNextAction([
				{
					requiresAgentContinuation: false,
					verifiedResponseParts: [],
					responseRequirements: [{} as never]
				},
				{
					requiresAgentContinuation: true,
					verifiedResponseParts: [],
					responseRequirements: []
				}
			])
		).toBe('continue');
		expect(
			deriveNextAction([
				{
					requiresAgentContinuation: false,
					verifiedResponseParts: [],
					responseRequirements: [{} as never]
				}
			])
		).toBe('respond');
		expect(
			deriveNextAction([
				{
					requiresAgentContinuation: false,
					verifiedResponseParts: [],
					responseRequirements: []
				}
			])
		).toBe('complete');
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
			rpc: vi.fn(async () => ({
				data: { status: 'created', meal: meal(0, 'Gröt'), replayed: false },
				error: null
			}))
		} as unknown as SupabaseClient;

		const outcome = await orchestrateChatTurn(
			{ ...turnInput(Promise.resolve(createdBegin()), events), client },
			{
				runModelStep: runner as never,
				runResponseFinalizer: vi.fn(),
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
		toolCatalog: createToolCatalog({ hasPendingInteraction: false }),
		pendingInteractionBindings: [],
		userMessage: userMessage.content,
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
		turnLeaseExpiresAt: '2026-08-06T10:02:00.000Z',
		journalRecords: [],
		interactions: []
	};
}

function textStep(text: string, fulfilledRequirementRefs: string[] = []) {
	return {
		mode: 'text' as const,
		text,
		output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
		functionCalls: [],
		fulfilledRequirementRefs
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

function duplicateClient(interaction: MealDuplicateInteractionV1): SupabaseClient {
	return {
		rpc: vi.fn(async () => ({
			data: { status: 'confirmation_required', interaction, replayed: false },
			error: null
		}))
	} as unknown as SupabaseClient;
}

function duplicateInteraction(
	overrides: Partial<MealDuplicateInteractionV1> = {}
): MealDuplicateInteractionV1 {
	const proposedMeal = {
		mealType: 'breakfast' as const,
		occurrence: {
			precision: 'date' as const,
			occurredAt: null,
			occurredOn: '2026-08-06',
			timezone: 'Europe/Stockholm',
			timePeriod: null
		},
		items: [{ name: 'Gröt', amountText: null, ingredients: [] }]
	};
	return {
		id: '70000000-0000-4000-8000-000000000000',
		kind: 'meal_duplicate',
		status: 'prepared',
		schemaVersion: 1,
		policyVersion: 1,
		proposalTurnId: userMessage.turnId,
		proposalOperationId: `${userMessage.turnId}:0`,
		proposalInputHash: 'duplicate-input-hash',
		resolutionTurnId: null,
		resolutionOperationId: null,
		resolutionReason: null,
		payload: {
			proposedMeal,
			existingMealSnapshot: proposedMeal,
			matchDetails: {
				policyVersion: 1,
				anchor: 'identical_payload',
				timeDifferenceMinutes: null,
				candidateCount: 1,
				differences: { mealType: 'match', amounts: 'match', ingredients: 'match' }
			}
		},
		createdAt: '2026-08-06T10:00:00.000Z',
		activatedAt: null,
		resolvedAt: null,
		...overrides
	};
}

function resumedBegin(
	interactions: MealDuplicateInteractionV1[]
): Extract<BeginChatTurnResult, { status: 'resumed' }> {
	return {
		status: 'resumed',
		conversation,
		message: userMessage,
		turnLeaseExpiresAt: '2026-08-06T10:02:00.000Z',
		journalRecords: [],
		interactions
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}
