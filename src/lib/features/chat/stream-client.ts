import type { ChatHttpError, ChatStreamEvent, ChatStreamRequest } from './contracts';
import { isMealTimePeriod, isMealType } from '$lib/features/meals/contracts';

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
	if (event.type === 'journal_record_created') return isJournalRecord(event.record);
	if (event.type === 'error') {
		return (
			typeof event.code === 'string' &&
			typeof event.message === 'string' &&
			typeof event.retryable === 'boolean'
		);
	}
	return false;
}

function isJournalRecord(value: unknown): boolean {
	if (
		!isObject(value) ||
		value.kind !== 'meal' ||
		!isObject(value.reference) ||
		value.reference.type !== 'meal' ||
		typeof value.reference.recordId !== 'string' ||
		typeof value.reference.committedRevision !== 'number' ||
		!isObject(value.value)
	) {
		return false;
	}
	return (
		typeof value.value.id === 'string' &&
		typeof value.value.revision === 'number' &&
		(value.value.mealType === null || isMealType(value.value.mealType)) &&
		Array.isArray(value.value.items) &&
		value.value.items.every(isMealItem) &&
		isMealOccurrence(value.value.occurrence) &&
		typeof value.value.createdAt === 'string' &&
		typeof value.value.updatedAt === 'string'
	);
}

function isMealOccurrence(value: unknown): boolean {
	if (!isObject(value) || typeof value.precision !== 'string') return false;
	if (value.precision === 'exact') {
		return (
			typeof value.occurredAt === 'string' &&
			typeof value.occurredOn === 'string' &&
			typeof value.timezone === 'string' &&
			value.timePeriod === null
		);
	}
	if (value.precision === 'approximate') {
		return (
			typeof value.occurredOn === 'string' &&
			typeof value.timezone === 'string' &&
			((typeof value.occurredAt === 'string' && value.timePeriod === null) ||
				(value.occurredAt === null && isMealTimePeriod(value.timePeriod)))
		);
	}
	if (value.precision === 'date') {
		return (
			value.occurredAt === null &&
			typeof value.occurredOn === 'string' &&
			typeof value.timezone === 'string' &&
			value.timePeriod === null
		);
	}
	return (
		value.precision === 'unknown' &&
		value.occurredAt === null &&
		value.occurredOn === null &&
		value.timezone === null &&
		value.timePeriod === null
	);
}

function isMealItem(value: unknown): boolean {
	return (
		isObject(value) &&
		typeof value.id === 'string' &&
		typeof value.name === 'string' &&
		(value.amountText === null || typeof value.amountText === 'string') &&
		Array.isArray(value.ingredients) &&
		value.ingredients.every(
			(ingredient) =>
				isObject(ingredient) &&
				typeof ingredient.id === 'string' &&
				typeof ingredient.name === 'string' &&
				(ingredient.amountText === null || typeof ingredient.amountText === 'string')
		)
	);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object');
}
