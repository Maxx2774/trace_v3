import {
	CHAT_MESSAGE_MAX_LENGTH,
	type ChatHttpError,
	type ChatStreamRequest
} from '$lib/features/chat/contracts';
import { isValidTimezone } from '$lib/date-time';
import {
	ModelContextConversationNotFoundError,
	prepareModelContext
} from '$lib/server/chat/history';
import { CHAT_SYSTEM_PROMPT } from '$lib/server/chat/model';
import { createChatResponseStream } from '$lib/server/chat/stream';
import { beginChatTurn } from '$lib/server/chat/turns';
import { createToolCatalog } from '$lib/server/chat/tools/registry';
import { getAdminSupabaseClient } from '$lib/server/supabase/admin';
import { json, type RequestHandler } from '@sveltejs/kit';
import { performance } from 'node:perf_hooks';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const POST: RequestHandler = async ({ request, locals }) => {
	const requestId = crypto.randomUUID();
	const userId = locals.claims?.sub;
	if (!userId) return apiError(401, 'unauthorized', 'Du måste vara inloggad.');

	const parsed = await parseRequest(request);
	if ('response' in parsed) return parsed.response;

	let adminClient;
	try {
		adminClient = getAdminSupabaseClient();
	} catch {
		return apiError(503, 'not_configured', 'Chatten är inte konfigurerad ännu.');
	}

	const contextStartedAt = performance.now();
	let modelContext;
	try {
		modelContext = await prepareModelContext(adminClient, {
			userId,
			conversationId: parsed.input.conversationId,
			turnId: parsed.input.turnId,
			message: parsed.input.message,
			systemPrompt: CHAT_SYSTEM_PROMPT,
			timezone: parsed.input.timezone,
			now: new Date()
		});
	} catch (cause) {
		if (cause instanceof ModelContextConversationNotFoundError) {
			return apiError(404, 'not_found', cause.message);
		}
		return apiError(500, 'persistence_error', 'Meddelandet kunde inte sparas.');
	}
	const contextMs = performance.now() - contextStartedAt;
	const toolCatalog = createToolCatalog({
		hasPendingMealInteraction: modelContext.interactionBindings.length > 0
	});
	const beginPromise = beginChatTurn(adminClient, {
		userId,
		conversationId: parsed.input.conversationId,
		turnId: parsed.input.turnId,
		content: parsed.input.message
	});

	return new Response(
		createChatResponseStream({
			adminClient,
			beginPromise,
			modelInput: modelContext.messages,
			toolCatalog,
			interactionBindings: modelContext.interactionBindings,
			userId,
			turnId: parsed.input.turnId,
			timezone: parsed.input.timezone,
			requestSignal: request.signal,
			requestId,
			isNewConversation: parsed.input.conversationId === null,
			userMessage: parsed.input.message
		}),
		{
			headers: {
				'content-type': 'application/x-ndjson; charset=utf-8',
				'cache-control': 'no-store',
				'x-content-type-options': 'nosniff',
				'x-request-id': requestId,
				'server-timing': `context;dur=${contextMs.toFixed(1)}`
			}
		}
	);
};

async function parseRequest(
	request: Request
): Promise<{ input: ChatStreamRequest } | { response: Response }> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return { response: apiError(400, 'invalid_json', 'Requesten är inte giltig JSON.') };
	}

	if (!body || typeof body !== 'object') {
		return { response: apiError(400, 'invalid_input', 'Meddelandet är ogiltigt.') };
	}

	const candidate = body as Record<string, unknown>;
	const message = typeof candidate.message === 'string' ? candidate.message.trim() : '';
	const turnId = typeof candidate.turnId === 'string' ? candidate.turnId : '';
	const timezone = typeof candidate.timezone === 'string' ? candidate.timezone : '';
	const conversationId = candidate.conversationId;

	if (
		!message ||
		message.length > CHAT_MESSAGE_MAX_LENGTH ||
		!UUID_PATTERN.test(turnId) ||
		!timezone ||
		timezone.length > 255 ||
		!isValidTimezone(timezone)
	) {
		return { response: apiError(400, 'invalid_input', 'Meddelandet är ogiltigt.') };
	}

	if (conversationId !== null && typeof conversationId !== 'undefined') {
		if (typeof conversationId !== 'string' || !UUID_PATTERN.test(conversationId)) {
			return { response: apiError(400, 'invalid_input', 'Konversations-id är ogiltigt.') };
		}
	}

	return {
		input: {
			conversationId: typeof conversationId === 'string' ? conversationId : null,
			turnId,
			message,
			timezone
		}
	};
}

function apiError(status: number, code: string, message: string): Response {
	return json({ code, message } satisfies ChatHttpError, {
		status,
		headers: { 'cache-control': 'no-store' }
	});
}
