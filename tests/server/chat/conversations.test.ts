import type { ConversationDetailPage } from '$lib/features/chat/contracts';
import {
	getOwnedConversationPage,
	replaceProvisionalConversationMetadata
} from '$lib/server/chat/conversations';
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

describe('replaceProvisionalConversationMetadata', () => {
	it('stores title and category in the same guarded update', async () => {
		const row = {
			id: CONVERSATION_ID,
			title: 'Gröt igår',
			category: 'meal',
			created_at: '2026-08-06T10:00:00.000Z',
			updated_at: '2026-08-06T10:00:01.000Z',
			last_message_at: '2026-08-06T10:00:00.000Z'
		};
		const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
		const select = vi.fn().mockReturnValue({ maybeSingle });
		const eqTitle = vi.fn().mockReturnValue({ select });
		const eqUser = vi.fn().mockReturnValue({ eq: eqTitle });
		const eqId = vi.fn().mockReturnValue({ eq: eqUser });
		const update = vi.fn().mockReturnValue({ eq: eqId });
		const from = vi.fn().mockReturnValue({ update });

		await expect(
			replaceProvisionalConversationMetadata(
				{ from } as unknown as SupabaseClient,
				USER_ID,
				CONVERSATION_ID,
				'Jag åt gröt igår',
				{ title: 'Gröt igår', category: 'meal' }
			)
		).resolves.toMatchObject({ id: CONVERSATION_ID, title: 'Gröt igår' });

		expect(update).toHaveBeenCalledWith({
			title: 'Gröt igår',
			category: 'meal',
			updated_at: expect.any(String)
		});
		expect(eqTitle).toHaveBeenCalledWith('title', 'Jag åt gröt igår');
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
