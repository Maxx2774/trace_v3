import type {
	ChatMessage,
	ChatStreamEvent,
	ConversationSummary
} from '$lib/features/chat/contracts';
import { createChatResponseStream } from '$lib/server/chat/stream';
import type { BeginChatTurnResult } from '$lib/server/chat/turns';
import { createToolCatalog } from '$lib/server/chat/tools/registry';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

const conversation: ConversationSummary = {
	id: '10000000-0000-4000-8000-000000000000',
	title: 'Lunch',
	createdAt: '2026-08-06T10:00:00.000Z',
	updatedAt: '2026-08-06T10:00:00.000Z',
	lastMessageAt: '2026-08-06T10:00:00.000Z'
};

const userMessage: ChatMessage = {
	id: '20000000-0000-4000-8000-000000000000',
	conversationId: conversation.id,
	turnId: '30000000-0000-4000-8000-000000000000',
	role: 'user',
	content: 'Jag åt lunch',
	createdAt: conversation.createdAt
};

const beginResult: BeginChatTurnResult = {
	status: 'created',
	conversation,
	message: userMessage,
	turnLeaseExpiresAt: '2026-08-06T10:02:00.000Z',
	journalRecords: [],
	interactions: []
};

describe('createChatResponseStream', () => {
	it('encodes orchestrator events as NDJSON', async () => {
		const events: ChatStreamEvent[] = [
			{ type: 'conversation', conversation, message: userMessage, turnId: userMessage.turnId },
			{
				type: 'error',
				turnId: userMessage.turnId,
				retryable: true,
				code: 'upstream_error',
				message: 'Försök igen.'
			}
		];
		const orchestrate = vi.fn(async (input: { emit: (event: ChatStreamEvent) => void }) => {
			for (const event of events) input.emit(event);
			return { status: 'failed' as const, records: [], errors: [] };
		});

		const stream = createChatResponseStream(
			{
				adminClient: {} as SupabaseClient,
				beginPromise: Promise.resolve(beginResult),
				modelInput: [{ role: 'user', content: userMessage.content }],
				toolCatalog: createToolCatalog({ hasPendingInteraction: false }),
				pendingInteractionBindings: [],
				userId: '40000000-0000-4000-8000-000000000000',
				turnId: userMessage.turnId,
				timezone: 'Europe/Stockholm',
				requestSignal: new AbortController().signal,
				requestId: 'request-test',
				isNewConversation: false,
				userMessage: userMessage.content
			},
			{
				orchestrateChatTurn: orchestrate as never,
				generateConversationTitle: vi.fn() as never,
				replaceProvisionalConversationMetadata: vi.fn() as never
			}
		);

		const parsed = (await new Response(stream).text())
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));

		expect(parsed).toEqual(events);
		expect(orchestrate).toHaveBeenCalledTimes(1);
	});
});
