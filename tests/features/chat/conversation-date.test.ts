import { describe, expect, it } from 'vitest';
import {
	getConversationDatePresentation,
	getRecentConversationDateLabel
} from '$lib/features/chat/conversation-date';

const now = new Date('2026-08-06T12:00:00');

describe('getConversationDatePresentation', () => {
	it.each([
		['2026-08-06T09:40:00', 'today', 'Idag', '09:40'],
		['2026-08-05T10:00:00', 'yesterday', 'Igår', '10:00'],
		['2026-08-03T19:20:00', 'this-week', 'Den här veckan', 'mån 19:20'],
		['2026-07-31T20:14:00', 'last-week', 'Förra veckan', 'fre 20:14'],
		['2026-07-24T10:00:00', 'month-2026-07', 'Juli', '24 jul'],
		['2025-12-24T10:00:00', 'month-2025-12', 'December 2025', '24 dec']
	])('formats %s for the %s group', (value, groupKey, groupLabel, dateLabel) => {
		expect(getConversationDatePresentation(value, now)).toEqual({
			groupKey,
			groupLabel,
			dateLabel
		});
	});
});

describe('getRecentConversationDateLabel', () => {
	it.each([
		['2026-08-06T23:48:00', '23:48'],
		['2026-08-05T10:00:00', 'Igår'],
		['2026-08-04T19:20:00', '4 aug'],
		['2025-12-24T10:00:00', '24 dec']
	])('formats %s as %s', (value, expected) => {
		expect(getRecentConversationDateLabel(value, now)).toBe(expected);
	});
});
