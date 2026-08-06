import type { ChatMessage, ConversationSummary } from '$lib/features/chat/contracts';
import type { ModelHistoryMessage } from './history';
import type { SupabaseClient } from '@supabase/supabase-js';

export type BeginChatTurnResult =
	| {
			status: 'created';
			conversation: ConversationSummary;
			message: ChatMessage;
			history: ModelHistoryMessage[];
	  }
	| {
			status: 'completed';
			conversation: ConversationSummary;
			message: ChatMessage;
			assistantMessage: ChatMessage;
	  }
	| { status: 'pending' }
	| { status: 'conflict' }
	| { status: 'not_found' };

export type CommitChatTurnResult = {
	message: ChatMessage;
	conversation: ConversationSummary;
};

export async function beginChatTurn(
	client: SupabaseClient,
	input: {
		userId: string;
		conversationId: string | null;
		turnId: string;
		content: string;
		systemPrompt: string;
		maxTurns: number;
		characterBudget: number;
	}
): Promise<BeginChatTurnResult> {
	const { data, error } = await client.rpc('begin_chat_turn', {
		p_user_id: input.userId,
		p_conversation_id: input.conversationId,
		p_turn_id: input.turnId,
		p_content: input.content,
		p_system_prompt: input.systemPrompt,
		p_max_turns: input.maxTurns,
		p_character_budget: input.characterBudget
	});

	if (error) throw error;
	return data as BeginChatTurnResult;
}

export async function commitChatTurn(
	client: SupabaseClient,
	input: { userId: string; conversationId: string; turnId: string; content: string }
): Promise<CommitChatTurnResult> {
	const { data, error } = await client.rpc('commit_chat_turn', {
		p_user_id: input.userId,
		p_conversation_id: input.conversationId,
		p_turn_id: input.turnId,
		p_content: input.content
	});

	if (error) throw error;
	return data as CommitChatTurnResult;
}
