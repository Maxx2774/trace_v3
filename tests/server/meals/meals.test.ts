import {
	MealMutationConflictError,
	MealNotFoundError,
	MealRevisionConflictError,
	mapMeal,
	updateOwnedMeal
} from '$lib/server/meals/meals';
import type { UpdateMealInput } from '$lib/features/meals/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { mealFixture } from '../../helpers/meals';

const input: UpdateMealInput = {
	id: '20000000-0000-4000-8000-000000000000',
	expectedRevision: 3,
	clientMutationId: '30000000-0000-4000-8000-000000000000',
	mealType: 'breakfast',
	occurrence: {
		precision: 'date',
		occurredAt: null,
		occurredOn: '2026-08-06',
		timezone: 'Europe/Stockholm',
		timePeriod: null
	},
	items: [
		{
			id: '40000000-0000-4000-8000-000000000000',
			name: 'Äggröra',
			amountText: null,
			ingredients: [
				{
					id: '50000000-0000-4000-8000-000000000000',
					name: 'Ägg',
					amountText: '4 st'
				}
			]
		}
	]
};

describe('updateOwnedMeal', () => {
	it('calls the atomic update with revision and mutation identity', async () => {
		const meal = mealFixture({ id: input.id, revision: 4 });
		const rpc = vi.fn(async () => ({ data: meal, error: null }));
		const client = { rpc } as unknown as SupabaseClient;

		await expect(
			updateOwnedMeal(client, '10000000-0000-4000-8000-000000000000', input)
		).resolves.toEqual(meal);
		expect(rpc).toHaveBeenCalledWith('update_meal', {
			p_user_id: '10000000-0000-4000-8000-000000000000',
			p_meal_id: input.id,
			p_expected_revision: 3,
			p_client_mutation_id: input.clientMutationId,
			p_meal_type: 'breakfast',
			p_occurred_precision: 'date',
			p_occurred_at: null,
			p_occurred_on: '2026-08-06',
			p_timezone: 'Europe/Stockholm',
			p_time_period: null,
			p_items: input.items
		});
	});

	it.each([
		['P0002', MealNotFoundError],
		['40001', MealRevisionConflictError],
		['23505', MealMutationConflictError]
	])('maps database error %s to its domain error', async (code, ErrorType) => {
		const client = {
			rpc: vi.fn(async () => ({ data: null, error: { code } }))
		} as unknown as SupabaseClient;

		await expect(
			updateOwnedMeal(client, '10000000-0000-4000-8000-000000000000', input)
		).rejects.toBeInstanceOf(ErrorType);
	});
});

describe('mapMeal', () => {
	it('sorts stable items and their ingredients by position', () => {
		const meal = mapMeal({
			id: input.id,
			revision: 2,
			meal_type: 'dinner',
			occurred_precision: 'unknown',
			occurred_at: null,
			occurred_on: null,
			timezone: null,
			time_period: null,
			created_at: '2026-08-06T18:00:00.000Z',
			updated_at: '2026-08-06T18:01:00.000Z',
			meal_items: [
				{
					id: 'b',
					position: 1,
					name: 'Pommes',
					amount_text: null,
					meal_item_ingredients: []
				},
				{
					id: 'a',
					position: 0,
					name: 'Biff',
					amount_text: null,
					meal_item_ingredients: [
						{ id: 'i2', position: 1, name: 'Salt', amount_text: null },
						{ id: 'i1', position: 0, name: 'Nötkött', amount_text: '200 g' }
					]
				}
			]
		});

		expect(meal.items.map((item) => item.name)).toEqual(['Biff', 'Pommes']);
		expect(meal.items[0].ingredients.map((ingredient) => ingredient.name)).toEqual([
			'Nötkött',
			'Salt'
		]);
	});
});
