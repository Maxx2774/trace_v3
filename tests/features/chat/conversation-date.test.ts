import { describe, expect, it } from 'vitest';
import { formatConversationDate } from '$lib/features/chat/conversation-date';

const now = new Date('2026-08-06T12:00:00');

describe('formatConversationDate', () => {
	it.each([
		['2026-08-06T09:40:00', 'Idag 09:40'],
		['2026-08-05T10:00:00', 'Igår 10:00'],
		['2026-08-03T10:00:00', '3 dagar sedan 10:00'],
		['2026-07-28T10:00:00', 'Förra veckan 10:00'],
		['2026-07-20T10:00:00', '2 veckor sedan 10:00'],
		['2025-08-06T10:00:00', '6 aug. 2025 10:00']
	])('formats %s as %s', (value, expected) => {
		expect(formatConversationDate(value, now)).toBe(expected);
	});
});
