import type {
	ChatMessage,
	ChatStreamEvent,
	ConversationSummary
} from '$lib/features/chat/contracts';
import type { MealDuplicateInteractionV1 } from '$lib/features/meals/contracts';
import { buildModelContext } from '$lib/server/chat/history';
import { CHAT_SYSTEM_PROMPT, createModelStream } from '$lib/server/chat/model';
import { orchestrateChatTurn } from '$lib/server/chat/orchestrator';
import { runModelStep } from '$lib/server/chat/provider';
import { createToolCatalog } from '$lib/server/chat/tools/registry';
import type { BeginChatTurnResult } from '$lib/server/chat/turns';
import type { SupabaseClient } from '@supabase/supabase-js';
import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { mealFixture } from '../../helpers/meals';

describe('process_interaction_response provider continuation contract', () => {
	it('sends only registered status while preserving the addressed proposal in the final provider request', async () => {
		const userMessage = 'Ja, registrera den. Vad innehöll måltiden?';
		const interaction = duplicateInteraction();
		const context = buildModelContext({
			history: [],
			journalRecords: [],
			pendingInteractions: [interaction],
			current: { turnId: TURN_ID, content: userMessage },
			systemPrompt: CHAT_SYSTEM_PROMPT,
			timezone: 'Europe/Stockholm',
			now: new Date('2026-08-08T10:00:00.000Z')
		});
		const canonicalMeal = mealFixture({
			id: '60000000-0000-4000-8000-000000000000',
			mealType: 'breakfast',
			occurrence: interaction.payload.proposedMeal.occurrence,
			items: [
				{
					id: '61000000-0000-4000-8000-000000000000',
					name: 'Havregröt',
					amountText: '1 skål',
					ingredients: [
						{
							id: '62000000-0000-4000-8000-000000000000',
							name: 'Banan',
							amountText: '1 st'
						}
					]
				}
			]
		});
		const requests: Record<string, unknown>[] = [];
		const create = vi.fn(async (request: Record<string, unknown>) => {
			requests.push(request);
			if (requests.length === 1) return stream(toolResponse());

			const serializedInput = JSON.stringify(request.input);
			const answer =
				serializedInput.includes('Havregröt') && serializedInput.includes('Banan')
					? 'Måltiden innehöll havregröt med banan.'
					: 'Underlaget saknas.';
			return stream(textResponse(answer));
		});
		const networkRunner: typeof runModelStep = (
			input,
			userId,
			signal,
			onTextDelta,
			_createStream,
			options
		) =>
			runModelStep(
				input,
				userId,
				signal,
				onTextDelta,
				(streamInput, streamUserId, streamSignal, streamOptions) =>
					createModelStream(
						streamInput,
						streamUserId,
						streamSignal,
						streamOptions,
						{ responses: { create } } as never,
						'test-safety-id'
					),
				options
			);
		const rpc = vi.fn(async () => ({
			data: { status: 'registered', meal: canonicalMeal, replayed: false },
			error: null
		}));
		const events: ChatStreamEvent[] = [];

		await orchestrateChatTurn(
			{
				client: { rpc } as unknown as SupabaseClient,
				userId: USER_ID,
				turnId: TURN_ID,
				timezone: 'Europe/Stockholm',
				modelInput: context.messages,
				toolCatalog: createToolCatalog({ hasPendingInteraction: true }),
				pendingInteractionBindings: context.pendingInteractionBindings,
				userMessage,
				beginPromise: Promise.resolve(createdBegin(userMessage)),
				signal: new AbortController().signal,
				emit: (event) => events.push(event)
			},
			{
				runModelStep: networkRunner,
				runResponseFinalizer: vi.fn(),
				completeChatTurn: vi.fn(async (_client, input) => ({
					message: { ...assistantMessage(userMessage), content: input.content },
					conversation
				})),
				failChatTurn: vi.fn()
			}
		);

		expect(requests).toHaveLength(2);
		expect(requests[0]).toMatchObject({
			tool_choice: { type: 'function', name: 'process_interaction_response' }
		});
		const continuationInput = requests[1].input as OpenAI.Responses.ResponseInput;
		const preservedCall = continuationInput.find(
			(item) => 'type' in item && item.type === 'function_call'
		);
		const functionOutput = continuationInput.find(
			(item) => 'type' in item && item.type === 'function_call_output'
		);
		expect(preservedCall).toEqual(
			expect.objectContaining({
				type: 'function_call',
				call_id: 'call_interaction',
				name: 'process_interaction_response'
			})
		);
		expect(functionOutput).toEqual({
			type: 'function_call_output',
			call_id: 'call_interaction',
			name: 'process_interaction_response',
			output: '{"status":"registered"}'
		});
		expect(JSON.stringify(functionOutput)).not.toContain(canonicalMeal.id);

		const pendingProjection = continuationInput.find(
			(item) =>
				'role' in item &&
				item.role === 'developer' &&
				'content' in item &&
				typeof item.content === 'string' &&
				item.content.includes('Verifierade väntande interactions:')
		) as { content: string } | undefined;
		expect(pendingProjection?.content).toContain('interaction_1');
		expect(pendingProjection?.content).toContain('Havregröt');
		expect(pendingProjection?.content).toContain('1 skål');
		expect(pendingProjection?.content).toContain('Banan');
		expect(pendingProjection?.content).toContain('1 st');
		expect(events).toContainEqual(
			expect.objectContaining({
				type: 'delta',
				text: 'Måltiden innehöll havregröt med banan.'
			})
		);
	});
});

