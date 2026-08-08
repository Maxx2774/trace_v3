import type { JournalRecord } from '$lib/features/journal/contracts';
import type { PendingInteractionBinding } from '$lib/server/chat/interactions';
import type { SupabaseClient } from '@supabase/supabase-js';
import type OpenAI from 'openai';
import type { BaseIssue, BaseSchema } from 'valibot';
import type { ResponseRequirement } from '../response-requirements';

export type ToolExecutionContext = {
	client: SupabaseClient;
	userId: string;
	turnId: string;
	turnLeaseExpiresAt: string;
	toolCallIndex: number;
	timezone: string;
	pendingInteractionBindings: PendingInteractionBinding[];
};

export type VerifiedResponsePart =
	{ kind: 'text'; text: string } | { kind: 'journal_record'; record: JournalRecord };

export type ToolExecutionOrchestration = {
	requiresAgentContinuation: boolean;
	verifiedResponseParts: VerifiedResponsePart[];
	responseRequirements: ResponseRequirement[];
};

export type ToolExecutionResult = {
	modelOutput: Record<string, unknown>;
	orchestration: ToolExecutionOrchestration;
};

export type RegisteredTool = {
	key: string;
	exposure: 'namespace' | 'direct';
	definition: OpenAI.Responses.NamespaceTool.Function;
	schema: BaseSchema<unknown, unknown, BaseIssue<unknown>>;
	operation: 'query' | 'command';
	concurrency: 'parallel' | 'serial';
	execute: (context: ToolExecutionContext, args: never) => Promise<ToolExecutionResult>;
};
