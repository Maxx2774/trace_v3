import type { JournalRecord } from '$lib/features/journal/contracts';
import type { MealDuplicateMatchDetails, MealSummary } from '$lib/features/meals/contracts';
import type { PendingInteractionBinding } from '$lib/server/chat/interactions';
import type { SupabaseClient } from '@supabase/supabase-js';
import type OpenAI from 'openai';
import type { BaseIssue, BaseSchema } from 'valibot';
import { safeParse } from 'valibot';
import { foodLogRecordTool } from './food-log';
import { foodLogResolveRegistrationTool } from './food-log-confirmation';

export type ToolExecutionPolicy = {
	effect: 'read' | 'write';
	parallelSafe: boolean;
};

export type ToolExecutionContext = {
	client: SupabaseClient;
	userId: string;
	turnId: string;
	leaseExpiresAt: string;
	operationIndex: number;
	timezone: string;
	interactionBindings: PendingInteractionBinding[];
};

export type CanonicalResponsePart =
	{ kind: 'text'; text: string } | { kind: 'journal_record'; record: JournalRecord };

export type MealDuplicateConfirmationObligationV1 = {
	ref: string;
	kind: 'ask_meal_duplicate_confirmation';
	schemaVersion: 1;
	confirmationRef: string;
	proposedMeal: MealSummary;
	existingMeal: MealSummary;
	match: MealDuplicateMatchDetails;
};

export type InteractionDiscardAcknowledgementV1 = {
	ref: string;
	kind: 'acknowledge_interaction_discard';
	schemaVersion: 1;
	confirmationRef: string;
	reason: 'user_declined' | 'conversation_moved_on' | 'corrected_proposal';
};

export type ResponseObligation =
	MealDuplicateConfirmationObligationV1 | InteractionDiscardAcknowledgementV1;

export type ToolOutcomeEffects = {
	requiresAgentContinuation: boolean;
	canonicalParts: CanonicalResponsePart[];
	responseObligations: ResponseObligation[];
};

export type CanonicalToolResult = {
	output: Record<string, unknown>;
	effects: ToolOutcomeEffects;
};

export type RegisteredTool = {
	key: string;
	definition: OpenAI.Responses.NamespaceTool.Function;
	schema: BaseSchema<unknown, unknown, BaseIssue<unknown>>;
	policy: ToolExecutionPolicy;
	execute: (context: ToolExecutionContext, args: never) => Promise<CanonicalToolResult>;
};

const tools = [foodLogRecordTool, foodLogResolveRegistrationTool] satisfies RegisteredTool[];
const registry = new Map(tools.map((tool) => [tool.key, tool]));

export type ToolCatalog = {
	namespaces: OpenAI.Responses.NamespaceTool[];
	directTools: OpenAI.Responses.FunctionTool[];
	directToolKeyByName: ReadonlyMap<string, string>;
	allowedKeys: ReadonlySet<string>;
};

export function createToolCatalog(input: { hasPendingMealInteraction: boolean }): ToolCatalog {
	const available = tools.filter(
		(tool) => tool.key !== 'food_log.resolve_registration' || input.hasPendingMealInteraction
	);
	const direct = available.filter((tool) => tool.key === 'food_log.resolve_registration');
	return {
		namespaces: [
			{
				type: 'namespace',
				name: 'food_log',
				description:
					'Registrera mat eller dryck och hantera verifierade väntande måltidsbeslut. Varje rapport om faktisk konsumtion måste gå genom record, även om den ser ut som en dubblett i samtalshistoriken. Endast confirmation_required från verktyget får utlösa en duplicatfråga; dra aldrig den slutsatsen själv.',
				tools: available
					.filter((tool) => !direct.includes(tool))
					.filter((tool) => tool.key.startsWith('food_log.'))
					.map((tool) => tool.definition)
			}
		],
		directTools: direct.map((tool) => {
			const definition: OpenAI.Responses.FunctionTool = { ...tool.definition };
			delete definition.defer_loading;
			return definition;
		}),
		directToolKeyByName: new Map(direct.map((tool) => [tool.definition.name, tool.key])),
		allowedKeys: new Set(available.map((tool) => tool.key))
	};
}

export type PreparedToolCall = {
	callId: string;
	key: string;
	tool: RegisteredTool;
	args: unknown;
	operationIndex: number;
};

export type ToolCallPreparation =
	| { ok: true; call: PreparedToolCall }
	| {
			ok: false;
			callId: string;
			key: string;
			correctable: boolean;
			output: Record<string, unknown>;
	  };

export function prepareToolCall(
	call: OpenAI.Responses.ResponseFunctionToolCall,
	operationIndex: number,
	catalog: Pick<ToolCatalog, 'allowedKeys' | 'directToolKeyByName'> = {
		allowedKeys: new Set(registry.keys()),
		directToolKeyByName: new Map()
	}
): ToolCallPreparation {
	const key = call.namespace
		? `${call.namespace}.${call.name}`
		: (catalog.directToolKeyByName.get(call.name) ?? `.${call.name}`);
	const tool = registry.get(key);
	if (!tool || !catalog.allowedKeys.has(key)) {
		return {
			ok: false,
			callId: call.call_id,
			key,
			correctable: false,
			output: { status: 'error', code: 'unknown_tool' }
		};
	}

	let candidate: unknown;
	try {
		candidate = JSON.parse(call.arguments);
	} catch {
		return invalidArguments(call.call_id, key);
	}

	const parsed = safeParse(tool.schema, candidate);
	if (!parsed.success) return invalidArguments(call.call_id, key);

	return {
		ok: true,
		call: { callId: call.call_id, key, tool, args: parsed.output, operationIndex }
	};
}

function invalidArguments(callId: string, key: string): ToolCallPreparation {
	return {
		ok: false,
		callId,
		key,
		correctable: true,
		output: { status: 'error', code: 'invalid_arguments' }
	};
}
