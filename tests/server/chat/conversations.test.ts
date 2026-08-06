import type { ConversationDetailPage } from '$lib/features/chat/contracts';
import { getOwnedConversationPage } from '$lib/server/chat/conversations';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

describe('getOwnedConversationPage', () => {
	it('requests twenty turns for the initial page', async () => {
		const page = conversationPage();
		const rpc = vi.fn().mockResolvedValue({ data: page, error: null });

		await expect(
			getOwnedConversationPage({ rpc } as unknown as SupabaseClient, USER_ID, CONVERSATION_ID, null)
		).resolves.toEqual(page);
		expect(rpc).toHaveBeenCalledWith('get_conversation_page', {
			p_user_id: USER_ID,
			p_conversation_id: CONVERSATION_ID,
			p_before_created_at: null,
			p_before_turn_id: null,
			p_turn_limit: 20
		});
	});

	it('requests fifteen turns before the supplied cursor', async () => {
		const page = conversationPage();
		const rpc = vi.fn().mockResolvedValue({ data: page, error: null });
		const before = {
			createdAt: '2026-08-05T10:00:00.000Z',
			turnId: '30000000-0000-4000-8000-000000000000'
		};

		await getOwnedConversationPage(
			{ rpc } as unknown as SupabaseClient,
			USER_ID,
			CONVERSATION_ID,
			before
		);

		expect(rpc).toHaveBeenCalledWith('get_conversation_page', {
			p_user_id: USER_ID,
			p_conversation_id: CONVERSATION_ID,
			p_before_created_at: before.createdAt,
			p_before_turn_id: before.turnId,
			p_turn_limit: 15
		});
	});
});

const USER_ID = '10000000-0000-4000-8000-000000000000';
const CONVERSATION_ID = '20000000-0000-4000-8000-000000000000';

function conversationPage(): ConversationDetailPage {
	return {
		id: CONVERSATION_ID,
		title: 'Test',
		createdAt: '2026-08-06T10:00:00.000Z',
		updatedAt: '2026-08-06T10:00:00.000Z',
		lastMessageAt: '2026-08-06T10:00:00.000Z',
		messages: [],
		journalRecords: [],
		olderCursor: null
	};
}
