import type { JournalRecord } from '$lib/features/journal/contracts';
import type { MealDuplicateInteractionV1 } from '$lib/features/meals/contracts';
import { buildModelContext } from '$lib/server/chat/history';
import { CHAT_SYSTEM_PROMPT, createModelStream } from '$lib/server/chat/model';
import { runModelStep, type ModelStep } from '$lib/server/chat/provider';
import { runResponseFinalizer } from '$lib/server/chat/response-finalizer';
import { createToolCatalog } from '$lib/server/chat/tools/registry';
import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { mealFixture } from '../helpers/meals';

type Variant = 'full' | 'minimal';

type Usage = {
	inputTokens: number;
	cachedInputTokens: number;
	uncachedInputTokens: number;
	outputTokens: number;
	reasoningTokens: number;
};

type StepObservation = {
	step: ModelStep;
	usage: Usage;
	firstToolEventMs: number | null;
	firstTextDeltaMs: number | null;
	totalMs: number;
};

const mode = process.env.TRACE_PROCESS_INTERACTION_EVAL;
const toolCatalog = createToolCatalog({ hasPendingInteraction: true });
const interaction = duplicateInteraction();
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
const journalRecord: JournalRecord = {
	kind: 'meal',
	reference: {
		type: 'meal',
		recordId: canonicalMeal.id,
		committedRevision: canonicalMeal.revision
	},
	value: canonicalMeal
};

describe.skipIf(mode !== 'canary')('process interaction provider acceptance', () => {
	it('accepts the production continuation request with minimal function output', async () => {
		const result = await runLiveJourney('minimal');
		expectExactInteractionCall(result.first.step);
		expect(result.second.step.functionCalls).toHaveLength(0);
		expect(result.second.step.text).toEqual(expect.any(String));
	}, 120_000);

	it('accepts the recovery-finalizer request', async () => {
		const result = await runRecoveryFinalizer();
		expect(result.fulfilledRequirementRefs).toEqual(['recovery_interaction_1']);
		expect(result.text).toEqual(expect.any(String));
	}, 60_000);
});

describe.skipIf(mode !== 'semantic')('process interaction live semantic evaluation', () => {
	it('classifies confirmation with additional intent and answers from preserved proposal context', async () => {
		const result = await runLiveJourney('minimal');
		expectExactInteractionCall(result.first.step);
		expectMealContents(result.second.step.text);
	}, 120_000);

	it('answers recovery intent from the canonical journal record', async () => {
		const result = await runRecoveryFinalizer();
		expect(result.fulfilledRequirementRefs).toEqual(['recovery_interaction_1']);
		expectMealContents(result.text);
	}, 60_000);
});

describe.skipIf(mode !== 'benchmark')('process interaction output benchmark', () => {
	it('compares full and minimal outputs with a shared first-step fixture', async () => {
		const modelInput = continuationModelInput();
		const first = await observeModelStep(modelInput, 'process_interaction_response');
		expectExactInteractionCall(first.step);
		const sequence: Variant[] = ['full', 'minimal', 'minimal', 'full', 'full', 'minimal'];
		const results = [];

		for (const variant of sequence) {
			const serializationStart = performance.now();
			const output = functionOutput(variant, first.step.functionCalls[0].call_id);
			const toolExecutionMs = performance.now() - serializationStart;
			const second = await observeModelStep([
				...modelInput,
				...(first.step.output as unknown as OpenAI.Responses.ResponseInput),
				output
			]);
			expectMealContents(second.step.text);
			results.push({
				variant,
				modelCalls: 2,
				toolCalls: 1,
				firstToolEventMs: first.firstToolEventMs,
				firstProviderMs: first.totalMs,
				secondFirstTextMs: second.firstTextDeltaMs,
				secondProviderMs: second.totalMs,
				toolExecutionMs,
				totalTurnMs: first.totalMs + toolExecutionMs + second.totalMs,
				inputTokens: first.usage.inputTokens + second.usage.inputTokens,
				cachedInputTokens: first.usage.cachedInputTokens + second.usage.cachedInputTokens,
				uncachedInputTokens: first.usage.uncachedInputTokens + second.usage.uncachedInputTokens,
				outputTokens: first.usage.outputTokens + second.usage.outputTokens,
				reasoningTokens: first.usage.reasoningTokens + second.usage.reasoningTokens,
				secondInputTokens: second.usage.inputTokens,
				secondCachedInputTokens: second.usage.cachedInputTokens,
				secondUncachedInputTokens: second.usage.uncachedInputTokens,
				secondOutputTokens: second.usage.outputTokens,
				secondReasoningTokens: second.usage.reasoningTokens,
				functionOutputBytes: Buffer.byteLength(String(output.output), 'utf8')
			});
		}

		console.log(`TRACE_PROCESS_INTERACTION_BENCHMARK ${JSON.stringify({ sequence, results })}`);
	}, 360_000);
});

