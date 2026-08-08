import {
	createFinalizerTextConfig,
	FinalizerContractError,
	parseFinalizerOutput
} from '$lib/server/chat/response-contract';
import { runResponseFinalizer } from '$lib/server/chat/response-finalizer';
import { describe, expect, it, vi } from 'vitest';

describe('response finalizer contract', () => {
	it('requires every response requirement exactly once', () => {
		expect(
			parseFinalizerOutput(
				JSON.stringify({
					text: 'Vill du registrera en till?',
					fulfilledRequirementRefs: ['response_1', 'response_2']
				}),
				['response_1', 'response_2']
			)
		).toEqual({
			text: 'Vill du registrera en till?',
			fulfilledRequirementRefs: ['response_1', 'response_2']
		});

		expect(() =>
			parseFinalizerOutput(
				JSON.stringify({ text: 'Ofullständigt', fulfilledRequirementRefs: ['response_1'] }),
				['response_1', 'response_2']
			)
		).toThrow(FinalizerContractError);
		expect(() =>
			parseFinalizerOutput(
				JSON.stringify({
					text: 'Dubbelt',
					fulfilledRequirementRefs: ['response_1', 'response_1']
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
						fulfilledRequirementRefs: { items: { enum: ['response_1'] } }
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
				fulfilledRequirementRefs: ['response_1']
			})
		}));
		const result = await runResponseFinalizer(
			{
				referenceInstant: '2026-08-07T10:00:00.000Z',
				timezone: 'Europe/Stockholm',
				currentUserMessage: 'Nej',
				verifiedResponseParts: [],
				responseRequirements: [
					{
						ref: 'response_1',
						kind: 'acknowledge_interaction_discard',
						schemaVersion: 1,
						interactionRef: 'interaction_1',
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
			text: {
				format: {
					schema: {
						properties: {
							fulfilledRequirementRefs: { items: { enum: ['response_1'] } }
						},
						required: ['text', 'fulfilledRequirementRefs']
					}
				}
			},
			max_output_tokens: 512,
			store: false
		});
		const requestInput = request.input as Array<{ role: string; content: string }>;
		const responseContext = JSON.parse(requestInput[0].content);
		expect(responseContext).toMatchObject({
			verifiedResponseParts: [],
			responseRequirements: [expect.objectContaining({ ref: 'response_1' })]
		});
		expect(responseContext).not.toHaveProperty('canonicalParts');
		expect(responseContext).not.toHaveProperty('responseObligations');
		expect(request).not.toHaveProperty('tools');
	});
});
