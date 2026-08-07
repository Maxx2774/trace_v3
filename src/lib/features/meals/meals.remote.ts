import { command, getRequestEvent } from '$app/server';
import { isValidTimezone } from '$lib/date-time';
import { MEAL_LIMITS } from '$lib/features/meals/contracts';
import {
	hasAllowedIngredientCount,
	hasAllowedMealPayloadSize,
	mealNameSchema,
	mealTimePeriodSchema,
	mealTypeSchema,
	nullableMealAmountSchema
} from '$lib/features/meals/validation';
import { requireAuthenticatedUserId } from '$lib/server/auth';
import {
	MealMutationConflictError,
	MealNotFoundError,
	MealRevisionConflictError,
	updateOwnedMeal
} from '$lib/server/meals/meals';
import { getAdminSupabaseClient } from '$lib/server/supabase/admin';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';

const timezone = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1),
	v.maxLength(255),
	v.check(isValidTimezone, 'Ogiltig tidszon.')
);
const uuid = v.pipe(v.string(), v.uuid());
const nullableUuid = v.nullable(uuid);

const occurrenceSchema = v.union([
	v.strictObject({
		precision: v.literal('exact'),
		occurredAt: v.pipe(v.string(), v.isoTimestamp()),
		timezone,
		timePeriod: v.null()
	}),
	v.strictObject({
		precision: v.literal('approximate'),
		occurredAt: v.pipe(v.string(), v.isoTimestamp()),
		timezone,
		timePeriod: v.null()
	}),
	v.strictObject({
		precision: v.literal('approximate'),
		occurredAt: v.null(),
		occurredOn: v.pipe(v.string(), v.isoDate()),
		timezone,
		timePeriod: mealTimePeriodSchema
	}),
	v.strictObject({
		precision: v.literal('date'),
		occurredAt: v.null(),
		occurredOn: v.pipe(v.string(), v.isoDate()),
		timezone,
		timePeriod: v.null()
	}),
	v.strictObject({
		precision: v.literal('unknown'),
		occurredAt: v.null(),
		occurredOn: v.null(),
		timezone: v.null(),
		timePeriod: v.null()
	})
]);

const ingredientSchema = v.strictObject({
	id: nullableUuid,
	name: mealNameSchema,
	amountText: nullableMealAmountSchema
});
const itemSchema = v.strictObject({
	id: nullableUuid,
	name: mealNameSchema,
	amountText: nullableMealAmountSchema,
	ingredients: v.pipe(v.array(ingredientSchema), v.maxLength(MEAL_LIMITS.maxIngredientsPerItem))
});
const updateMealInput = v.pipe(
	v.strictObject({
		id: uuid,
		expectedRevision: v.pipe(v.number(), v.integer(), v.minValue(1)),
		clientMutationId: uuid,
		mealType: mealTypeSchema,
		occurrence: occurrenceSchema,
		items: v.pipe(v.array(itemSchema), v.minLength(1), v.maxLength(MEAL_LIMITS.maxItems))
	}),
	v.check(
		(input) => hasAllowedIngredientCount(input.items),
		'Måltiden innehåller för många ingredienser.'
	),
	v.check((input) => hasAllowedMealPayloadSize(input), 'Måltidsändringen är för stor.')
);

export const updateMeal = command(updateMealInput, async (input) => {
	const event = getRequestEvent();
	const userId = requireAuthenticatedUserId(event);

	try {
		return await updateOwnedMeal(getAdminSupabaseClient(), userId, input);
	} catch (cause) {
		if (cause instanceof MealNotFoundError) error(404, cause.message);
		if (cause instanceof MealRevisionConflictError) error(409, cause.message);
		if (cause instanceof MealMutationConflictError) error(409, cause.message);
		throw cause;
	}
});
