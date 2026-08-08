import { beginChatTurn, completeChatTurn, failChatTurn } from '$lib/server/chat/turns';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

describe('chat turn RPC contracts', () => {
	it('uses the turn lease name returned by begin_chat_turn', async () => {
		const rpc = vi.fn(async () => ({
			data: {
				status: 'created',
				conversation: {},
				message: {},
				turnLeaseExpiresAt: '2026-08-08T10:02:00.000Z',
				journalRecords: []
			},
			error: null
		}));
		const client = { rpc } as unknown as SupabaseClient;

		await expect(
			beginChatTurn(client, {
				userId: 'user',
				conversationId: null,
				turnId: 'turn',
				content: 'Hej'
			})
		).resolves.toMatchObject({
			status: 'created',
			turnLeaseExpiresAt: '2026-08-08T10:02:00.000Z'
		});
	});

	it('passes the synchronized turn lease parameter to completion and failure RPCs', async () => {
		const rpc = vi
			.fn()
			.mockResolvedValueOnce({ data: { message: {}, conversation: {} }, error: null })
			.mockResolvedValueOnce({ data: { status: 'failed_retryable' }, error: null });
		const client = { rpc } as unknown as SupabaseClient;

		await completeChatTurn(client, {
			userId: 'user',
			turnId: 'turn',
			turnLeaseExpiresAt: 'lease',
			content: 'Klart'
		});
		await failChatTurn(client, {
			userId: 'user',
			turnId: 'turn',
			turnLeaseExpiresAt: 'lease',
			retryable: true
		});

		expect(rpc).toHaveBeenNthCalledWith(1, 'complete_chat_turn', {
			p_user_id: 'user',
			p_turn_id: 'turn',
			p_turn_lease_expires_at: 'lease',
			p_content: 'Klart'
		});
		expect(rpc).toHaveBeenNthCalledWith(2, 'fail_chat_turn', {
			p_user_id: 'user',
			p_turn_id: 'turn',
			p_turn_lease_expires_at: 'lease',
			p_retryable: true
		});
	});
});
