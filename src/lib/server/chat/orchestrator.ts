import type { ChatStreamEvent, ConversationSummary } from '$lib/features/chat/contracts';
import type { JournalRecord, TurnJournalRecord } from '$lib/features/journal/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type OpenAI from 'openai';
import { runModelStep, ProviderStepError } from './provider';
import { prepareToolCall, type PreparedToolCall, type ToolCallPreparation } from './tools/registry';
import {
	completeChatTurn,
	failChatTurn,
	type BeginChatTurnResult,
	type CommitChatTurnResult
} from './turns';

const MAX_MODEL_STEPS = 6;
const MAX_FUNCTION_CALLS = 5;
const MAX_PARALLEL_CALLS = 3;
const MODEL_STEP_TIMEOUT_MS = 35_000;
const TURN_TIMEOUT_MS = 100_000;
const REGISTRATION_CONFIRMATION = 'Registrerat';

export type TurnOperationError = {
	operationIndex: number;
	code: string;
	correctable: boolean;
};

export type TurnOutcome = {
	status: 'succeeded' | 'partially_succeeded' | 'failed';
	records: JournalRecord[];
	errors: TurnOperationError[];
};

type ProcessingBeginResult = Extract<BeginChatTurnResult, { status: 'created' | 'resumed' }>;

