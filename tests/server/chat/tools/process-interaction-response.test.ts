import {
	processInteractionResponseSchema,
	processInteractionResponseTool,
	type InteractionResponseMeaning
} from '$lib/server/chat/tools/process-interaction-response';
import { createToolCatalog, prepareToolCall } from '$lib/server/chat/tools/registry';
import type { SupabaseClient } from '@supabase/supabase-js';
import { safeParse } from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import { mealFixture } from '../../../helpers/meals';

const MEANINGS: InteractionResponseMeaning[] = [
	'confirmed',
	'confirmed_with_additional_intent',
	'rejected',
	'rejected_with_additional_intent',
	'conversation_moved_on',
	'corrected_input',
	'interaction_followup',
	'ambiguous_response'
];

describe('process_interaction_response', () => {
	it('is direct, strict and exposed only with verified pending state', () => {
		const withoutPending = createToolCatalog({ hasPendingInteraction: false });
		const withPending = createToolCatalog({ hasPendingInteraction: true });

		expect(processInteractionResponseTool).toMatchObject({
			key: 'process_interaction_response',
			exposure: 'direct'
		});
		expect(processInteractionResponseTool.definition).toMatchObject({
			name: 'process_interaction_response',
			strict: true,
			parameters: {
				type: 'object',
				additionalProperties: false,
				required: ['interactionRef', 'responseMeaning']
			}
		});
		expect(withoutPending.toolKeyByCallIdentity.has('.process_interaction_response')).toBe(false);
		expect(withPending.toolKeyByCallIdentity.get('.process_interaction_response')).toBe(
			'process_interaction_response'
		);
		expect(withPending.directTools.map((tool) => tool.name)).toEqual([
			'process_interaction_response'
		]);
		expect(withPending.namespaces[0].tools.map((tool) => tool.name)).toEqual(['record']);
	});

	it('accepts exactly the eight response meanings', () => {
		for (const responseMeaning of MEANINGS) {
			expect(
				safeParse(processInteractionResponseSchema, {
					interactionRef: 'interaction_1',
					responseMeaning
				}).success
			).toBe(true);
		}
		expect(
			safeParse(processInteractionResponseSchema, {
				interactionRef: 'interaction_1',
				responseMeaning: 'register',
				responseRequired: false
			}).success
		).toBe(false);
	});

	it('accepts only the direct call identity exposed for the current turn', () => {
		const directCall = {
			type: 'function_call',
			call_id: 'call_direct',
			name: 'process_interaction_response',
			arguments: JSON.stringify({
				interactionRef: 'interaction_1',
				responseMeaning: 'confirmed'
			})
		};

		expect(
			prepareToolCall(directCall as never, 0, createToolCatalog({ hasPendingInteraction: true }))
		).toMatchObject({
			ok: true,
			call: {
				key: 'process_interaction_response',
				name: 'process_interaction_response'
			}
		});
		expect(
			prepareToolCall(
				{ ...directCall, namespace: 'interaction' } as never,
				0,
				createToolCatalog({ hasPendingInteraction: true })
			)
		).toMatchObject({
			ok: false,
			correctable: false,
			modelOutput: { code: 'unknown_tool' }
		});
	});

	it.each([
		['confirmed', 'register', null, false],
		['confirmed_with_additional_intent', 'register', null, true],
		['rejected', 'discard', 'user_declined', false],
		['rejected_with_additional_intent', 'discard', 'user_declined', true],
		['conversation_moved_on', 'discard', 'conversation_moved_on', true],
		['corrected_input', 'discard', 'corrected_input', true]
	] as const)(
		'maps %s to one domain resolution',
		async (responseMeaning, decision, reason, requiresAgentContinuation) => {
			const meal = mealFixture();
			const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
				data:
					decision === 'register'
						? { status: 'registered', meal, replayed: false }
						: { status: 'discarded', reason: args.p_reason, replayed: false },
				error: null
			}));

			const result = await execute(responseMeaning, rpc);

			expect(rpc).toHaveBeenCalledWith('resolve_meal_duplicate_interaction', {
				p_user_id: 'user-id',
				p_resolution_turn_id: 'turn-id',
				p_turn_lease_expires_at: '2026-08-07T10:02:00.000Z',
				p_tool_call_index: 0,
				p_interaction_id: 'interaction-id',
				p_decision: decision,
				p_reason: reason
			});
			expect(result.orchestration.requiresAgentContinuation).toBe(requiresAgentContinuation);
			expect(result.modelOutput.status).toBe(decision === 'register' ? 'registered' : 'discarded');
			expect(result.orchestration.verifiedResponseParts).toHaveLength(
				decision === 'register' ? 2 : 0
			);
			expect(result.orchestration.responseRequirements).toHaveLength(
				decision === 'discard' ? 1 : 0
			);
		}
	);

	it.each(['interaction_followup', 'ambiguous_response'] as const)(
		'keeps %s pending without calling the domain operation',
		async (responseMeaning) => {
			const rpc = vi.fn();
			const result = await execute(responseMeaning, rpc);

			expect(rpc).not.toHaveBeenCalled();
			expect(result).toEqual({
				modelOutput: { status: 'pending', reason: responseMeaning },
				orchestration: {
					requiresAgentContinuation: true,
					verifiedResponseParts: [],
					responseRequirements: []
				}
			});
		}
	);

	it('rejects an interaction reference not present in verified server bindings', async () => {
		const rpc = vi.fn();
		const result = await processInteractionResponseTool.execute(
			{ ...context(rpc), pendingInteractionBindings: [] },
			{ interactionRef: 'interaction_1', responseMeaning: 'confirmed' } as never
		);

		expect(rpc).not.toHaveBeenCalled();
		expect(result.modelOutput).toEqual({ status: 'error', code: 'unknown_interaction_ref' });
	});
});

function execute(responseMeaning: InteractionResponseMeaning, rpc: ReturnType<typeof vi.fn>) {
	return processInteractionResponseTool.execute(context(rpc), {
		interactionRef: 'interaction_1',
		responseMeaning
	} as never);
}

function context(rpc: ReturnType<typeof vi.fn>) {
	return {
		client: { rpc } as unknown as SupabaseClient,
		userId: 'user-id',
		turnId: 'turn-id',
		turnLeaseExpiresAt: '2026-08-07T10:02:00.000Z',
		toolCallIndex: 0,
		timezone: 'Europe/Stockholm',
		pendingInteractionBindings: [
			{
				interactionRef: 'interaction_1',
				kind: 'meal_duplicate' as const,
				interactionId: 'interaction-id'
			}
		]
	};
}
