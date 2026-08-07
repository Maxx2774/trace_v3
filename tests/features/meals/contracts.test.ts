import {
	MEAL_LIMITS,
	MEAL_TIME_PERIOD_OPTIONS,
	MEAL_TIME_PERIODS,
	MEAL_TYPE_OPTIONS,
	MEAL_TYPES,
	isMealTimePeriod,
	isMealType
} from '$lib/features/meals/contracts';
import { describe, expect, it } from 'vitest';

describe('meal runtime contract', () => {
	it('shares canonical meal values through type guards', () => {
		expect(isMealType('breakfast')).toBe(true);
		expect(isMealType('brunch')).toBe(false);
		expect(isMealTimePeriod('evening')).toBe(true);
		expect(isMealTimePeriod('yesterday')).toBe(false);
		expect(MEAL_TYPE_OPTIONS.map((option) => option.value)).toEqual(MEAL_TYPES);
		expect(MEAL_TIME_PERIOD_OPTIONS.map((option) => option.value)).toEqual(MEAL_TIME_PERIODS);
	});

	it('exposes the canonical nested payload limits', () => {
		expect(MEAL_LIMITS).toMatchObject({
			maxNameLength: 160,
			maxItems: 20,
			maxIngredientsPerItem: 30,
			maxIngredients: 100
		});
	});
});
