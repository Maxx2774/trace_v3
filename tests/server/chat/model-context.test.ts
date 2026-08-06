import { buildModelContext } from '$lib/server/chat/history';
import type { TurnJournalRecord } from '$lib/features/journal/contracts';
import { describe, expect, it } from 'vitest';
import { mealFixture, mealRecordFixture } from '../../helpers/meals';

describe('buildModelContext', () => {
	it('includes the immutable current message exactly once and preserves whole turns', () => {
		const context = buildModelContext({
			history: [
				message('turn-1', 'user', 'Första frågan', 0),
				message('turn-1', 'assistant', 'Första svaret', 1),
				message('incomplete', 'user', 'Saknar svar', 2),
				message('turn-2', 'user', 'Andra frågan', 3),
				message('turn-2', 'assistant', 'Andra svaret', 4)
			],
			journalRecords: [],
			current: { turnId: 'current', content: 'Aktuellt meddelande' },
			systemPrompt: 'System',
			timezone: 'Europe/Stockholm',
			now: new Date('2026-08-06T12:00:00.000Z')
		});

		expect(context.messages.filter((item) => item.content === 'Aktuellt meddelande')).toHaveLength(
			1
		);
		expect(context.messages.some((item) => item.content === 'Saknar svar')).toBe(false);
		expect(context.messages.map((item) => item.content)).toEqual([
			'Första frågan',
			'Första svaret',
			'Andra frågan',
			'Andra svaret',
			expect.stringContaining('Aktuell servertid'),
			'Aktuellt meddelande'
		]);
	});

	it('projects journal records through symbolic handles without exposing ids', () => {
		const record = mealRecord();
		const context = buildModelContext({
			history: [
				message('turn-1', 'user', 'Jag åt', 0),
				message('turn-1', 'assistant', 'Sparat', 1)
			],
			journalRecords: [record],
			current: { turnId: 'current', content: 'Hur känns det?' },
			systemPrompt: 'System',
			timezone: 'Europe/Stockholm',
			now: new Date('2026-08-06T12:00:00.000Z')
		});

		const serialized = JSON.stringify(context.messages);
		expect(serialized).toContain('ref_1');
		expect(serialized).toContain('Gröt');
		expect(serialized).toContain('breakfast');
		expect(serialized).toContain('occurrence');
		expect(serialized).not.toContain(record.record.value.id);
		expect(context.referenceBindings).toEqual([
			{ handle: 'ref_1', kind: 'meal', recordId: record.record.value.id }
		]);
	});
});

function message(turnId: string, role: 'user' | 'assistant', content: string, seconds: number) {
	return {
		turnId,
		role,
		content,
		createdAt: new Date(Date.UTC(2026, 7, 6, 12, 0, seconds)).toISOString()
	};
}

function mealRecord(): TurnJournalRecord {
	const meal = mealFixture({ id: 'meal-internal-id' });
	return {
		turnId: 'turn-1',
		record: mealRecordFixture(meal)
	};
}
