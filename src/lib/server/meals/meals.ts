import type { TurnJournalRecord } from '$lib/features/journal/contracts';
import type {
	Meal,
	MealOccurrence,
	MealOccurrenceInput,
	MealType,
	UpdateMealInput
} from '$lib/features/meals/contracts';
import { isMealTimePeriod } from '$lib/features/meals/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';

type MealIngredientRow = {
	id: string;
	position: number;
	name: string;
	amount_text: string | null;
};

type MealItemRow = {
	id: string;
	position: number;
	name: string;
	amount_text: string | null;
	meal_item_ingredients: MealIngredientRow[] | null;
};

type MealRow = {
	id: string;
	revision: number;
	meal_type: MealType | null;
	source_turn_id?: string | null;
	source_operation_id?: string;
	occurred_precision: MealOccurrence['precision'];
	occurred_at: string | null;
	occurred_on: string | null;
	timezone: string | null;
	time_period: string | null;
	created_at: string;
	updated_at: string;
	meal_items: MealItemRow[] | null;
};

export type RecordMealInput = {
	mealType: MealType | null;
	items: Array<{
		name: string;
		amountText: string | null;
		ingredients: Array<{
			name: string;
			amountText: string | null;
		}>;
	}>;
	occurred: MealOccurrenceInput;
};

export class MealNotFoundError extends Error {}
export class MealRevisionConflictError extends Error {}
export class MealMutationConflictError extends Error {}

const MEAL_SELECTION =
	'id,revision,meal_type,source_turn_id,source_operation_id,occurred_precision,occurred_at,occurred_on,timezone,time_period,created_at,updated_at,meal_items(id,position,name,amount_text,meal_item_ingredients(id,position,name,amount_text))';

export async function createMealFromChat(
	client: SupabaseClient,
	input: {
		userId: string;
		turnId: string;
		leaseExpiresAt: string;
		operationIndex: number;
		meal: RecordMealInput;
	}
): Promise<Meal> {
	const occurrence = occurrenceParameters(input.meal.occurred);
	const { data, error } = await client.rpc('create_meal_from_chat', {
		p_user_id: input.userId,
		p_source_turn_id: input.turnId,
		p_lease_expires_at: input.leaseExpiresAt,
		p_operation_index: input.operationIndex,
		p_meal_type: input.meal.mealType,
		...occurrence,
		p_items: input.meal.items
	});

	if (error) throw error;
	return data as Meal;
}

export async function updateOwnedMeal(
	client: SupabaseClient,
	userId: string,
	input: UpdateMealInput
): Promise<Meal> {
	const occurrence = occurrenceParameters(input.occurrence);
	const { data, error } = await client.rpc('update_meal', {
		p_user_id: userId,
		p_meal_id: input.id,
		p_expected_revision: input.expectedRevision,
		p_client_mutation_id: input.clientMutationId,
		p_meal_type: input.mealType,
		...occurrence,
		p_items: input.items
	});

	if (error?.code === 'P0002') throw new MealNotFoundError('Måltiden hittades inte.');
	if (error?.code === '40001') {
		throw new MealRevisionConflictError('Måltiden har ändrats sedan kortet laddades.');
	}
	if (error?.code === '23505') {
		throw new MealMutationConflictError('Mutations-ID:t har redan använts för en annan ändring.');
	}
	if (error) throw error;
	return data as Meal;
}

export async function listConversationJournalRecords(
	client: SupabaseClient,
	userId: string,
	turnIds: string[]
): Promise<TurnJournalRecord[]> {
	if (turnIds.length === 0) return [];

	const { data, error } = await client
		.from('meals')
		.select(MEAL_SELECTION)
		.eq('user_id', userId)
		.in('source_turn_id', turnIds)
		.order('source_operation_id', { ascending: true });

	if (error) throw error;

	return ((data ?? []) as unknown as MealRow[])
		.filter((row): row is MealRow & { source_turn_id: string } => Boolean(row.source_turn_id))
		.map((row) => {
			const meal = mapMeal(row);
			return {
				turnId: row.source_turn_id,
				record: {
					kind: 'meal',
					reference: { type: 'meal', recordId: meal.id, committedRevision: 1 },
					value: meal
				}
			};
		});
}

export function mapMeal(row: MealRow): Meal {
	return {
		id: row.id,
		revision: row.revision,
		mealType: row.meal_type,
		items: [...(row.meal_items ?? [])]
			.sort((left, right) => left.position - right.position)
			.map((item) => ({
				id: item.id,
				name: item.name,
				amountText: item.amount_text,
				ingredients: [...(item.meal_item_ingredients ?? [])]
					.sort((left, right) => left.position - right.position)
					.map((ingredient) => ({
						id: ingredient.id,
						name: ingredient.name,
						amountText: ingredient.amount_text
					}))
			})),
		occurrence: mapOccurrence(row),
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function mapOccurrence(row: MealRow): MealOccurrence {
	if (
		row.occurred_precision === 'exact' &&
		row.occurred_at &&
		row.occurred_on &&
		row.timezone &&
		row.time_period === null
	) {
		return {
			precision: 'exact',
			occurredAt: row.occurred_at,
			occurredOn: row.occurred_on,
			timezone: row.timezone,
			timePeriod: null
		};
	}
	if (
		row.occurred_precision === 'approximate' &&
		row.occurred_at &&
		row.occurred_on &&
		row.timezone &&
		row.time_period === null
	) {
		return {
			precision: 'approximate',
			occurredAt: row.occurred_at,
			occurredOn: row.occurred_on,
			timezone: row.timezone,
			timePeriod: null
		};
	}
	if (
		row.occurred_precision === 'approximate' &&
		row.occurred_at === null &&
		row.occurred_on &&
		row.timezone &&
		isMealTimePeriod(row.time_period)
	) {
		return {
			precision: 'approximate',
			occurredAt: null,
			occurredOn: row.occurred_on,
			timezone: row.timezone,
			timePeriod: row.time_period
		};
	}
	if (
		row.occurred_precision === 'date' &&
		row.occurred_on &&
		row.timezone &&
		row.time_period === null
	) {
		return {
			precision: 'date',
			occurredAt: null,
			occurredOn: row.occurred_on,
			timezone: row.timezone,
			timePeriod: null
		};
	}
	if (
		row.occurred_precision === 'unknown' &&
		row.occurred_at === null &&
		row.occurred_on === null &&
		row.timezone === null &&
		row.time_period === null
	) {
		return {
			precision: 'unknown',
			occurredAt: null,
			occurredOn: null,
			timezone: null,
			timePeriod: null
		};
	}
	throw new Error(`Måltiden ${row.id} har en inkonsekvent tidsuppgift.`);
}

function occurrenceParameters(occurrence: MealOccurrenceInput) {
	return {
		p_occurred_precision: occurrence.precision,
		p_occurred_at: occurrence.occurredAt,
		p_occurred_on: 'occurredOn' in occurrence ? occurrence.occurredOn : null,
		p_timezone: occurrence.timezone,
		p_time_period: occurrence.timePeriod
	};
}