const USER_ID = '50000000-0000-4000-8000-000000000000';
const TURN_ID = '30000000-0000-4000-8000-000000000000';

const conversation: ConversationSummary = {
	id: '10000000-0000-4000-8000-000000000000',
	title: 'Måltid',
	createdAt: '2026-08-08T10:00:00.000Z',
	updatedAt: '2026-08-08T10:00:00.000Z',
	lastMessageAt: '2026-08-08T10:00:00.000Z'
};

function createdBegin(content: string): Extract<BeginChatTurnResult, { status: 'created' }> {
	return {
		status: 'created',
		conversation,
		message: userChatMessage(content),
		turnLeaseExpiresAt: '2026-08-08T10:02:00.000Z',
		journalRecords: [],
		interactions: []
	};
}

function userChatMessage(content: string): ChatMessage {
	return {
		id: '20000000-0000-4000-8000-000000000000',
		conversationId: conversation.id,
		turnId: TURN_ID,
		role: 'user',
		content,
		createdAt: conversation.createdAt
	};
}

function assistantMessage(content: string): ChatMessage {
	return {
		id: '40000000-0000-4000-8000-000000000000',
		conversationId: conversation.id,
		turnId: TURN_ID,
		role: 'assistant',
		content,
		createdAt: '2026-08-08T10:00:01.000Z'
	};
}

function duplicateInteraction(): MealDuplicateInteractionV1 {
	const proposedMeal = {
		mealType: 'breakfast' as const,
		occurrence: {
			precision: 'date' as const,
			occurredAt: null,
			occurredOn: '2026-08-08',
			timezone: 'Europe/Stockholm',
			timePeriod: null
		},
		items: [
			{
				name: 'Havregröt',
				amountText: '1 skål',
				ingredients: [{ name: 'Banan', amountText: '1 st' }]
			}
		]
	};
	return {
		id: '70000000-0000-4000-8000-000000000000',
		kind: 'meal_duplicate',
		status: 'pending',
		schemaVersion: 1,
		policyVersion: 1,
		proposalTurnId: '80000000-0000-4000-8000-000000000000',
		proposalOperationId: '80000000-0000-4000-8000-000000000000:0',
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
		createdAt: '2026-08-08T09:59:00.000Z',
		activatedAt: '2026-08-08T09:59:01.000Z',
		resolvedAt: null
	};
}

function toolResponse() {
	const call = {
		type: 'function_call',
		call_id: 'call_interaction',
		name: 'process_interaction_response',
		arguments: JSON.stringify({
			interactionRef: 'interaction_1',
			responseMeaning: 'confirmed_with_additional_intent'
		})
	};
	return [
		{ type: 'response.output_item.added', item: call },
		{ type: 'response.completed', response: { output: [call] } }
	];
}

function textResponse(text: string) {
	return [
		{ type: 'response.output_item.added', item: { type: 'message' } },
		{ type: 'response.output_text.delta', delta: text },
		{
			type: 'response.completed',
			response: {
				output: [{ type: 'message', content: [{ type: 'output_text', text }] }]
			}
		}
	];
}

function stream(events: unknown[]) {
	return (async function* () {
		for (const event of events) yield event;
	})();
}
