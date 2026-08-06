import {
	CONVERSATION_PAGE_SIZE,
	INITIAL_CONVERSATION_COUNT,
	type ConversationSummary
} from '$lib/features/chat/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
	createConversationPage,
	renameOwnedConversation,
	replaceProvisionalConversationTitle
} from '$lib/server/chat/conversations';

describe('createConversationPage', () => {
	it('supports the larger initial conversation page', () => {
		const conversations = Array.from({ length: INITIAL_CONVERSATION_COUNT + 1 }, (_, index) =>
			conversation(index)
		);

		const page = createConversationPage(conversations, INITIAL_CONVERSATION_COUNT);
		const lastConversation = conversations[INITIAL_CONVERSATION_COUNT - 1];

		expect(page.conversations).toHaveLength(INITIAL_CONVERSATION_COUNT);
		expect(page.nextCursor).toEqual({
			id: lastConversation.id,
			lastMessageAt: lastConversation.lastMessageAt
		});
	});

	it('returns a cursor when another page exists', () => {
		const conversations = Array.from({ length: CONVERSATION_PAGE_SIZE + 1 }, (_, index) =>
			conversation(index)
		);

		const page = createConversationPage(conversations);
		const lastConversation = conversations[CONVERSATION_PAGE_SIZE - 1];

		expect(page.conversations).toHaveLength(CONVERSATION_PAGE_SIZE);
		expect(page.nextCursor).toEqual({
			id: lastConversation.id,
			lastMessageAt: lastConversation.lastMessageAt
		});
	});

	it('omits the cursor when the final page fits', () => {
		const conversations = Array.from({ length: CONVERSATION_PAGE_SIZE }, (_, index) =>
			conversation(index)
		);

		expect(createConversationPage(conversations)).toEqual({
			conversations,
			nextCursor: null
		});
	});
});

describe('renameOwnedConversation', () => {
	it('updates only the requested owner conversation and returns the summary', async () => {
		const row = {
			id: '10000000-0000-4000-8000-000000000000',
			title: 'Nytt namn',
			created_at: '2026-08-06T10:00:00.000Z',
			updated_at: '2026-08-06T11:00:00.000Z',
			last_message_at: '2026-08-06T10:30:00.000Z'
		};
		const builder = createUpdateBuilder(row);
		const client = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

		const result = await renameOwnedConversation(
			client,
			'20000000-0000-4000-8000-000000000000',
			row.id,
			row.title
		);

		expect(client.from).toHaveBeenCalledWith('conversations');
		expect(builder.update).toHaveBeenCalledWith({
			title: row.title,
			updated_at: expect.any(String)
		});
		expect(builder.eq).toHaveBeenNthCalledWith(1, 'id', row.id);
		expect(builder.eq).toHaveBeenNthCalledWith(
			2,
			'user_id',
			'20000000-0000-4000-8000-000000000000'
		);
		expect(result).toEqual({
			id: row.id,
			title: row.title,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			lastMessageAt: row.last_message_at
		});
	});
});

describe('replaceProvisionalConversationTitle', () => {
	it('updates the title only while the provisional title is unchanged', async () => {
		const row = {
			id: '10000000-0000-4000-8000-000000000000',
			title: 'Magbesvär efter lunch',
			created_at: '2026-08-06T10:00:00.000Z',
			updated_at: '2026-08-06T11:00:00.000Z',
			last_message_at: '2026-08-06T10:30:00.000Z'
		};
		const builder = createUpdateBuilder(row);
		const client = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

		const result = await replaceProvisionalConversationTitle(
			client,
			'20000000-0000-4000-8000-000000000000',
			row.id,
			'jag har ont efter lunch',
			row.title
		);

		expect(builder.eq).toHaveBeenNthCalledWith(1, 'id', row.id);
		expect(builder.eq).toHaveBeenNthCalledWith(
			2,
			'user_id',
			'20000000-0000-4000-8000-000000000000'
		);
		expect(builder.eq).toHaveBeenNthCalledWith(3, 'title', 'jag har ont efter lunch');
		expect(result?.title).toBe(row.title);
	});

	it('does not overwrite a title that has already changed', async () => {
		const builder = createUpdateBuilder(null);
		const client = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

		await expect(
			replaceProvisionalConversationTitle(
				client,
				'20000000-0000-4000-8000-000000000000',
				'10000000-0000-4000-8000-000000000000',
				'Provisorisk titel',
				'Genererad titel'
			)
		).resolves.toBeNull();
	});
});

function createUpdateBuilder(data: unknown) {
	const builder = {
		update: vi.fn(),
		eq: vi.fn(),
		select: vi.fn(),
		maybeSingle: vi.fn(async () => ({ data, error: null }))
	};
	builder.update.mockReturnValue(builder);
	builder.eq.mockReturnValue(builder);
	builder.select.mockReturnValue(builder);
	return builder;
}

function conversation(index: number): ConversationSummary {
	const sequence = String(index).padStart(12, '0');
	const timestamp = new Date(Date.UTC(2026, 7, 6, 12, 0, -index)).toISOString();

	return {
		id: `00000000-0000-4000-8000-${sequence}`,
		title: `Konversation ${index}`,
		createdAt: timestamp,
		updatedAt: timestamp,
		lastMessageAt: timestamp
	};
}
