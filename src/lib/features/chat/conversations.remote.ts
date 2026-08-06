import { getRequestEvent, command, query } from '$app/server';
import { requireAuthenticatedUserId } from '$lib/server/auth';
import {
	ConversationNotFoundError,
	deleteOwnedConversation,
	getOwnedConversation,
	listOwnedConversations,
	renameOwnedConversation
} from '$lib/server/chat/conversations';
import { getAdminSupabaseClient } from '$lib/server/supabase/admin';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';

const uuidSchema = v.pipe(v.string(), v.uuid());
const renameConversationSchema = v.object({
	id: uuidSchema,
	title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(160))
});
const conversationCursorSchema = v.nullable(
	v.object({
		id: uuidSchema,
		lastMessageAt: v.pipe(v.string(), v.isoTimestamp())
	})
);

export const listConversations = query(conversationCursorSchema, async (cursor) => {
	const event = getRequestEvent();
	const userId = requireAuthenticatedUserId(event);
	return listOwnedConversations(event.locals.supabase, userId, cursor);
});

export const getConversation = query(uuidSchema, async (conversationId) => {
	const event = getRequestEvent();
	const userId = requireAuthenticatedUserId(event);

	try {
		return await getOwnedConversation(event.locals.supabase, userId, conversationId);
	} catch (cause) {
		if (cause instanceof ConversationNotFoundError) error(404, cause.message);
		throw cause;
	}
});

export const deleteConversation = command(uuidSchema, async (conversationId) => {
	const event = getRequestEvent();
	const userId = requireAuthenticatedUserId(event);

	try {
		const id = await deleteOwnedConversation(getAdminSupabaseClient(), userId, conversationId);
		return { id };
	} catch (cause) {
		if (cause instanceof ConversationNotFoundError) error(404, cause.message);
		throw cause;
	}
});

export const renameConversation = command(renameConversationSchema, async ({ id, title }) => {
	const event = getRequestEvent();
	const userId = requireAuthenticatedUserId(event);

	try {
		return await renameOwnedConversation(getAdminSupabaseClient(), userId, id, title);
	} catch (cause) {
		if (cause instanceof ConversationNotFoundError) error(404, cause.message);
		throw cause;
	}
});
