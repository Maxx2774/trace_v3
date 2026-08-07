import type { JournalRecord } from '$lib/features/journal/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type OpenAI from 'openai';
import type { BaseIssue, BaseSchema } from 'valibot';
import { safeParse } from 'valibot';
import { foodLogRecordTool } from './food-log';

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
};

export type CanonicalToolResult = {
	output: Record<string, unknown>;
	record?: JournalRecord;
	continueModel?: boolean;
};

export type RegisteredTool = {
	key: string;
	definition: OpenAI.Responses.NamespaceTool.Function;
	schema: BaseSchema<unknown, unknown, BaseIssue<unknown>>;
	policy: ToolExecutionPolicy;
	execute: (context: ToolExecutionContext, args: never) => Promise<CanonicalToolResult>;
};

const tools = [foodLogRecordTool] satisfies RegisteredTool[];
const registry = new Map(tools.map((tool) => [tool.key, tool]));

export const TOOL_NAMESPACES: OpenAI.Responses.NamespaceTool[] = [
	{
		type: 'namespace',
		name: 'food_log',
		description: 'Registrera mat eller dryck som användaren själv faktiskt har konsumerat.',
		tools: tools.filter((tool) => tool.key.startsWith('food_log.')).map((tool) => tool.definition)
	}
];

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
	operationIndex: number
): ToolCallPreparation {
	const key = `${call.namespace ?? ''}.${call.name}`;
	const tool = registry.get(key);
	if (!tool) {
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
