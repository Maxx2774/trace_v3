import {
	formatMealOccurrence,
	formatRelativeMealDate,
	localTimeInput,
	occurrenceForMutation,
	zonedDateTimeToIso
} from '$lib/features/meals/meal-time';
import type { MealOccurrence } from '$lib/features/meals/contracts';
import { describe, expect, it } from 'vitest';

const now = new Date('2026-08-06T10:00:00.000Z');

describe('meal occurrence formatting', () => {
	it('uses today, yesterday and weekday names for recent consumed dates', () => {
		expect(formatRelativeMealDate('2026-08-06', 'Europe/Stockholm', now)).toBe('Idag');
		expect(formatRelativeMealDate('2026-08-05', 'Europe/Stockholm', now)).toBe('Igår');
		expect(formatRelativeMealDate('2026-08-04', 'Europe/Stockholm', now)).toBe('Tisdag');
	});

	it('uses a short absolute date outside the recent window and for future dates', () => {
		expect(formatRelativeMealDate('2026-07-30', 'Europe/Stockholm', now)).toBe('30 juli');
		expect(formatRelativeMealDate('2026-08-07', 'Europe/Stockholm', now)).toBe('7 aug.');
	});

	it('preserves exact, approximate, date-only and unknown precision', () => {
		expect(formatMealOccurrence(occurrence('exact'), now)).toBe('Idag, 08:30');
		expect(formatMealOccurrence(occurrence('approximate'), now)).toBe('Idag, cirka 08:30');
		expect(formatMealOccurrence(occurrence('date'), now)).toBe('Idag');
		expect(formatMealOccurrence(occurrence('unknown'), now)).toBe('Datum ej angivet');
	});

	it('shows a saved approximate expression when no clock time was inferred', () => {
		expect(
			formatMealOccurrence(
				{
					precision: 'approximate',
					occurredAt: null,
					occurredOn: '2026-08-06',
					timezone: 'Europe/Stockholm',
					timeExpression: 'vid lunch'
				},
				now
			)
		).toBe('Idag, vid lunch');
	});
});

describe('meal occurrence editing', () => {
	it('converts local Stockholm time without losing its wall-clock value', () => {
		const iso = zonedDateTimeToIso('2026-08-06', '08:30', 'Europe/Stockholm');
		expect(iso).toBe('2026-08-06T06:30:00.000Z');
		expect(localTimeInput(iso, 'Europe/Stockholm')).toBe('08:30');
	});

	it('keeps the full precision contract when preparing a mutation', () => {
		expect(occurrenceForMutation(occurrence('exact'))).toEqual({
			precision: 'exact',
			occurredAt: '2026-08-06T06:30:00.000Z',
			timezone: 'Europe/Stockholm',
			timeExpression: null
		});
	});
});

function occurrence(precision: MealOccurrence['precision']): MealOccurrence {
	if (precision === 'exact') {
		return {
			precision,
			occurredAt: '2026-08-06T06:30:00.000Z',
			occurredOn: '2026-08-06',
			timezone: 'Europe/Stockholm',
			timeExpression: null
		};
	}
	if (precision === 'approximate') {
		return {
			precision,
			occurredAt: '2026-08-06T06:30:00.000Z',
			occurredOn: '2026-08-06',
			timezone: 'Europe/Stockholm',
			timeExpression: 'ungefär halv nio'
		};
	}
	if (precision === 'date') {
		return {
			precision,
			occurredAt: null,
			occurredOn: '2026-08-06',
			timezone: 'Europe/Stockholm',
			timeExpression: null
		};
	}
	return {
		precision,
		occurredAt: null,
		occurredOn: null,
		timezone: null,
		timeExpression: null
	};
}
