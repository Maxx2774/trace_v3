import {
	MEAL_TIME_PERIODS,
	MEAL_TYPES,
	type MealDuplicateInteractionV1
} from '$lib/features/meals/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as v from 'valibot';

const nullableAmountSchema = v.nullable(v.string());
const ingredientSchema = v.strictObject({
	name: v.string(),
	amountText: nullableAmountSchema
});
const itemSchema = v.strictObject({
	name: v.string(),
	amountText: nullableAmountSchema,
	ingredients: v.array(ingredientSchema)
});
const occurrenceSchema = v.union([
	v.strictObject({
		precision: v.literal('exact'),
		occurredAt: v.string(),
		occurredOn: v.string(),
		timezone: v.string(),
		timePeriod: v.null()
	}),
	v.strictObject({
		precision: v.literal('approximate'),
		occurredAt: v.string(),
		occurredOn: v.string(),
		timezone: v.string(),
		timePeriod: v.null()
	}),
	v.strictObject({
		precision: v.literal('approximate'),
		occurredAt: v.null(),
		occurredOn: v.string(),
		timezone: v.string(),
		timePeriod: v.picklist(MEAL_TIME_PERIODS)
	}),
	v.strictObject({
		precision: v.literal('date'),
		occurredAt: v.null(),
		occurredOn: v.string(),
		timezone: v.string(),
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
const mealSummarySchema = v.strictObject({
	mealType: v.nullable(v.picklist(MEAL_TYPES)),
	occurrence: occurrenceSchema,
	items: v.array(itemSchema)
});
const relationSchema = v.picklist(['match', 'unknown', 'different']);
const interactionSchema = v.strictObject({
	id: v.string(),
	kind: v.literal('meal_duplicate'),
	status: v.picklist(['prepared', 'pending', 'confirmed', 'discarded']),
	schemaVersion: v.literal(1),
	policyVersion: v.literal(1),
	proposalTurnId: v.string(),
	proposalOperationId: v.string(),
	proposalInputHash: v.string(),
	resolutionTurnId: v.nullable(v.string()),
	resolutionOperationId: v.nullable(v.string()),
	resolutionReason: v.nullable(
		v.picklist(['user_confirmed', 'user_declined', 'conversation_moved_on', 'corrected_proposal'])
	),
	payload: v.strictObject({
		proposedMeal: mealSummarySchema,
		existingMealSnapshot: mealSummarySchema,
		matchDetails: v.strictObject({
			policyVersion: v.literal(1),
			anchor: v.picklist(['time', 'identical_payload']),
			timeDifferenceMinutes: v.nullable(v.number()),
			candidateCount: v.pipe(v.number(), v.integer(), v.minValue(1)),
			differences: v.strictObject({
				mealType: relationSchema,
				amounts: relationSchema,
				ingredients: relationSchema
			})
		})
	}),
	createdAt: v.string(),
	activatedAt: v.nullable(v.string()),
	resolvedAt: v.nullable(v.string())
});

type InteractionRow = {
	id: string;
	kind: string;
	status: string;
	schema_version: number;
	policy_version: number | null;
	proposal_turn_id: string;
	proposal_operation_id: string;
	proposal_input_hash: string;
	resolution_turn_id: string | null;
	resolution_operation_id: string | null;
	resolution_reason: string | null;
	payload: unknown;
	created_at: string;
	activated_at: string | null;
	resolved_at: string | null;
};

const INTERACTION_SELECTION =
	'id,kind,status,schema_version,policy_version,proposal_turn_id,proposal_operation_id,proposal_input_hash,resolution_turn_id,resolution_operation_id,resolution_reason,payload,created_at,activated_at,resolved_at';

export type PendingInteractionBinding = {
	handle: string;
	kind: 'meal_duplicate';
	interactionId: string;
};

export function parseMealDuplicateInteraction(value: unknown): MealDuplicateInteractionV1 {
	return v.parse(interactionSchema, value) as MealDuplicateInteractionV1;
}

export async function listPendingMealDuplicateInteractions(
	client: SupabaseClient,
	userId: string,
	conversationId: string
): Promise<MealDuplicateInteractionV1[]> {
	const { data, error } = await client
		.from('pending_interactions')
		.select(INTERACTION_SELECTION)
		.eq('user_id', userId)
		.eq('conversation_id', conversationId)
		.eq('kind', 'meal_duplicate')
		.eq('status', 'pending')
		.order('created_at', { ascending: true })
		.order('id', { ascending: true });
	if (error) throw error;
	return ((data ?? []) as unknown as InteractionRow[]).map(mapInteractionRow);
}

export async function listTurnMealDuplicateInteractions(
	client: SupabaseClient,
	userId: string,
	turnId: string
): Promise<MealDuplicateInteractionV1[]> {
	const base = () =>
		client
			.from('pending_interactions')
			.select(INTERACTION_SELECTION)
			.eq('user_id', userId)
			.eq('kind', 'meal_duplicate');
	const [proposed, resolved] = await Promise.all([
		base().eq('proposal_turn_id', turnId),
		base().eq('resolution_turn_id', turnId)
	]);
	if (proposed.error) throw proposed.error;
	if (resolved.error) throw resolved.error;

	const rows = [
		...((proposed.data ?? []) as unknown as InteractionRow[]),
		...((resolved.data ?? []) as unknown as InteractionRow[])
	];
	const unique = new Map(rows.map((row) => [row.id, row]));
	return [...unique.values()]
		.sort((left, right) => operationIndex(left, turnId) - operationIndex(right, turnId))
		.map(mapInteractionRow);
}

export function projectPendingInteraction(interaction: MealDuplicateInteractionV1): string {
	return JSON.stringify({
		kind: interaction.kind,
		proposedMeal: interaction.payload.proposedMeal,
		existingMeal: interaction.payload.existingMealSnapshot,
		match: interaction.payload.matchDetails
	});
}

function mapInteractionRow(row: InteractionRow): MealDuplicateInteractionV1 {
	return parseMealDuplicateInteraction({
		id: row.id,
		kind: row.kind,
		status: row.status,
		schemaVersion: row.schema_version,
		policyVersion: row.policy_version,
		proposalTurnId: row.proposal_turn_id,
		proposalOperationId: row.proposal_operation_id,
		proposalInputHash: row.proposal_input_hash,
		resolutionTurnId: row.resolution_turn_id,
		resolutionOperationId: row.resolution_operation_id,
		resolutionReason: row.resolution_reason,
		payload: row.payload,
		createdAt: row.created_at,
		activatedAt: row.activated_at,
		resolvedAt: row.resolved_at
	});
}

function operationIndex(row: InteractionRow, turnId: string): number {
	const operationId =
		row.resolution_turn_id === turnId ? row.resolution_operation_id : row.proposal_operation_id;
	const value = Number(operationId?.split(':').at(-1));
	return Number.isInteger(value) ? value : Number.MAX_SAFE_INTEGER;
}
