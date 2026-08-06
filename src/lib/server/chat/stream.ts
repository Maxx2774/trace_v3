import type { ChatStreamEvent } from '$lib/features/chat/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Response as OpenAIResponse } from 'openai/resources/responses/responses';
import { performance } from 'node:perf_hooks';
import { replaceProvisionalConversationTitle } from './conversations';
import { assertHistoryBudget } from './history';
import { CHAT_SYSTEM_PROMPT, createModelStream } from './model';
import { generateConversationTitle } from './title';
import { commitChatTurn, type BeginChatTurnResult } from './turns';

const STREAM_TIMEOUT_MS = 60_000;
const encoder = new TextEncoder();

type StreamableBeginResult = Extract<BeginChatTurnResult, { status: 'created' | 'completed' }>;

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

export function createChatResponseStream(
	input: {
		adminClient: SupabaseClient;
		beginResult: StreamableBeginResult;
		userId: string;
		turnId: string;
		requestSignal: AbortSignal;
		requestId: string;
		dbBeginMs: number;
		isNewConversation: boolean;
	},
	dependencies: {
		createModelStream: typeof createModelStream;
		commitChatTurn: typeof commitChatTurn;
		generateConversationTitle: typeof generateConversationTitle;
		replaceProvisionalConversationTitle: typeof replaceProvisionalConversationTitle;
	} = {
		createModelStream,
		commitChatTurn,
		generateConversationTitle,
		replaceProvisionalConversationTitle
	}
): ReadableStream<Uint8Array> {
	const upstreamController = new AbortController();
	let timedOut = false;
	let clientAborted = input.requestSignal.aborted;

	const abortFromClient = () => {
		clientAborted = true;
		upstreamController.abort(input.requestSignal.reason);
	};
	input.requestSignal.addEventListener('abort', abortFromClient, { once: true });

	const timeout = setTimeout(() => {
		timedOut = true;
		upstreamController.abort(new Error('chat_timeout'));
	}, STREAM_TIMEOUT_MS);

	return new ReadableStream<Uint8Array>({
		async start(controller) {
			let controllerOpen = true;
			let firstTokenAt: number | null = null;
			let openAIStartedAt: number | null = null;
			let openAICompletedAt: number | null = null;
			let dbCommitMs: number | null = null;
			let dbRoundTrips = 1;
			let status = 'started';

			const send = (event: ChatStreamEvent) => {
				if (!controllerOpen || clientAborted) return;
				try {
					controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
				} catch {
					controllerOpen = false;
					abortFromClient();
				}
			};

			const close = () => {
				if (!controllerOpen) return;
				controllerOpen = false;
				try {
					controller.close();
				} catch {
					// The browser may already have cancelled the reader.
				}
			};

			const sendError = (
				code: Extract<ChatStreamEvent, { type: 'error' }>['code'],
				message: string
			) => send({ type: 'error', turnId: input.turnId, code, message });

			try {
				send({
					type: 'conversation',
					conversation: input.beginResult.conversation,
					message: input.beginResult.message,
					turnId: input.turnId
				});

				if (input.beginResult.status === 'completed') {
					send({
						type: 'replace',
						turnId: input.turnId,
						text: input.beginResult.assistantMessage.content
					});
					send({
						type: 'done',
						turnId: input.turnId,
						message: input.beginResult.assistantMessage,
						conversation: input.beginResult.conversation
					});
					status = 'replayed';
					return;
				}

				if (clientAborted) {
					status = 'aborted_before_model';
					return;
				}

				assertHistoryBudget(input.beginResult.history, CHAT_SYSTEM_PROMPT);
				openAIStartedAt = performance.now();
				const modelStream = await dependencies.createModelStream(
					input.beginResult.history,
					input.userId,
					upstreamController.signal
				);
				let deltaBuffer = '';
				let finalText: string | null = null;
				let completedReasoningContext: string | null = null;

				for await (const event of modelStream) {
					if (clientAborted) {
						status = 'aborted';
						return;
					}

					if (event.type === 'response.output_text.delta') {
						firstTokenAt ??= performance.now();
						deltaBuffer += event.delta;
						send({ type: 'delta', turnId: input.turnId, text: event.delta });
					} else if (event.type === 'response.completed') {
						openAICompletedAt = performance.now();
						finalText = extractCompletedOutputText(event.response);
						completedReasoningContext = event.response.reasoning?.context ?? null;
					} else if (event.type === 'response.failed') {
						status = 'upstream_failed';
						sendError('upstream_error', 'Svaret kunde inte slutföras.');
						return;
					} else if (event.type === 'response.incomplete') {
						status = 'incomplete';
						sendError('incomplete_response', 'Svaret blev inte färdigt.');
						return;
					} else if (event.type === 'error') {
						status = 'upstream_error';
						sendError('upstream_error', 'Svaret kunde inte slutföras.');
						return;
					}
				}

				const canonicalText = finalText?.trim() ?? '';
				if (!canonicalText) {
					status = 'empty_response';
					sendError('empty_response', 'Svaret innehöll ingen text.');
					return;
				}

				if (completedReasoningContext !== 'current_turn') {
					throw new Error('OpenAI returnerade oväntad reasoning context.');
				}

				if (deltaBuffer !== canonicalText) {
					send({ type: 'replace', turnId: input.turnId, text: canonicalText });
					console.info(
						JSON.stringify({
							event: 'chat_stream_text_mismatch',
							requestId: input.requestId,
							conversationId: input.beginResult.conversation.id,
							turnId: input.turnId
						})
					);
				}

				if (upstreamController.signal.aborted || clientAborted) {
					status = timedOut ? 'timeout' : 'aborted_before_commit';
					if (timedOut) sendError('timeout', 'Svaret tog för lång tid.');
					return;
				}

				const commitStartedAt = performance.now();
				let committed;
				try {
					committed = await dependencies.commitChatTurn(input.adminClient, {
						userId: input.userId,
						conversationId: input.beginResult.conversation.id,
						turnId: input.turnId,
						content: canonicalText
					});
					dbRoundTrips += 1;
					dbCommitMs = performance.now() - commitStartedAt;
				} catch {
					dbRoundTrips += 1;
					dbCommitMs = performance.now() - commitStartedAt;
					status = 'persistence_error';
					sendError('persistence_error', 'Svaret kunde inte sparas.');
					return;
				}

				let finalConversation = committed.conversation;
				const provisionalTitle = input.beginResult.conversation.title;
				if (
					input.isNewConversation &&
					committed.conversation.title === provisionalTitle &&
					!upstreamController.signal.aborted &&
					!clientAborted
				) {
					try {
						const generatedTitle = await dependencies.generateConversationTitle(
							input.beginResult.message.content,
							input.userId,
							upstreamController.signal
						);

						if (generatedTitle && generatedTitle !== provisionalTitle) {
							dbRoundTrips += 1;
							const titledConversation = await dependencies.replaceProvisionalConversationTitle(
								input.adminClient,
								input.userId,
								committed.conversation.id,
								provisionalTitle,
								generatedTitle
							);
							if (titledConversation) finalConversation = titledConversation;
						}
					} catch (error) {
						console.info(
							JSON.stringify({
								event: 'conversation_title_generation_failed',
								requestId: input.requestId,
								conversationId: committed.conversation.id,
								errorName: error instanceof Error ? error.name : 'UnknownError'
							})
						);
					}
				}

				send({
					type: 'done',
					turnId: input.turnId,
					message: committed.message,
					conversation: finalConversation
				});
				status = 'completed';
			} catch (error) {
				if (clientAborted) {
					status = 'aborted';
				} else if (timedOut) {
					status = 'timeout';
					sendError('timeout', 'Svaret tog för lång tid.');
				} else {
					status = 'upstream_error';
					sendError('upstream_error', 'Svaret kunde inte slutföras.');
					console.error(
						JSON.stringify({
							event: 'chat_stream_error',
							requestId: input.requestId,
							conversationId: input.beginResult.conversation.id,
							turnId: input.turnId,
							errorName: error instanceof Error ? error.name : 'UnknownError'
						})
					);
				}
			} finally {
				clearTimeout(timeout);
				input.requestSignal.removeEventListener('abort', abortFromClient);
				close();
				console.info(
					JSON.stringify({
						event: 'chat_stream_finished',
						requestId: input.requestId,
						conversationId: input.beginResult.conversation.id,
						turnId: input.turnId,
						status,
						db_begin_ms: Math.round(input.dbBeginMs),
						openai_ttft_ms:
							openAIStartedAt !== null && firstTokenAt !== null
								? Math.round(firstTokenAt - openAIStartedAt)
								: null,
						openai_total_ms:
							openAIStartedAt !== null && openAICompletedAt !== null
								? Math.round(openAICompletedAt - openAIStartedAt)
								: null,
						db_commit_ms: dbCommitMs === null ? null : Math.round(dbCommitMs),
						db_round_trips: dbRoundTrips
					})
				);
			}
		},
		cancel(reason) {
			clientAborted = true;
			clearTimeout(timeout);
			upstreamController.abort(reason);
			input.requestSignal.removeEventListener('abort', abortFromClient);
		}
	});
}
