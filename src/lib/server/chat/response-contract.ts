import type OpenAI from 'openai';

export type FinalizerOutput = {
	text: string;
	fulfilledObligationRefs: string[];
};

export class FinalizerContractError extends Error {}

export function createFinalizerTextConfig(
	obligationRefs: string[]
): OpenAI.Responses.ResponseTextConfig {
	return {
		verbosity: 'low',
		format: {
			type: 'json_schema',
			name: 'trace_final_response',
			strict: true,
			description:
				'Ett naturligt svar och de servergivna svarsplikter som texten uttryckligen uppfyller.',
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					text: { type: 'string', minLength: 1 },
					fulfilledObligationRefs: {
						type: 'array',
						items: { type: 'string', enum: obligationRefs }
					}
				},
				required: ['text', 'fulfilledObligationRefs']
			}
		}
	};
}

export function parseFinalizerOutput(
	raw: string,
	expectedObligationRefs: string[]
): FinalizerOutput {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new FinalizerContractError('Finalizern returnerade inte giltig JSON.');
	}
	if (!value || typeof value !== 'object') {
		throw new FinalizerContractError('Finalizern returnerade ett ogiltigt objekt.');
	}
	const candidate = value as Record<string, unknown>;
	if (
		typeof candidate.text !== 'string' ||
		!candidate.text.trim() ||
		!Array.isArray(candidate.fulfilledObligationRefs) ||
		candidate.fulfilledObligationRefs.some((ref) => typeof ref !== 'string')
	) {
		throw new FinalizerContractError('Finalizern returnerade ett ogiltigt kontrakt.');
	}
	const actual = candidate.fulfilledObligationRefs as string[];
	const expected = new Set(expectedObligationRefs);
	if (
		actual.length !== expected.size ||
		new Set(actual).size !== actual.length ||
		actual.some((ref) => !expected.has(ref)) ||
		expectedObligationRefs.some((ref) => !actual.includes(ref))
	) {
		throw new FinalizerContractError('Finalizern uppfyllde inte exakt alla svarsplikter.');
	}
	return { text: candidate.text.trim(), fulfilledObligationRefs: actual };
}
