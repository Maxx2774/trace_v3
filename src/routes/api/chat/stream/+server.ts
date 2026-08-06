import {
	CHAT_CONTEXT_MAX_CHARACTERS,
	CHAT_HISTORY_MAX_TURNS,
	CHAT_MESSAGE_MAX_LENGTH,
	type ChatHttpError,
	type ChatStreamRequest
} from '$lib/features/chat/contracts';
import { CHAT_SYSTEM_PROMPT } from '$lib/server/chat/model';
import { createChatResponseStream } from '$lib/server/chat/stream';
import { beginChatTurn } from '$lib/server/chat/turns';
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

	const dbStartedAt = performance.now();
	let beginResult;
	try {
		beginResult = await beginChatTurn(adminClient, {
			userId,
			conversationId: parsed.input.conversationId,
			turnId: parsed.input.turnId,
			content: parsed.input.message,
			systemPrompt: CHAT_SYSTEM_PROMPT,
			maxTurns: CHAT_HISTORY_MAX_TURNS,
			characterBudget: CHAT_CONTEXT_MAX_CHARACTERS
		});
	} catch {
		return apiError(500, 'persistence_error', 'Meddelandet kunde inte sparas.');
	}
	const dbBeginMs = performance.now() - dbStartedAt;

	if (beginResult.status === 'not_found') {
		return apiError(404, 'not_found', 'Konversationen hittades inte.');
	}
	if (beginResult.status === 'conflict') {
		return apiError(409, 'turn_conflict', 'Meddelandet kan inte återanvändas för denna tur.');
	}
	if (beginResult.status === 'pending') {
		return apiError(409, 'turn_pending', 'Ett svar för meddelandet pågår redan.');
	}

	return new Response(
		createChatResponseStream({
			adminClient,
			beginResult,
			userId,
			turnId: parsed.input.turnId,
			requestSignal: request.signal,
			requestId,
			dbBeginMs,
			isNewConversation: parsed.input.conversationId === null
		}),
		{
			headers: {
				'content-type': 'application/x-ndjson; charset=utf-8',
				'cache-control': 'no-store',
				'x-content-type-options': 'nosniff',
				'x-request-id': requestId
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
	const conversationId = candidate.conversationId;

	if (!message || message.length > CHAT_MESSAGE_MAX_LENGTH || !UUID_PATTERN.test(turnId)) {
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
			message
		}
	};
}

function apiError(status: number, code: string, message: string): Response {
	return json({ code, message } satisfies ChatHttpError, {
		status,
		headers: { 'cache-control': 'no-store' }
	});
}
