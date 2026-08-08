import type { ChatMessage, ConversationSummary } from '$lib/features/chat/contracts';
import type { TurnJournalRecord } from '$lib/features/journal/contracts';
import type { MealDuplicateInteractionV1 } from '$lib/features/meals/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listTurnMealDuplicateInteractions } from './interactions';

export type BeginChatTurnResult =
	| {
			status: 'created';
			conversation: ConversationSummary;
			message: ChatMessage;
			turnLeaseExpiresAt: string;
			journalRecords: TurnJournalRecord[];
			interactions: MealDuplicateInteractionV1[];
	  }
	| {
			status: 'resumed';
			conversation: ConversationSummary;
			message: ChatMessage;
			turnLeaseExpiresAt: string;
			journalRecords: TurnJournalRecord[];
			interactions: MealDuplicateInteractionV1[];
	  }
	| {
			status: 'completed';
			conversation: ConversationSummary;
			message: ChatMessage;
			assistantMessage: ChatMessage;
			journalRecords: TurnJournalRecord[];
	  }
	| { status: 'pending' }
	| { status: 'conflict' }
	| { status: 'not_found' }
	| { status: 'failed_terminal'; code: 'turn_failed_terminal' };

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
		leaseDurationSeconds?: number;
	}
): Promise<BeginChatTurnResult> {
	const { data, error } = await client.rpc('begin_chat_turn', {
		p_user_id: input.userId,
		p_conversation_id: input.conversationId,
		p_turn_id: input.turnId,
		p_content: input.content,
		p_lease_duration_seconds: input.leaseDurationSeconds ?? 120
	});

	if (error) throw error;
	const result = data as BeginChatTurnResult;
	if (result.status === 'created') return { ...result, interactions: [] };
	if (result.status === 'resumed') {
		const interactions = await listTurnMealDuplicateInteractions(
			client,
			input.userId,
			input.turnId
		);
		return { ...result, interactions };
	}
	return result;
}

export async function completeChatTurn(
	client: SupabaseClient,
	input: { userId: string; turnId: string; turnLeaseExpiresAt: string; content: string }
): Promise<CommitChatTurnResult> {
	const { data, error } = await client.rpc('complete_chat_turn', {
		p_user_id: input.userId,
		p_turn_id: input.turnId,
		p_turn_lease_expires_at: input.turnLeaseExpiresAt,
		p_content: input.content
	});

	if (error) throw error;
	return data as CommitChatTurnResult;
}

export async function failChatTurn(
	client: SupabaseClient,
	input: { userId: string; turnId: string; turnLeaseExpiresAt: string; retryable: boolean }
): Promise<void> {
	const { error } = await client.rpc('fail_chat_turn', {
		p_user_id: input.userId,
		p_turn_id: input.turnId,
		p_turn_lease_expires_at: input.turnLeaseExpiresAt,
		p_retryable: input.retryable
	});

	if (error) throw error;
}
