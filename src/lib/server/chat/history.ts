import {
	CHAT_CONTEXT_MAX_CHARACTERS,
	CHAT_CONTEXT_MAX_ESTIMATED_TOKENS,
	CHAT_HISTORY_MAX_MESSAGES,
	CHAT_HISTORY_MAX_TURNS
} from '$lib/features/chat/contracts';
import { getLocalDateTime } from '$lib/date-time';
import type { TurnJournalRecord } from '$lib/features/journal/contracts';
import type { MealDuplicateInteractionV1 } from '$lib/features/meals/contracts';
import { listConversationJournalRecords } from '$lib/server/meals/meals';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	listPendingMealDuplicateInteractions,
	projectPendingInteraction,
	type PendingInteractionBinding
} from './interactions';

export type ModelHistoryMessage = {
	turnId: string;
	role: 'user' | 'assistant';
	content: string;
	createdAt: string;
};

export type ModelContext = {
	messages: Array<{ role: 'user' | 'assistant' | 'developer'; content: string }>;
	referenceBindings: Array<{ handle: string; kind: 'meal'; recordId: string }>;
	interactionBindings: PendingInteractionBinding[];
};

export class ModelContextConversationNotFoundError extends Error {}

export async function prepareModelContext(
	client: SupabaseClient,
	input: {
		userId: string;
		conversationId: string | null;
		turnId: string;
		message: string;
		systemPrompt: string;
		timezone: string;
		now: Date;
	}
): Promise<ModelContext> {
	let history: ModelHistoryMessage[] = [];
	let records: TurnJournalRecord[] = [];
	let pendingInteractions: MealDuplicateInteractionV1[] = [];

	if (input.conversationId) {
		const { data: conversation, error: conversationError } = await client
			.from('conversations')
			.select('id')
			.eq('id', input.conversationId)
			.eq('user_id', input.userId)
			.maybeSingle();

		if (conversationError) throw conversationError;
		if (!conversation) {
			throw new ModelContextConversationNotFoundError('Konversationen hittades inte.');
		}

		const [messagesResult, interactions] = await Promise.all([
			client
				.from('messages')
				.select('turn_id,role,content,created_at')
				.eq('conversation_id', input.conversationId)
				.eq('user_id', input.userId)
				.neq('turn_id', input.turnId)
				.order('created_at', { ascending: false })
				.order('id', { ascending: false })
				.limit(200),
			listPendingMealDuplicateInteractions(client, input.userId, input.conversationId)
		]);
		const { data: messages, error: messagesError } = messagesResult;

		if (messagesError) throw messagesError;
		history = (
			(messages ?? []) as Array<{
				turn_id: string;
				role: 'user' | 'assistant';
				content: string;
				created_at: string;
			}>
		).map((message) => ({
			turnId: message.turn_id,
			role: message.role,
			content: message.content,
			createdAt: message.created_at
		}));
		pendingInteractions = interactions;

		records = await listConversationJournalRecords(client, input.userId, [
			...new Set(history.map((message) => message.turnId))
		]);
	}

	return buildModelContext({
		history,
		journalRecords: records,
		pendingInteractions,
		current: { turnId: input.turnId, content: input.message },
		systemPrompt: input.systemPrompt,
		timezone: input.timezone,
		now: input.now
	});
}

