import { differenceInCalendarDays, formatCalendarDate, getLocalDate } from '$lib/date-time';
import type { Meal } from '$lib/features/meals/contracts';

export type MealDateGroup = {
	key: string;
	label: string;
	meals: Meal[];
};

export function groupMealsByDate(meals: Meal[], now = new Date()): MealDateGroup[] {
	const groups = new Map<string, MealDateGroup>();
	const sortedMeals = [...meals].sort(compareMealsByOccurrence);

	for (const meal of sortedMeals) {
		const localDate = meal.occurrence.occurredOn;
		const key = localDate ?? 'unknown';
		const existingGroup = groups.get(key);
		if (existingGroup) {
			existingGroup.meals.push(meal);
			continue;
		}

		groups.set(key, {
			key,
			label:
				localDate === null
					? 'Datum ej angivet'
					: formatMealGroupLabel(localDate, meal.occurrence.timezone, now),
			meals: [meal]
		});
	}

	return [...groups.values()];
}

function formatMealGroupLabel(localDate: string, timezone: string, now: Date): string {
	const difference = differenceInCalendarDays(getLocalDate(now, timezone), localDate);
	if (difference === 0) return 'Idag';
	if (difference === 1) return 'Igår';

	const formatted = formatCalendarDate(localDate, {
		weekday: 'long',
		day: 'numeric',
		month: 'long'
	});
	return formatted.charAt(0).toLocaleUpperCase('sv-SE') + formatted.slice(1);
}

function compareMealsByOccurrence(left: Meal, right: Meal): number {
	const leftDate = left.occurrence.occurredOn;
	const rightDate = right.occurrence.occurredOn;
	if (leftDate === null) return rightDate === null ? compareMealTimes(left, right) : 1;
	if (rightDate === null) return -1;
	if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
	return compareMealTimes(left, right);
}

function compareMealTimes(left: Meal, right: Meal): number {
	const leftTime = left.occurrence.occurredAt ?? left.createdAt;
	const rightTime = right.occurrence.occurredAt ?? right.createdAt;
	return rightTime.localeCompare(leftTime);
}
