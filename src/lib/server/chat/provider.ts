import type OpenAI from 'openai';
import type { Response as OpenAIResponse } from 'openai/resources/responses/responses';
import { createModelStream } from './model';
import { parseFinalizerOutput } from './response-contract';
import type { ToolCatalog } from './tools/registry';

export type ModelStep = {
	mode: 'text' | 'tool';
	text: string;
	output: OpenAI.Responses.ResponseOutputItem[];
	functionCalls: OpenAI.Responses.ResponseFunctionToolCall[];
	fulfilledObligationRefs: string[];
};

export class ProviderStepError extends Error {
	constructor(
		readonly code:
			'upstream_error' | 'incomplete_response' | 'empty_response' | 'protocol_error' | 'timeout',
		message: string,
		readonly retryable: boolean
	) {
		super(message);
	}
}

export async function runModelStep(
	input: OpenAI.Responses.ResponseInput,
	userId: string,
	signal: AbortSignal,
	onTextDelta: (delta: string) => void,
	createStream: typeof createModelStream = createModelStream,
	options?: { toolCatalog: ToolCatalog; obligationRefs?: string[]; requiredToolName?: string }
): Promise<ModelStep> {
	if (!options) throw new Error('Toolkatalog saknas för modellsteget.');
	const stream = await createStream(input, userId, signal, options);
	let mode: 'undecided' | 'text' | 'tool' = 'undecided';
	let completed: OpenAIResponse | null = null;
	let streamedText = '';
	let messageAppearedFirst = false;

	for await (const event of stream) {
		if (event.type === 'response.output_item.added') {
			const itemType = event.item.type;
			if (itemType === 'reasoning') continue;

			if (itemType === 'message') {
				if (mode === 'undecided') {
					mode = 'text';
					messageAppearedFirst = true;
				}
			} else if (isToolItem(itemType)) {
				if (messageAppearedFirst) {
					throw new ProviderStepError(
						'protocol_error',
						'Modellen blandade svarstext och verktygsanrop.',
						false
					);
				}
				mode = 'tool';
			}
		} else if (event.type === 'response.output_text.delta') {
			streamedText += event.delta;
			if (mode === 'text' && !options.obligationRefs?.length) onTextDelta(event.delta);
		} else if (event.type === 'response.completed') {
			completed = event.response;
		} else if (event.type === 'response.failed' || event.type === 'error') {
			throw new ProviderStepError('upstream_error', 'Svaret kunde inte slutföras.', true);
		} else if (event.type === 'response.incomplete') {
			throw new ProviderStepError('incomplete_response', 'Svaret blev inte färdigt.', true);
		}
	}

	if (!completed) {
		throw new ProviderStepError('upstream_error', 'Modellen avslutades utan ett resultat.', true);
	}

	const functionCalls = completed.output.filter(
		(item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === 'function_call'
	);
	const messageItems = completed.output.filter((item) => item.type === 'message');
	const rawText = extractCompletedOutputText(completed).trim();
	const hasToolItems = completed.output.some((item) => isToolItem(item.type));

	if (messageAppearedFirst && hasToolItems) {
		throw new ProviderStepError(
			'protocol_error',
			'Modellen blandade svarstext och verktygsanrop.',
			false
		);
	}
	if (functionCalls.length > 0 && messageItems.length > 0) {
		throw new ProviderStepError(
			'protocol_error',
			'Modellen blandade svarstext och verktygsanrop.',
			false
		);
	}

	if (functionCalls.length === 0 && !rawText) {
		throw new ProviderStepError('empty_response', 'Svaret innehöll ingen text.', true);
	}

	const finalMode = functionCalls.length > 0 || hasToolItems ? 'tool' : 'text';
	let canonicalText = rawText;
	let fulfilledObligationRefs: string[] = [];
	if (finalMode === 'text' && options.obligationRefs?.length) {
		const parsed = parseFinalizerOutput(rawText, options.obligationRefs);
		canonicalText = parsed.text;
		fulfilledObligationRefs = parsed.fulfilledObligationRefs;
	}
	if (finalMode === 'tool' && functionCalls.length === 0 && canonicalText) {
		onTextDelta(canonicalText);
	} else if (finalMode === 'text' && streamedText !== rawText) {
		// The orchestrator emits a canonical replace event after the step.
	}

	return {
		mode: finalMode,
		text: canonicalText,
		output: completed.output,
		functionCalls,
		fulfilledObligationRefs
	};
}

function extractCompletedOutputText(response: OpenAIResponse): string {
	let text = '';
	for (const item of response.output) {
		if (item.type !== 'message') continue;
		for (const part of item.content) {
			if (part.type === 'output_text') text += part.text;
		}
	}
	return text;
}

function isToolItem(type: string): boolean {
	return (
		type === 'tool_search_call' ||
		type === 'tool_search_output' ||
		type === 'additional_tools' ||
		type === 'function_call'
	);
}