export function buildModelContext(input: {
	history: ModelHistoryMessage[];
	journalRecords: TurnJournalRecord[];
	pendingInteractions?: MealDuplicateInteractionV1[];
	current: { turnId: string; content: string };
	systemPrompt: string;
	timezone: string;
	now: Date;
}): ModelContext {
	const localNow = getLocalDateTime(input.now, input.timezone);
	const dynamicContext = `Aktuellt lokalt datum: ${localNow.date}\nAktuell lokal tid: ${localNow.time}\nVerifierad tidszon: ${input.timezone}`;
	const turns = groupCompleteTurns(input.history);
	const pending = selectPendingInteractions(
		input.pendingInteractions ?? [],
		input.systemPrompt.length + dynamicContext.length + input.current.content.length
	);
	const interactionBindings: PendingInteractionBinding[] = pending.map((interaction, index) => ({
		handle: `pending_meal_${index + 1}`,
		kind: 'meal_duplicate',
		interactionId: interaction.id
	}));
	const interactionProjection = pending.map(
		(interaction, index) =>
			`${interactionBindings[index].handle}: ${projectPendingInteraction(interaction)}`
	);
	const recordCharactersByTurn = new Map<string, number>();
	for (const entry of input.journalRecords) {
		recordCharactersByTurn.set(
			entry.turnId,
			(recordCharactersByTurn.get(entry.turnId) ?? 0) + projectRecord(entry).length
		);
	}
	const selected: ModelHistoryMessage[][] = [];
	let messageCount = 1;
	let characterCount =
		input.systemPrompt.length +
		dynamicContext.length +
		input.current.content.length +
		interactionProjection.reduce((total, item) => total + item.length, 0);

	for (const turn of turns.toReversed()) {
		const turnCharacters =
			turn.reduce((total, message) => total + message.content.length, 0) +
			(recordCharactersByTurn.get(turn[0].turnId) ?? 0);
		const nextCharacters = characterCount + turnCharacters;
		if (
			selected.length + 1 > CHAT_HISTORY_MAX_TURNS - 1 ||
			messageCount + turn.length > CHAT_HISTORY_MAX_MESSAGES ||
			nextCharacters > CHAT_CONTEXT_MAX_CHARACTERS ||
			Math.ceil(nextCharacters / 4) > CHAT_CONTEXT_MAX_ESTIMATED_TOKENS
		) {
			break;
		}

		selected.push(turn);
		messageCount += turn.length;
		characterCount = nextCharacters;
	}

	const selectedChronological = selected.toReversed().flat();
	const selectedTurnIds = new Set(selectedChronological.map((message) => message.turnId));
	const relevantRecords = input.journalRecords.filter((entry) => selectedTurnIds.has(entry.turnId));
	const referenceBindings = relevantRecords.map((entry, index) => ({
		handle: `ref_${index + 1}`,
		kind: entry.record.kind,
		recordId: entry.record.value.id
	}));
	const recordProjection = relevantRecords.map(
		(entry, index) => `${referenceBindings[index].handle}: ${projectRecord(entry)}`
	);

	return {
		messages: [
			...selectedChronological.map(({ role, content }) => ({ role, content })),
			...(recordProjection.length > 0
				? [
						{
							role: 'developer' as const,
							content: `Verifierade journalposter:\n${recordProjection.join('\n')}`
						}
					]
				: []),
			...(interactionProjection.length > 0
				? [
						{
							role: 'developer' as const,
							content: `Verifierade väntande måltidsbeslut:\n${interactionProjection.join(
								'\n'
							)}\nProtokollregel: hantera varje relevant väntande beslut innan du ger ett terminalt svar. Använd endast respektive handle med food_log.resolve_registration. Ett uttryckligt ja registrerar förslaget. Ett tydligt nej, en korrigering eller ett tydligt ämnesbyte discard:ar det med motsvarande reason. En hälsning eller en fråga om ett orelaterat ämne är ett tydligt ämnesbyte: svara inte direkt och lämna beslutet pending, utan anropa först resolve_registration med conversation_moved_on och responseRequired true. En faktisk följdfråga om förslaget eller ett otydligt svar får lämna det pending. Gissa inte.`
						}
					]
				: []),
			{ role: 'developer', content: dynamicContext },
			{ role: 'user', content: input.current.content }
		],
		referenceBindings,
		interactionBindings
	};
}

function selectPendingInteractions(
	interactions: MealDuplicateInteractionV1[],
	baseCharacters: number
): MealDuplicateInteractionV1[] {
	const selected: MealDuplicateInteractionV1[] = [];
	let characterCount = baseCharacters;
	for (const interaction of interactions) {
		const projectionLength = projectPendingInteraction(interaction).length;
		const nextCharacters = characterCount + projectionLength;
		if (
			nextCharacters > CHAT_CONTEXT_MAX_CHARACTERS ||
			Math.ceil(nextCharacters / 4) > CHAT_CONTEXT_MAX_ESTIMATED_TOKENS
		) {
			break;
		}
		selected.push(interaction);
		characterCount = nextCharacters;
	}
	return selected;
}

function projectRecord(entry: TurnJournalRecord): string {
	const meal = entry.record.value;
	return `måltid — ${JSON.stringify({
		mealType: meal.mealType,
		occurrence: meal.occurrence,
		items: meal.items.map((item) => ({
			name: item.name,
			amountText: item.amountText,
			ingredients: item.ingredients.map((ingredient) => ({
				name: ingredient.name,
				amountText: ingredient.amountText
			}))
		}))
	})}`;
}

function groupCompleteTurns(history: ModelHistoryMessage[]): ModelHistoryMessage[][] {
	const byTurn = new Map<string, ModelHistoryMessage[]>();
	for (const message of history) {
		const turn = byTurn.get(message.turnId) ?? [];
		turn.push(message);
		byTurn.set(message.turnId, turn);
	}

	return [...byTurn.values()]
		.filter(
			(turn) =>
				turn.filter((message) => message.role === 'user').length === 1 &&
				turn.filter((message) => message.role === 'assistant').length === 1
		)
		.map((turn) =>
			turn.toSorted(
				(left, right) =>
					Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
					(left.role === 'user' ? -1 : 1)
			)
		)
		.sort(
			(left, right) =>
				Date.parse(left[0].createdAt) - Date.parse(right[0].createdAt) ||
				left[0].turnId.localeCompare(right[0].turnId)
		);
}