export async function orchestrateChatTurn(
	input: {
		client: SupabaseClient;
		userId: string;
		turnId: string;
		modelInput: OpenAI.Responses.ResponseInput;
		beginPromise: Promise<BeginChatTurnResult>;
		signal: AbortSignal;
		emit: (event: ChatStreamEvent) => void;
		afterComplete?: (
			result: CommitChatTurnResult,
			begin: ProcessingBeginResult
		) => Promise<ConversationSummary>;
	},
	dependencies: {
		runModelStep: typeof runModelStep;
		completeChatTurn: typeof completeChatTurn;
		failChatTurn: typeof failChatTurn;
	} = { runModelStep, completeChatTurn, failChatTurn }
): Promise<TurnOutcome> {
	const turnController = new AbortController();
	const abortTurn = () => turnController.abort(input.signal.reason);
	input.signal.addEventListener('abort', abortTurn, { once: true });
	const totalTimeout = setTimeout(
		() => turnController.abort(new Error('turn_timeout')),
		TURN_TIMEOUT_MS
	);

	let begin: ProcessingBeginResult | null = null;
	let modelInput = input.modelInput;
	let modelSteps = 0;
	let functionCalls = 0;
	let streamedText = '';
	const records: JournalRecord[] = [];
	const errors: TurnOperationError[] = [];

	try {
		const pendingDeltas: string[] = [];
		const firstStepPromise = runStep(
			modelInput,
			input.userId,
			turnController.signal,
			(delta) => pendingDeltas.push(delta),
			dependencies.runModelStep
		);
		void firstStepPromise.catch(() => {});
		modelSteps += 1;

		const beginResult = await input.beginPromise;
		if (beginResult.status === 'completed') {
			turnController.abort(new Error('completed_replay'));
			emitReplay(input.emit, input.turnId, beginResult);
			return {
				status: 'succeeded',
				records: beginResult.journalRecords.map(recordValue),
				errors: []
			};
		}
		if (beginResult.status !== 'created' && beginResult.status !== 'resumed') {
			turnController.abort(new Error(`begin_${beginResult.status}`));
			emitBeginError(input.emit, input.turnId, beginResult);
			return { status: 'failed', records: [], errors: [] };
		}

		begin = beginResult;
		input.emit({
			type: 'conversation',
			conversation: begin.conversation,
			message: begin.message,
			turnId: input.turnId
		});
		for (const entry of begin.journalRecords) {
			input.emit({ type: 'journal_record_created', turnId: input.turnId, record: entry.record });
			appendRecord(records, entry.record);
		}
		for (const delta of pendingDeltas) {
			streamedText += delta;
			input.emit({ type: 'delta', turnId: input.turnId, text: delta });
		}

		let step = await firstStepPromise;
		while (true) {
			if (step.functionCalls.length === 0) {
				const canonicalText = step.text.trim();
				if (streamedText !== canonicalText) {
					input.emit({ type: 'replace', turnId: input.turnId, text: canonicalText });
				}

				const committed = await dependencies.completeChatTurn(input.client, {
					userId: input.userId,
					turnId: input.turnId,
					leaseExpiresAt: begin.leaseExpiresAt,
					content: canonicalText
				});
				const conversation = input.afterComplete
					? await input.afterComplete(committed, begin)
					: committed.conversation;
				input.emit({
					type: 'done',
					turnId: input.turnId,
					message: committed.message,
					conversation
				});
				return { status: outcomeStatus(records, errors), records, errors };
			}

			if (functionCalls + step.functionCalls.length > MAX_FUNCTION_CALLS) {
				throw new TurnTerminalError('protocol_error', 'För många verktygsanrop i samma svar.');
			}

			const preparations = step.functionCalls.map((call, index) =>
				prepareToolCall(call, functionCalls + index)
			);
			functionCalls += step.functionCalls.length;
			const terminalPreparation = preparations.find((result) => !result.ok && !result.correctable);
			if (terminalPreparation && !terminalPreparation.ok) {
				throw new TurnTerminalError('tool_error', 'Modellen valde ett otillåtet verktyg.');
			}

			const executionResults = await executePreparedCalls(
				preparations,
				input.client,
				input.userId,
				input.turnId,
				begin.leaseExpiresAt
			);
			const functionOutputs: OpenAI.Responses.ResponseInputItem.FunctionCallOutput[] = [];
			let terminalExecutionError = false;
			let successfulJournalWrites = 0;
			let continueModel = false;

			for (let index = 0; index < preparations.length; index += 1) {
				const preparation = preparations[index];
				if (!preparation.ok) {
					errors.push({
						operationIndex: functionCalls - preparations.length + index,
						code: String(preparation.output.code),
						correctable: preparation.correctable
					});
					functionOutputs.push(
						functionOutput(preparation.callId, preparation.key, preparation.output)
					);
					continue;
				}

				const result = executionResults.get(preparation.call.operationIndex);
				if (!result || result.status === 'rejected') {
					errors.push({
						operationIndex: preparation.call.operationIndex,
						code: 'tool_execution_failed',
						correctable: false
					});
					terminalExecutionError = true;
					functionOutputs.push(
						functionOutput(preparation.call.callId, preparation.call.key, {
							status: 'error',
							code: 'tool_execution_failed'
						})
					);
					continue;
				}

				const value = result.value;
				continueModel ||= value.continueModel === true;
				functionOutputs.push(
					functionOutput(preparation.call.callId, preparation.call.key, value.output)
				);
				if (value.record && appendRecord(records, value.record)) {
					successfulJournalWrites += 1;
					input.emit({
						type: 'journal_record_created',
						turnId: input.turnId,
						record: value.record
					});
				} else if (value.record) successfulJournalWrites += 1;
			}

			if (terminalExecutionError) {
				throw new TurnTerminalError('tool_error', 'En journalpost kunde inte sparas.');
			}

			if (
				preparations.length > 0 &&
				successfulJournalWrites === preparations.length &&
				errors.length === 0 &&
				!continueModel
			) {
				const committed = await dependencies.completeChatTurn(input.client, {
					userId: input.userId,
					turnId: input.turnId,
					leaseExpiresAt: begin.leaseExpiresAt,
					content: REGISTRATION_CONFIRMATION
				});
				const conversation = input.afterComplete
					? await input.afterComplete(committed, begin)
					: committed.conversation;
				input.emit({
					type: 'done',
					turnId: input.turnId,
					message: committed.message,
					conversation
				});
				return { status: 'succeeded', records, errors };
			}

			modelInput = [
				...modelInput,
				...(step.output as unknown as OpenAI.Responses.ResponseInput),
				...functionOutputs
			];
			if (modelSteps >= MAX_MODEL_STEPS) {
				throw new TurnTerminalError('protocol_error', 'För många modellsteg i samma svar.');
			}

			streamedText = '';
			step = await runStep(
				modelInput,
				input.userId,
				turnController.signal,
				(delta) => {
					streamedText += delta;
					input.emit({ type: 'delta', turnId: input.turnId, text: delta });
				},
				dependencies.runModelStep
			);
			modelSteps += 1;
		}
	} catch (cause) {
		const totalTimedOut =
			turnController.signal.aborted &&
			turnController.signal.reason instanceof Error &&
			turnController.signal.reason.message === 'turn_timeout';
		turnController.abort(cause);
		if (begin && !input.signal.aborted) {
			const retryable = cause instanceof ProviderStepError ? cause.retryable : totalTimedOut;
			await dependencies
				.failChatTurn(input.client, {
					userId: input.userId,
					turnId: input.turnId,
					leaseExpiresAt: begin.leaseExpiresAt,
					retryable
				})
				.catch(() => {});
			input.emit({
				type: 'error',
				turnId: input.turnId,
				retryable,
				code:
					cause instanceof ProviderStepError
						? cause.code
						: cause instanceof TurnTerminalError
							? cause.code
							: totalTimedOut
								? 'timeout'
								: 'persistence_error',
				message: cause instanceof Error ? safeErrorMessage(cause) : 'Svaret kunde inte slutföras.'
			});
		} else if (!input.signal.aborted) {
			input.emit({
				type: 'error',
				turnId: input.turnId,
				retryable: true,
				code: 'persistence_error',
				message: 'Meddelandet kunde inte sparas.'
			});
		}
		return { status: outcomeStatus(records, errors, true), records, errors };
	} finally {
		clearTimeout(totalTimeout);
		input.signal.removeEventListener('abort', abortTurn);
	}
}

class TurnTerminalError extends Error {
	constructor(
		readonly code: 'protocol_error' | 'tool_error',
		message: string
	) {
		super(message);
	}
}

