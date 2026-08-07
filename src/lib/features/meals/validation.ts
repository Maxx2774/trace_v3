import { MEAL_LIMITS, MEAL_TIME_PERIODS, MEAL_TYPES } from './contracts';
import * as v from 'valibot';

export const mealNameSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1),
	v.maxLength(MEAL_LIMITS.maxNameLength)
);

export const nullableMealAmountSchema = v.nullable(
	v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(MEAL_LIMITS.maxAmountLength))
);

export const mealTypeSchema = v.nullable(v.picklist(MEAL_TYPES));
export const mealTimePeriodSchema = v.picklist(MEAL_TIME_PERIODS);

export function hasAllowedIngredientCount(
	items: ReadonlyArray<{ ingredients: readonly unknown[] }>
): boolean {
	return (
		items.reduce((total, item) => total + item.ingredients.length, 0) <= MEAL_LIMITS.maxIngredients
	);
}

export function hasAllowedMealPayloadSize(value: unknown): boolean {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MEAL_LIMITS.maxPayloadBytes;
}
