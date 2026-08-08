import type OpenAI from 'openai';

export type FinalizerOutput = {
	text: string;
	fulfilledRequirementRefs: string[];
};

export class FinalizerContractError extends Error {}

export function createFinalizerTextConfig(
	requirementRefs: string[]
): OpenAI.Responses.ResponseTextConfig {
	return {
		verbosity: 'low',
		format: {
			type: 'json_schema',
			name: 'trace_final_response',
			strict: true,
			description:
				'Ett naturligt svar och de servergivna svarskraven som texten uttryckligen uppfyller.',
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					text: { type: 'string', minLength: 1 },
					fulfilledRequirementRefs: {
						type: 'array',
						items: { type: 'string', enum: requirementRefs }
					}
				},
				required: ['text', 'fulfilledRequirementRefs']
			}
		}
	};
}

export function parseFinalizerOutput(
	raw: string,
	expectedRequirementRefs: string[]
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
		!Array.isArray(candidate.fulfilledRequirementRefs) ||
		candidate.fulfilledRequirementRefs.some((ref) => typeof ref !== 'string')
	) {
		throw new FinalizerContractError('Finalizern returnerade ett ogiltigt kontrakt.');
	}
	const actual = candidate.fulfilledRequirementRefs as string[];
	const expected = new Set(expectedRequirementRefs);
	if (
		actual.length !== expected.size ||
		new Set(actual).size !== actual.length ||
		actual.some((ref) => !expected.has(ref)) ||
		expectedRequirementRefs.some((ref) => !actual.includes(ref))
	) {
		throw new FinalizerContractError('Finalizern uppfyllde inte exakt alla svarskrav.');
	}
	return { text: candidate.text.trim(), fulfilledRequirementRefs: actual };
}