async function runStep(
	input: OpenAI.Responses.ResponseInput,
	userId: string,
	turnSignal: AbortSignal,
	onDelta: (delta: string) => void,
	runner: typeof runModelStep
) {
	const controller = new AbortController();
	let timedOut = false;
	const abort = () => controller.abort(turnSignal.reason);
	turnSignal.addEventListener('abort', abort, { once: true });
	const timeout = setTimeout(() => {
		timedOut = true;
		controller.abort(new Error('model_step_timeout'));
	}, MODEL_STEP_TIMEOUT_MS);
	try {
		return await runner(input, userId, controller.signal, onDelta);
	} catch (cause) {
		if (timedOut) throw new ProviderStepError('timeout', 'Svaret tog för lång tid.', true);
		throw cause;
	} finally {
		clearTimeout(timeout);
		turnSignal.removeEventListener('abort', abort);
	}
}

async function executePreparedCalls(
	preparations: ToolCallPreparation[],
	client: SupabaseClient,
	userId: string,
	turnId: string,
	leaseExpiresAt: string
) {
	const calls = preparations
		.filter((result): result is Extract<ToolCallPreparation, { ok: true }> => result.ok)
		.map((result) => result.call);
	const results = new Map<
		number,
		PromiseSettledResult<Awaited<ReturnType<PreparedToolCall['tool']['execute']>>>
	>();

	let parallelGroup: PreparedToolCall[] = [];
	const executeGroup = async (group: PreparedToolCall[]) => {
		if (group.length === 0) return;
		const settled = await Promise.allSettled(
			group.map((call) =>
				call.tool.execute(
					{
						client,
						userId,
						turnId,
						leaseExpiresAt,
						operationIndex: call.operationIndex
					},
					call.args as never
				)
			)
		);
		settled.forEach((result, index) => results.set(group[index].operationIndex, result));
	};

	for (const call of calls) {
		if (call.tool.policy.parallelSafe) {
			parallelGroup.push(call);
			if (parallelGroup.length === MAX_PARALLEL_CALLS) {
				await executeGroup(parallelGroup);
				parallelGroup = [];
			}
		} else {
			await executeGroup(parallelGroup);
			parallelGroup = [];
			await executeGroup([call]);
		}
	}
	await executeGroup(parallelGroup);

	return results;
}

function functionOutput(
	callId: string,
	key: string,
	output: Record<string, unknown>
): OpenAI.Responses.ResponseInputItem.FunctionCallOutput {
	const [namespace, name] = key.split('.', 2);
	return {
		type: 'function_call_output',
		call_id: callId,
		namespace,
		name,
		output: JSON.stringify(output)
	};
}

function emitReplay(
	emit: (event: ChatStreamEvent) => void,
	turnId: string,
	result: Extract<BeginChatTurnResult, { status: 'completed' }>
) {
	emit({
		type: 'conversation',
		conversation: result.conversation,
		message: result.message,
		turnId
	});
	for (const entry of result.journalRecords) {
		emit({ type: 'journal_record_created', turnId, record: entry.record });
	}
	emit({ type: 'replace', turnId, text: result.assistantMessage.content });
	emit({
		type: 'done',
		turnId,
		message: result.assistantMessage,
		conversation: result.conversation
	});
}

function emitBeginError(
	emit: (event: ChatStreamEvent) => void,
	turnId: string,
	result: Exclude<BeginChatTurnResult, { status: 'created' | 'resumed' | 'completed' }>
) {
	const code =
		result.status === 'failed_terminal'
			? result.code
			: result.status === 'not_found'
				? 'not_found'
				: `turn_${result.status}`;
	emit({
		type: 'error',
		turnId,
		retryable: result.status === 'pending',
		code: code as Extract<ChatStreamEvent, { type: 'error' }>['code'],
		message:
			result.status === 'pending'
				? 'Ett svar för meddelandet pågår redan.'
				: result.status === 'not_found'
					? 'Konversationen hittades inte.'
					: result.status === 'conflict'
						? 'Meddelandet kan inte återanvändas för denna tur.'
						: 'Den här turen kan inte köras igen.'
	});
}

function outcomeStatus(
	records: JournalRecord[],
	errors: TurnOperationError[],
	failed = false
): TurnOutcome['status'] {
	if (records.length > 0 && (errors.length > 0 || failed)) return 'partially_succeeded';
	if (failed || errors.length > 0) return 'failed';
	return 'succeeded';
}

function recordValue(entry: TurnJournalRecord): JournalRecord {
	return entry.record;
}

function appendRecord(records: JournalRecord[], record: JournalRecord): boolean {
	if (
		records.some(
			(candidate) => candidate.kind === record.kind && candidate.value.id === record.value.id
		)
	) {
		return false;
	}
	records.push(record);
	return true;
}

function safeErrorMessage(error: Error): string {
	if (error instanceof ProviderStepError || error instanceof TurnTerminalError)
		return error.message;
	return 'Svaret kunde inte slutföras.';
}
