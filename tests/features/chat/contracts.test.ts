import { describe, expect, it } from 'vitest';
import { upsertConversation, type ConversationSummary } from '$lib/features/chat/contracts';

const conversation: ConversationSummary = {
	id: '10000000-0000-4000-8000-000000000000',
	title: 'Provisorisk titel',
	createdAt: '2026-08-06T10:00:00.000Z',
	updatedAt: '2026-08-06T10:00:01.000Z',
	lastMessageAt: '2026-08-06T10:00:01.000Z'
};

describe('upsertConversation', () => {
	it('accepts a newer conversation summary', () => {
		const updated = {
			...conversation,
			title: 'Genererad titel',
			updatedAt: '2026-08-06T10:00:02.000Z'
		};

		expect(upsertConversation([conversation], updated)[0]).toEqual(updated);
	});

	it('keeps a newer cached rename when a stale stream event arrives', () => {
		const manuallyRenamed = {
			...conversation,
			title: 'Mitt eget namn',
			updatedAt: '2026-08-06T10:00:03.000Z'
		};

		expect(upsertConversation([manuallyRenamed], conversation)[0]).toEqual(manuallyRenamed);
	});
});
