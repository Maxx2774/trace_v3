import type { JournalRecord } from '$lib/features/journal/contracts';
import type { Meal } from '$lib/features/meals/contracts';

export function mealFixture(overrides: Partial<Meal> = {}): Meal {
	return {
		id: '40000000-0000-4000-8000-000000000000',
		revision: 1,
		mealType: 'breakfast',
		items: [
			{
				id: '41000000-0000-4000-8000-000000000000',
				name: 'Gröt',
				amountText: null,
				ingredients: [
					{
						id: '42000000-0000-4000-8000-000000000000',
						name: 'Havregryn',
						amountText: null
					}
				]
			}
		],
		occurrence: {
			precision: 'unknown',
			occurredAt: null,
			occurredOn: null,
			timezone: null,
			timeExpression: null
		},
		createdAt: '2026-08-06T07:00:00.000Z',
		updatedAt: '2026-08-06T07:00:00.000Z',
		...overrides
	};
}

export function mealRecordFixture(meal = mealFixture()): JournalRecord {
	return {
		kind: 'meal',
		reference: { type: 'meal', recordId: meal.id, committedRevision: 1 },
		value: meal
	};
}
