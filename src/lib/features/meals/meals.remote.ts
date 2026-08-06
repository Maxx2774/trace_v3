import { command, getRequestEvent } from '$app/server';
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

const text = (maxLength: number) =>
	v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(maxLength));
const nullableAmount = v.nullable(text(80));
const nullableExpression = v.nullable(text(160));
const timezone = v.pipe(text(255), v.check(validTimezone, 'Ogiltig tidszon.'));
const uuid = v.pipe(v.string(), v.uuid());
const nullableUuid = v.nullable(uuid);

const occurrenceSchema = v.union([
	v.strictObject({
		precision: v.literal('exact'),
		occurredAt: v.pipe(v.string(), v.isoTimestamp()),
		timezone,
		timeExpression: nullableExpression
	}),
	v.strictObject({
		precision: v.literal('approximate'),
		occurredAt: v.pipe(v.string(), v.isoTimestamp()),
		timezone,
		timeExpression: text(160)
	}),
	v.strictObject({
		precision: v.literal('approximate'),
		occurredAt: v.null(),
		occurredOn: v.pipe(v.string(), v.isoDate()),
		timezone,
		timeExpression: text(160)
	}),
	v.strictObject({
		precision: v.literal('date'),
		occurredAt: v.null(),
		occurredOn: v.pipe(v.string(), v.isoDate()),
		timezone,
		timeExpression: nullableExpression
	}),
	v.strictObject({
		precision: v.literal('unknown'),
		occurredAt: v.null(),
		occurredOn: v.null(),
		timezone: v.null(),
		timeExpression: v.null()
	})
]);

const ingredientSchema = v.strictObject({
	id: nullableUuid,
	name: text(160),
	amountText: nullableAmount
});
const itemSchema = v.strictObject({
	id: nullableUuid,
	name: text(160),
	amountText: nullableAmount,
	ingredients: v.pipe(v.array(ingredientSchema), v.maxLength(30))
});
const updateMealInput = v.pipe(
	v.strictObject({
		id: uuid,
		expectedRevision: v.pipe(v.number(), v.integer(), v.minValue(1)),
		clientMutationId: uuid,
		mealType: v.nullable(v.picklist(['breakfast', 'lunch', 'dinner', 'snack', 'other'])),
		occurrence: occurrenceSchema,
		items: v.pipe(v.array(itemSchema), v.minLength(1), v.maxLength(20))
	}),
	v.check(
		(input) => input.items.reduce((total, item) => total + item.ingredients.length, 0) <= 100,
		'Måltiden innehåller för många ingredienser.'
	),
	v.check((input) => serializedSize(input) <= 32 * 1024, 'Måltidsändringen är för stor.')
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

function serializedSize(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function validTimezone(value: string): boolean {
	try {
		new Intl.DateTimeFormat('sv-SE', { timeZone: value }).format();
		return true;
	} catch {
		return false;
	}
}
