import { getChatUrl, getChatUrlState, getPrimaryNavigationUrl } from '$lib/features/chat/chat-url';
import { describe, expect, it } from 'vitest';

const conversationId = '10000000-0000-4000-8000-000000000000';

describe('chat URL state', () => {
	it('reads new chat, conversation list and active conversation states', () => {
		expect(getChatUrlState(url('/journal'))).toEqual({ view: 'new' });
		expect(getChatUrlState(url('/journal?chat=conversations'))).toEqual({
			view: 'conversations'
		});
		expect(getChatUrlState(url(`/journal?conversation=${conversationId}`))).toEqual({
			view: 'conversation',
			conversationId
		});
	});

	it('rejects unsupported or malformed chat state', () => {
		expect(getChatUrlState(url('/?chat=unknown'))).toEqual({ view: 'invalid' });
		expect(getChatUrlState(url('/?conversation=not-a-uuid'))).toEqual({ view: 'invalid' });
	});

	it('switches chat modes without losing page filters or hashes', () => {
		const current = url(`/journal?date=2026-08-07&conversation=${conversationId}#entry`);

		expect(getChatUrl(current, { view: 'conversations' })).toBe(
			'/journal?date=2026-08-07&chat=conversations#entry'
		);
		expect(getChatUrl(current, { view: 'new' })).toBe('/journal?date=2026-08-07#entry');
	});

	it('carries the selected chat state to another primary page', () => {
		const current = url(`/journal?date=2026-08-07&conversation=${conversationId}`);

		expect(getPrimaryNavigationUrl('/analysis?period=week', current)).toBe(
			`/analysis?period=week&conversation=${conversationId}`
		);
	});
});

function url(path: string): URL {
	return new URL(path, 'https://trace.test');
}
