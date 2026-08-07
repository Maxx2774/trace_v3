import { getLocalDate, getLocalTime, getRuntimeTimezone, zonedDateTimeToIso } from '$lib/date-time';
import type {
	Meal,
	MealIngredient,
	MealItem,
	MealItemMutationInput,
	MealOccurrence,
	MealOccurrenceInput,
	MealTimePeriod
} from './contracts';

export type MealItemDraft = {
	id: string | null;
	name: string;
	amountText: string;
};

export type MealIngredientDraft = MealItemDraft & {
	itemId: string;
};

export type MealOccurrenceDraft = {
	precision: Meal['occurrence']['precision'];
	date: string;
	time: string;
	timezone: string;
	timePeriod: MealTimePeriod | null;
};

export function mealItemsForMutation(items: MealItem[]): MealItemMutationInput[] {
	return items.map((item) => ({
		id: item.id,
		name: item.name,
		amountText: item.amountText,
		ingredients: item.ingredients.map(ingredientForMutation)
	}));
}

export function upsertMealItem(items: MealItem[], draft: MealItemDraft): MealItemMutationInput[] {
	const name = requiredText(draft.name, 'Namnet får inte vara tomt.');
	const mutations = mealItemsForMutation(items);
	const item = {
		id: draft.id,
		name,
		amountText: nullableText(draft.amountText),
		ingredients: []
	};

	if (draft.id === null) return [...mutations, item];
	return mutations.map((candidate) =>
		candidate.id === draft.id
			? { ...candidate, name: item.name, amountText: item.amountText }
			: candidate
	);
}

export function removeMealItem(items: MealItem[], itemId: string): MealItemMutationInput[] {
	return mealItemsForMutation(items).filter((item) => item.id !== itemId);
}

export function upsertMealIngredient(
	items: MealItem[],
	draft: MealIngredientDraft
): MealItemMutationInput[] {
	const name = requiredText(draft.name, 'Ingrediensens namn får inte vara tomt.');
	const mutations = mealItemsForMutation(items);
	if (!mutations.some((item) => item.id === draft.itemId)) {
		throw new Error('Måltidsdelen hittades inte.');
	}

	return mutations.map((item) => {
		if (item.id !== draft.itemId) return item;
		const ingredient = {
			id: draft.id,
			name,
			amountText: nullableText(draft.amountText)
		};
		return {
			...item,
			ingredients:
				draft.id === null
					? [...item.ingredients, ingredient]
					: item.ingredients.map((candidate) =>
							candidate.id === draft.id ? ingredient : candidate
						)
		};
	});
}

export function removeMealIngredient(
	items: MealItem[],
	itemId: string,
	ingredientId: string
): MealItemMutationInput[] {
	return mealItemsForMutation(items).map((item) =>
		item.id === itemId
			? {
					...item,
					ingredients: item.ingredients.filter((ingredient) => ingredient.id !== ingredientId)
				}
			: item
	);
}

export function createMealOccurrenceDraft(
	occurrence: MealOccurrence,
	now = new Date(),
	fallbackTimezone?: string
): MealOccurrenceDraft {
	const timezone = occurrence.timezone ?? fallbackTimezone ?? getRuntimeTimezone();
	return {
		precision: occurrence.precision,
		date: occurrence.occurredOn ?? getLocalDate(now, timezone),
		time:
			occurrence.occurredAt && occurrence.timezone
				? getLocalTime(new Date(occurrence.occurredAt), occurrence.timezone)
				: '',
		timezone,
		timePeriod: occurrence.timePeriod
	};
}

export function mealOccurrenceFromDraft(value: MealOccurrenceDraft): MealOccurrenceInput {
	if (value.precision === 'unknown') {
		return {
			precision: 'unknown',
			occurredAt: null,
			occurredOn: null,
			timezone: null,
			timePeriod: null
		};
	}
	if (!value.date) throw new Error('Ange ett datum.');
	if (value.precision === 'date') {
		return {
			precision: 'date',
			occurredAt: null,
			occurredOn: value.date,
			timezone: value.timezone,
			timePeriod: null
		};
	}
	if (value.precision === 'exact') {
		if (!value.time) throw new Error('Ange en exakt tid.');
		return {
			precision: 'exact',
			occurredAt: zonedDateTimeToIso(value.date, value.time, value.timezone),
			timezone: value.timezone,
			timePeriod: null
		};
	}
	if (value.time) {
		return {
			precision: 'approximate',
			occurredAt: zonedDateTimeToIso(value.date, value.time, value.timezone),
			timezone: value.timezone,
			timePeriod: null
		};
	}
	if (!value.timePeriod) throw new Error('Ange en ungefärlig klocktid eller tidsperiod.');
	return {
		precision: 'approximate',
		occurredAt: null,
		occurredOn: value.date,
		timezone: value.timezone,
		timePeriod: value.timePeriod
	};
}

function ingredientForMutation(ingredient: MealIngredient) {
	return {
		id: ingredient.id,
		name: ingredient.name,
		amountText: ingredient.amountText
	};
}

function requiredText(value: string, message: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(message);
	return trimmed;
}

function nullableText(value: string): string | null {
	return value.trim() || null;
}
