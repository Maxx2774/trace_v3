import {
	createFinalizerTextConfig,
	FinalizerContractError,
	parseFinalizerOutput
} from '$lib/server/chat/response-contract';
import { runResponseFinalizer } from '$lib/server/chat/response-finalizer';
import { describe, expect, it, vi } from 'vitest';

describe('response finalizer contract', () => {
	it('requires every obligation exactly once', () => {
		expect(
			parseFinalizerOutput(
				JSON.stringify({
					text: 'Vill du registrera en till?',
					fulfilledObligationRefs: ['response_1', 'response_2']
				}),
				['response_1', 'response_2']
			)
		).toEqual({
			text: 'Vill du registrera en till?',
			fulfilledObligationRefs: ['response_1', 'response_2']
		});

		expect(() =>
			parseFinalizerOutput(
				JSON.stringify({ text: 'Ofullständigt', fulfilledObligationRefs: ['response_1'] }),
				['response_1', 'response_2']
			)
		).toThrow(FinalizerContractError);
		expect(() =>
			parseFinalizerOutput(
				JSON.stringify({
					text: 'Dubbelt',
					fulfilledObligationRefs: ['response_1', 'response_1']
				}),
				['response_1']
			)
		).toThrow(FinalizerContractError);
	});

	it('builds a strict low-verbosity schema', () => {
		expect(createFinalizerTextConfig(['response_1'])).toMatchObject({
			verbosity: 'low',
			format: {
				type: 'json_schema',
				strict: true,
				schema: {
					additionalProperties: false,
					properties: {
						fulfilledObligationRefs: { items: { enum: ['response_1'] } }
					}
				}
			}
		});
	});
});

describe('runResponseFinalizer', () => {
	it('uses Luna without tools and returns only validated natural text', async () => {
		const create = vi.fn(async () => ({
			status: 'completed',
			output_text: JSON.stringify({
				text: 'Okej, jag registrerade den inte.',
				fulfilledObligationRefs: ['response_1']
			})
		}));
		const result = await runResponseFinalizer(
			{
				referenceInstant: '2026-08-07T10:00:00.000Z',
				timezone: 'Europe/Stockholm',
				currentUserMessage: 'Nej',
				canonicalParts: [],
				responseObligations: [
					{
						ref: 'response_1',
						kind: 'acknowledge_interaction_discard',
						schemaVersion: 1,
						confirmationRef: 'pending_meal_1',
						reason: 'user_declined'
					}
				]
			},
			'user-id',
			new AbortController().signal,
			{ responses: { create } } as never,
			'test-safety-id'
		);

		expect(result.text).toBe('Okej, jag registrerade den inte.');
		const request = (create.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
		expect(request).toMatchObject({
			model: 'gpt-5.6-luna',
			reasoning: { effort: 'low', context: 'current_turn' },
			max_output_tokens: 512,
			store: false
		});
		expect(request).not.toHaveProperty('tools');
	});
});
