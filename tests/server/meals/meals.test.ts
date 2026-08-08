import {
	MealMutationConflictError,
	MealNotFoundError,
	MealRevisionConflictError,
	createMealFromChat,
	listOwnedMeals,
	mapMeal,
	resolveMealDuplicateInteraction,
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

describe('chat meal outcomes', () => {
	it('maps created and confirmation-required database outcomes explicitly', async () => {
		const meal = mealFixture();
		const rpc = vi
			.fn()
			.mockResolvedValueOnce({
				data: { status: 'created', meal, replayed: false },
				error: null
			})
			.mockResolvedValueOnce({
				data: { status: 'confirmation_required', interaction: interaction(meal), replayed: true },
				error: null
			});
		const client = { rpc } as unknown as SupabaseClient;
		const request = {
			userId: '10000000-0000-4000-8000-000000000000',
			turnId: '20000000-0000-4000-8000-000000000000',
			turnLeaseExpiresAt: '2026-08-07T10:02:00.000Z',
			toolCallIndex: 0,
			meal: {
				mealType: meal.mealType,
				items: meal.items.map((item) => ({
					name: item.name,
					amountText: item.amountText,
					ingredients: item.ingredients.map((ingredient) => ({
						name: ingredient.name,
						amountText: ingredient.amountText
					}))
				})),
				occurred: meal.occurrence
			}
		};

		await expect(createMealFromChat(client, request)).resolves.toMatchObject({
			status: 'created',
			meal
		});
		await expect(createMealFromChat(client, request)).resolves.toMatchObject({
			status: 'confirmation_required',
			replayed: true
		});
		expect(rpc).toHaveBeenNthCalledWith(
			1,
			'create_meal_from_chat',
			expect.objectContaining({
				p_turn_lease_expires_at: request.turnLeaseExpiresAt,
				p_tool_call_index: request.toolCallIndex
			})
		);
	});

	it('maps a registered interaction resolution to its canonical meal', async () => {
		const meal = mealFixture();
		const rpc = vi.fn(async () => ({
			data: { status: 'registered', meal, replayed: false },
			error: null
		}));
		const client = { rpc } as unknown as SupabaseClient;
		await expect(
			resolveMealDuplicateInteraction(client, {
				userId: 'user',
				turnId: 'turn',
				turnLeaseExpiresAt: 'lease',
				toolCallIndex: 0,
				interactionId: 'interaction',
				decision: 'register'
			})
		).resolves.toEqual({ status: 'registered', meal, replayed: false });
		expect(rpc).toHaveBeenCalledWith(
			'resolve_meal_duplicate_interaction',
			expect.objectContaining({
				p_turn_lease_expires_at: 'lease',
				p_tool_call_index: 0
			})
		);
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

describe('listOwnedMeals', () => {
	it('filters by owner and orders the complete journal chronologically', async () => {
		const row = {
			id: input.id,
			revision: 2,
			meal_type: 'breakfast' as const,
			occurred_precision: 'date' as const,
			occurred_at: null,
			occurred_on: '2026-08-06',
			timezone: 'Europe/Stockholm',
			time_period: null,
			created_at: '2026-08-06T18:00:00.000Z',
			updated_at: '2026-08-06T18:01:00.000Z',
			meal_items: [
				{
					id: 'a',
					position: 0,
					name: 'Gröt',
					amount_text: null,
					meal_item_ingredients: []
				}
			]
		};
		const result = { data: [row], error: null };
		const builder = {
			select: vi.fn(),
			eq: vi.fn(),
			order: vi.fn(),
			then: resultThen(result)
		};
		builder.select.mockReturnValue(builder);
		builder.eq.mockReturnValue(builder);
		builder.order.mockReturnValue(builder);
		const from = vi.fn(() => builder);
		const client = { from } as unknown as SupabaseClient;

		await expect(listOwnedMeals(client, 'user-id')).resolves.toEqual([mapMeal(row)]);
		expect(from).toHaveBeenCalledWith('meals');
		expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-id');
		expect(builder.order.mock.calls).toEqual([
			['occurred_on', { ascending: false, nullsFirst: false }],
			['occurred_at', { ascending: false, nullsFirst: false }],
			['created_at', { ascending: false }],
			['id', { ascending: false }]
		]);
	});
});

function resultThen<T>(result: T) {
	return <TResult1 = T, TResult2 = never>(
		onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
		onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
	) => Promise.resolve(result).then(onfulfilled, onrejected);
}

function interaction(meal: ReturnType<typeof mealFixture>) {
	const summary = {
		mealType: meal.mealType,
		occurrence: meal.occurrence,
		items: meal.items.map((item) => ({
			name: item.name,
			amountText: item.amountText,
			ingredients: item.ingredients.map((ingredient) => ({
				name: ingredient.name,
				amountText: ingredient.amountText
			}))
		}))
	};
	return {
		id: 'interaction',
		kind: 'meal_duplicate',
		status: 'prepared',
		schemaVersion: 1,
		policyVersion: 1,
		proposalTurnId: 'turn',
		proposalOperationId: '20000000-0000-4000-8000-000000000000:0',
		proposalInputHash: 'a'.repeat(64),
		resolutionTurnId: null,
		resolutionOperationId: null,
		resolutionReason: null,
		payload: {
			proposedMeal: summary,
			existingMealSnapshot: summary,
			matchDetails: {
				policyVersion: 1,
				anchor: 'identical_payload',
				timeDifferenceMinutes: null,
				candidateCount: 1,
				differences: { mealType: 'match', amounts: 'match', ingredients: 'match' }
			}
		},
		createdAt: '2026-08-07T10:00:00.000Z',
		activatedAt: null,
		resolvedAt: null
	};
}