async function runLiveJourney(variant: Variant) {
	const modelInput = continuationModelInput();
	const first = await observeModelStep(modelInput, 'process_interaction_response');
	expectExactInteractionCall(first.step);
	const output = functionOutput(variant, first.step.functionCalls[0].call_id);
	const second = await observeModelStep([
		...modelInput,
		...(first.step.output as unknown as OpenAI.Responses.ResponseInput),
		output
	]);
	return { first, second, output };
}

function continuationModelInput(): OpenAI.Responses.ResponseInput {
	return buildModelContext({
		history: [],
		journalRecords: [],
		pendingInteractions: [interaction],
		current: {
			turnId: '30000000-0000-4000-8000-000000000000',
			content: 'Ja, registrera den. Vad innehöll måltiden?'
		},
		systemPrompt: CHAT_SYSTEM_PROMPT,
		timezone: 'Europe/Stockholm',
		now: new Date('2026-08-08T10:00:00.000Z')
	}).messages;
}

function functionOutput(
	variant: Variant,
	callId: string
): OpenAI.Responses.ResponseInputItem.FunctionCallOutput {
	return {
		type: 'function_call_output',
		call_id: callId,
		name: 'process_interaction_response',
		output: JSON.stringify(
			variant === 'minimal'
				? { status: 'registered' }
				: { status: 'registered', meal: canonicalMeal }
		)
	};
}

async function observeModelStep(
	input: OpenAI.Responses.ResponseInput,
	requiredToolName?: string
): Promise<StepObservation> {
	const started = performance.now();
	let firstToolEventMs: number | null = null;
	let firstTextDeltaMs: number | null = null;
	let usage = emptyUsage();
	let completedAt = started;
	const step = await runModelStep(
		input,
		'process-interaction-output-live-evaluation',
		new AbortController().signal,
		() => {},
		(async (
			streamInput: Parameters<typeof createModelStream>[0],
			userId: Parameters<typeof createModelStream>[1],
			signal: Parameters<typeof createModelStream>[2],
			options: Parameters<typeof createModelStream>[3]
		) => {
			const source = await createModelStream(streamInput, userId, signal, options);
			return (async function* () {
				for await (const event of source) {
					const elapsed = performance.now() - started;
					if (
						firstToolEventMs === null &&
						event.type === 'response.output_item.added' &&
						event.item.type === 'function_call'
					) {
						firstToolEventMs = elapsed;
					}
					if (firstTextDeltaMs === null && event.type === 'response.output_text.delta') {
						firstTextDeltaMs = elapsed;
					}
					if (event.type === 'response.completed') {
						completedAt = performance.now();
						usage = readUsage(event.response.usage);
					}
					yield event;
				}
			})();
		}) as never,
		{
			toolCatalog,
			...(requiredToolName ? { requiredToolName } : {})
		}
	);
	return {
		step,
		usage,
		firstToolEventMs,
		firstTextDeltaMs,
		totalMs: completedAt - started
	};
}

function readUsage(value: unknown): Usage {
	const usage = (value ?? {}) as Record<string, unknown>;
	const inputDetails = (usage.input_tokens_details ?? {}) as Record<string, unknown>;
	const outputDetails = (usage.output_tokens_details ?? {}) as Record<string, unknown>;
	const inputTokens = numberValue(usage.input_tokens);
	const cachedInputTokens = numberValue(inputDetails.cached_tokens);
	return {
		inputTokens,
		cachedInputTokens,
		uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens),
		outputTokens: numberValue(usage.output_tokens),
		reasoningTokens: numberValue(outputDetails.reasoning_tokens)
	};
}

function emptyUsage(): Usage {
	return {
		inputTokens: 0,
		cachedInputTokens: 0,
		uncachedInputTokens: 0,
		outputTokens: 0,
		reasoningTokens: 0
	};
}

function numberValue(value: unknown): number {
	return typeof value === 'number' ? value : 0;
}

function expectExactInteractionCall(step: ModelStep): void {
	expect(step.functionCalls).toHaveLength(1);
	expect(step.functionCalls[0]).toMatchObject({
		type: 'function_call',
		name: 'process_interaction_response'
	});
	expect(JSON.parse(step.functionCalls[0].arguments)).toEqual({
		interactionRef: 'interaction_1',
		responseMeaning: 'confirmed_with_additional_intent'
	});
}

function expectMealContents(text: string): void {
	const normalized = text.toLocaleLowerCase('sv-SE');
	expect(normalized).toContain('havregröt');
	expect(normalized).toContain('banan');
}

async function runRecoveryFinalizer() {
	return runResponseFinalizer(
		{
			referenceInstant: '2026-08-08T10:00:00.000Z',
			timezone: 'Europe/Stockholm',
			currentUserMessage: 'Ja, registrera den. Vad innehöll måltiden?',
			verifiedResponseParts: [
				{ kind: 'text', text: 'Registrerat' },
				{ kind: 'journal_record', record: journalRecord }
			],
			responseRequirements: [
				{
					ref: 'recovery_interaction_1',
					kind: 'complete_recovered_interaction_intent',
					schemaVersion: 1
				}
			]
		},
		'process-interaction-recovery-live-evaluation',
		new AbortController().signal
	);
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
