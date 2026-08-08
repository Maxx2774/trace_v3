import { describe, expect, it } from 'vitest';
import { groupMealsByDate } from '$lib/features/journal/meal-groups';
import type { Meal } from '$lib/features/meals/contracts';

const now = new Date('2026-08-08T12:00:00.000Z');

describe('groupMealsByDate', () => {
	it('groups meals under relative and full Swedish date labels', () => {
		const groups = groupMealsByDate(
			[
				meal('today-late', '2026-08-08', '2026-08-08T18:00:00.000Z'),
				meal('older', '2026-08-06', '2026-08-06T12:00:00.000Z'),
				meal('yesterday', '2026-08-07', '2026-08-07T12:00:00.000Z'),
				meal('today-early', '2026-08-08', '2026-08-08T08:00:00.000Z'),
				meal('unknown', null, null)
			],
			now
		);

		expect(groups.map((group) => group.label)).toEqual([
			'Idag',
			'Igår',
			'Torsdag 6 augusti',
			'Datum ej angivet'
		]);
		expect(groups[0].meals.map((meal) => meal.id)).toEqual(['today-late', 'today-early']);
	});
});

function meal(id: string, occurredOn: string | null, occurredAt: string | null): Meal {
	return {
		id,
		revision: 1,
		mealType: null,
		items: [],
		occurrence:
			occurredOn === null
				? {
						precision: 'unknown',
						occurredAt: null,
						occurredOn: null,
						timezone: null,
						timePeriod: null
					}
				: {
						precision: 'exact',
						occurredAt: occurredAt!,
						occurredOn,
						timezone: 'Europe/Stockholm',
						timePeriod: null
					},
		createdAt: occurredAt ?? '2026-08-01T00:00:00.000Z',
		updatedAt: occurredAt ?? '2026-08-01T00:00:00.000Z'
	};
}
