import type { ChatHttpError, ChatStreamEvent, ChatStreamRequest } from './contracts';

export class ChatRequestError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly status: number
	) {
		super(message);
	}
}

export async function streamChat(input: {
	request: ChatStreamRequest;
	signal: AbortSignal;
	onEvent: (event: ChatStreamEvent) => void;
}): Promise<void> {
	const response = await fetch('/api/chat/stream', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input.request),
		signal: input.signal
	});

	if (!response.ok) {
		const body = await readHttpError(response);
		throw new ChatRequestError(body.message, body.code, response.status);
	}

	if (!response.body) {
		throw new ChatRequestError('Svaret saknade en läsbar stream.', 'missing_stream', 502);
	}

	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = '';

	while (true) {
		const { value, done } = await reader.read();
		if (done) break;

		buffer += value;
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';

		for (const line of lines) emitLine(line, input.onEvent);
	}

	if (buffer.trim()) emitLine(buffer, input.onEvent);
}

function emitLine(line: string, onEvent: (event: ChatStreamEvent) => void): void {
	if (!line.trim()) return;
	const event = JSON.parse(line) as unknown;
	if (!isChatStreamEvent(event)) throw new Error('Chatstreamen innehöll ett ogiltigt event.');
	onEvent(event);
}

async function readHttpError(response: Response): Promise<ChatHttpError> {
	try {
		const body = (await response.json()) as Partial<ChatHttpError>;
		return {
			code: typeof body.code === 'string' ? body.code : 'request_failed',
			message: typeof body.message === 'string' ? body.message : 'Requesten misslyckades.'
		};
	} catch {
		return { code: 'request_failed', message: 'Requesten misslyckades.' };
	}
}

function isChatStreamEvent(value: unknown): value is ChatStreamEvent {
	if (!value || typeof value !== 'object') return false;
	const event = value as Record<string, unknown>;
	if (typeof event.type !== 'string' || typeof event.turnId !== 'string') return false;

	if (event.type === 'delta' || event.type === 'replace') return typeof event.text === 'string';
	if (event.type === 'conversation') return isObject(event.conversation) && isObject(event.message);
	if (event.type === 'done') return isObject(event.conversation) && isObject(event.message);
	if (event.type === 'error') {
		return typeof event.code === 'string' && typeof event.message === 'string';
	}
	return false;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object');
}
