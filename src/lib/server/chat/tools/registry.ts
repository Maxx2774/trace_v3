import type OpenAI from 'openai';
import { safeParse } from 'valibot';
import type { RegisteredTool } from './contracts';
import { foodLogRecordTool } from './food-log-record';
import { processInteractionResponseTool } from './process-interaction-response';

const registeredTools = [
	foodLogRecordTool,
	processInteractionResponseTool
] satisfies RegisteredTool[];
const toolByKey = new Map(registeredTools.map((tool) => [tool.key, tool]));

export type ToolCatalog = {
	namespaces: OpenAI.Responses.NamespaceTool[];
	directTools: OpenAI.Responses.FunctionTool[];
	toolKeyByCallIdentity: ReadonlyMap<string, string>;
};

export function createToolCatalog(input: { hasPendingInteraction: boolean }): ToolCatalog {
	const availableTools = registeredTools.filter(
		(tool) => tool.key !== 'process_interaction_response' || input.hasPendingInteraction
	);
	const directTools = availableTools.filter((tool) => tool.exposure === 'direct');
	const foodLogNamespaceTools = availableTools.filter(
		(tool) => tool.exposure === 'namespace' && tool.key.startsWith('food_log.')
	);
	return {
		namespaces: [
			{
				type: 'namespace',
				name: 'food_log',
				description:
					'Registrera mat eller dryck. Varje rapport om faktisk konsumtion måste gå genom record, även om den ser ut som en dubblett i samtalshistoriken. Endast confirmation_required från verktyget får utlösa en duplicatfråga; dra aldrig den slutsatsen själv.',
				tools: foodLogNamespaceTools.map((tool) => tool.definition)
			}
		],
		directTools: directTools.map((tool) => {
			const definition: OpenAI.Responses.FunctionTool = { ...tool.definition };
			delete definition.defer_loading;
			return definition;
		}),
		toolKeyByCallIdentity: new Map([
			...foodLogNamespaceTools.map(
				(tool) => [`food_log.${tool.definition.name}`, tool.key] as const
			),
			...directTools.map((tool) => [`.${tool.definition.name}`, tool.key] as const)
		])
	};
}

export type PreparedToolCall = {
	callId: string;
	key: string;
	name: string;
	namespace?: string;
	tool: RegisteredTool;
	args: unknown;
	toolCallIndex: number;
};

export type ToolCallPreparation =
	| { ok: true; call: PreparedToolCall }
	| {
			ok: false;
			callId: string;
			key: string;
			name: string;
			namespace?: string;
			correctable: boolean;
			modelOutput: Record<string, unknown>;
	  };

export function prepareToolCall(
	call: OpenAI.Responses.ResponseFunctionToolCall,
	toolCallIndex: number,
	catalog: Pick<ToolCatalog, 'toolKeyByCallIdentity'>
): ToolCallPreparation {
	const callIdentity = call.namespace ? `${call.namespace}.${call.name}` : `.${call.name}`;
	const key = catalog.toolKeyByCallIdentity.get(callIdentity);
	const tool = key ? toolByKey.get(key) : undefined;
	if (!key || !tool) {
		return {
			ok: false,
			callId: call.call_id,
			key: callIdentity,
			name: call.name,
			...(call.namespace ? { namespace: call.namespace } : {}),
			correctable: false,
			modelOutput: { status: 'error', code: 'unknown_tool' }
		};
	}

	let candidateArguments: unknown;
	try {
		candidateArguments = JSON.parse(call.arguments);
	} catch {
		return invalidArguments(call, key);
	}

	const parsed = safeParse(tool.schema, candidateArguments);
	if (!parsed.success) return invalidArguments(call, key);

	return {
		ok: true,
		call: {
			callId: call.call_id,
			key,
			name: call.name,
			...(call.namespace ? { namespace: call.namespace } : {}),
			tool,
			args: parsed.output,
			toolCallIndex
		}
	};
}

function invalidArguments(
	call: OpenAI.Responses.ResponseFunctionToolCall,
	key: string
): ToolCallPreparation {
	return {
		ok: false,
		callId: call.call_id,
		key,
		name: call.name,
		...(call.namespace ? { namespace: call.namespace } : {}),
		correctable: true,
		modelOutput: { status: 'error', code: 'invalid_arguments' }
	};
}
