import type { ChatStreamEvent } from '$lib/features/chat/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type OpenAI from 'openai';
import { replaceProvisionalConversationTitle } from './conversations';
import { orchestrateChatTurn } from './orchestrator';
import { generateConversationTitle } from './title';
import type { BeginChatTurnResult } from './turns';
import type { PendingInteractionBinding } from './interactions';
import type { ToolCatalog } from './tools/registry';

const encoder = new TextEncoder();

export function createChatResponseStream(
	input: {
		adminClient: SupabaseClient;
		beginPromise: Promise<BeginChatTurnResult>;
		modelInput: OpenAI.Responses.ResponseInput;
		toolCatalog: ToolCatalog;
		pendingInteractionBindings: PendingInteractionBinding[];
		userId: string;
		turnId: string;
		timezone: string;
		requestSignal: AbortSignal;
		requestId: string;
		isNewConversation: boolean;
		userMessage: string;
	},
	dependencies: {
		orchestrateChatTurn: typeof orchestrateChatTurn;
		generateConversationTitle: typeof generateConversationTitle;
		replaceProvisionalConversationTitle: typeof replaceProvisionalConversationTitle;
	} = {
		orchestrateChatTurn,
		generateConversationTitle,
		replaceProvisionalConversationTitle
	}
): ReadableStream<Uint8Array> {
	const controller = new AbortController();
	const abort = () => controller.abort(input.requestSignal.reason);
	input.requestSignal.addEventListener('abort', abort, { once: true });

	return new ReadableStream<Uint8Array>({
		async start(streamController) {
			let open = true;
			const emit = (event: ChatStreamEvent) => {
				if (!open || controller.signal.aborted) return;
				try {
					streamController.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
				} catch {
					open = false;
					controller.abort();
				}
			};

			try {
				await dependencies.orchestrateChatTurn({
					client: input.adminClient,
					userId: input.userId,
					turnId: input.turnId,
					timezone: input.timezone,
					modelInput: input.modelInput,
					toolCatalog: input.toolCatalog,
					pendingInteractionBindings: input.pendingInteractionBindings,
					userMessage: input.userMessage,
					beginPromise: input.beginPromise,
					signal: controller.signal,
					emit,
					afterComplete: async (committed, begin) => {
						if (!input.isNewConversation || controller.signal.aborted) {
							return committed.conversation;
						}

						const provisionalTitle = begin.conversation.title;
						try {
							const generatedTitle = await dependencies.generateConversationTitle(
								input.userMessage,
								input.userId,
								controller.signal
							);
							if (!generatedTitle || generatedTitle === provisionalTitle) {
								return committed.conversation;
							}

							return (
								(await dependencies.replaceProvisionalConversationTitle(
									input.adminClient,
									input.userId,
									committed.conversation.id,
									provisionalTitle,
									generatedTitle
								)) ?? committed.conversation
							);
						} catch (error) {
							console.info(
								JSON.stringify({
									event: 'conversation_title_generation_failed',
									requestId: input.requestId,
									conversationId: committed.conversation.id,
									errorName: error instanceof Error ? error.name : 'UnknownError'
								})
							);
							return committed.conversation;
						}
					}
				});
			} catch (error) {
				console.error(
					JSON.stringify({
						event: 'chat_stream_error',
						requestId: input.requestId,
						turnId: input.turnId,
						errorName: error instanceof Error ? error.name : 'UnknownError'
					})
				);
			} finally {
				input.requestSignal.removeEventListener('abort', abort);
				if (open) {
					open = false;
					streamController.close();
				}
			}
		},
		cancel(reason) {
			controller.abort(reason);
			input.requestSignal.removeEventListener('abort', abort);
		}
	});
}
