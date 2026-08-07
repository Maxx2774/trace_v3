import type {
	ConversationCursor,
	ConversationDetailPage,
	ConversationHistoryCursor,
	ConversationPage,
	ConversationSummary
} from '$lib/features/chat/contracts';
import {
	CONVERSATION_HISTORY_TURN_PAGE_SIZE,
	CONVERSATION_PAGE_SIZE,
	INITIAL_CONVERSATION_COUNT,
	INITIAL_CONVERSATION_TURN_COUNT
} from '$lib/features/chat/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';

type ConversationRow = {
	id: string;
	title: string;
	created_at: string;
	updated_at: string;
	last_message_at: string;
};

export class ConversationNotFoundError extends Error {}

export async function listOwnedConversations(
	client: SupabaseClient,
	userId: string,
	cursor: ConversationCursor | null = null
): Promise<ConversationPage> {
	const pageSize = cursor ? CONVERSATION_PAGE_SIZE : INITIAL_CONVERSATION_COUNT;
	const requestLimit = pageSize + 1;

	if (!cursor) {
		const { data, error } = await selectOwnedConversations(client, userId)
			.order('last_message_at', { ascending: false })
			.order('id', { ascending: false })
			.limit(requestLimit);

		if (error) throw error;
		return createConversationPage(
			((data ?? []) as ConversationRow[]).map(mapConversation),
			pageSize
		);
	}

	const [sameTimestampResult, olderResult] = await Promise.all([
		selectOwnedConversations(client, userId)
			.eq('last_message_at', cursor.lastMessageAt)
			.lt('id', cursor.id)
			.order('id', { ascending: false })
			.limit(requestLimit),
		selectOwnedConversations(client, userId)
			.lt('last_message_at', cursor.lastMessageAt)
			.order('last_message_at', { ascending: false })
			.order('id', { ascending: false })
			.limit(requestLimit)
	]);

	if (sameTimestampResult.error) throw sameTimestampResult.error;
	if (olderResult.error) throw olderResult.error;

	const rows = [
		...((sameTimestampResult.data ?? []) as ConversationRow[]),
		...((olderResult.data ?? []) as ConversationRow[])
	].sort(compareConversationRows);

	return createConversationPage(rows.map(mapConversation), pageSize);
}

function selectOwnedConversations(client: SupabaseClient, userId: string) {
	return client
		.from('conversations')
		.select('id,title,created_at,updated_at,last_message_at')
		.eq('user_id', userId);
}

function compareConversationRows(left: ConversationRow, right: ConversationRow): number {
	return (
		Date.parse(right.last_message_at) - Date.parse(left.last_message_at) ||
		right.id.localeCompare(left.id)
	);
}

export function createConversationPage(
	conversations: ConversationSummary[],
	pageSize = CONVERSATION_PAGE_SIZE
): ConversationPage {
	const hasMore = conversations.length > pageSize;
	const pageConversations = conversations.slice(0, pageSize);
	const lastConversation = pageConversations.at(-1);

	return {
		conversations: pageConversations,
		nextCursor:
			hasMore && lastConversation
				? { id: lastConversation.id, lastMessageAt: lastConversation.lastMessageAt }
				: null
	};
}

export async function getOwnedConversationPage(
	client: SupabaseClient,
	userId: string,
	conversationId: string,
	before: ConversationHistoryCursor | null
): Promise<ConversationDetailPage> {
	const turnLimit = before ? CONVERSATION_HISTORY_TURN_PAGE_SIZE : INITIAL_CONVERSATION_TURN_COUNT;
	const { data, error } = await client.rpc('get_conversation_page', {
		p_user_id: userId,
		p_conversation_id: conversationId,
		p_before_created_at: before?.createdAt ?? null,
		p_before_turn_id: before?.turnId ?? null,
		p_turn_limit: turnLimit
	});

	if (error) throw error;
	if (!data) throw new ConversationNotFoundError('Konversationen hittades inte.');
	return data as ConversationDetailPage;
}

export async function deleteOwnedConversation(
	client: SupabaseClient,
	userId: string,
	conversationId: string
): Promise<string> {
	const { data, error } = await client
		.from('conversations')
		.delete()
		.eq('id', conversationId)
		.eq('user_id', userId)
		.select('id')
		.maybeSingle();

	if (error) throw error;
	if (!data) throw new ConversationNotFoundError('Konversationen hittades inte.');
	return data.id as string;
}

export async function renameOwnedConversation(
	client: SupabaseClient,
	userId: string,
	conversationId: string,
	title: string
): Promise<ConversationSummary> {
	const { data, error } = await client
		.from('conversations')
		.update({ title, updated_at: new Date().toISOString() })
		.eq('id', conversationId)
		.eq('user_id', userId)
		.select('id,title,created_at,updated_at,last_message_at')
		.maybeSingle();

	if (error) throw error;
	if (!data) throw new ConversationNotFoundError('Konversationen hittades inte.');
	return mapConversation(data as ConversationRow);
}

export async function replaceProvisionalConversationTitle(
	client: SupabaseClient,
	userId: string,
	conversationId: string,
	provisionalTitle: string,
	generatedTitle: string
): Promise<ConversationSummary | null> {
	const { data, error } = await client
		.from('conversations')
		.update({ title: generatedTitle, updated_at: new Date().toISOString() })
		.eq('id', conversationId)
		.eq('user_id', userId)
		.eq('title', provisionalTitle)
		.select('id,title,created_at,updated_at,last_message_at')
		.maybeSingle();

	if (error) throw error;
	return data ? mapConversation(data as ConversationRow) : null;
}

export function mapConversation(row: ConversationRow): ConversationSummary {
	return {
		id: row.id,
		title: row.title,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		lastMessageAt: row.last_message_at
	};
}
