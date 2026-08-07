import type { PathnameWithSearchOrHash } from '$app/types';

const CONVERSATION_PARAM = 'conversation';
const CHAT_PARAM = 'chat';
const CONVERSATION_LIST_VALUE = 'conversations';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ChatUrlState =
	| { view: 'new' }
	| { view: 'conversations' }
	| { view: 'conversation'; conversationId: string }
	| { view: 'invalid' };

export function getChatUrlState(url: URL): ChatUrlState {
	const chat = url.searchParams.get(CHAT_PARAM);
	const conversationId = url.searchParams.get(CONVERSATION_PARAM);

	if (chat === CONVERSATION_LIST_VALUE) return { view: 'conversations' };
	if (conversationId !== null) {
		return UUID_PATTERN.test(conversationId)
			? { view: 'conversation', conversationId }
			: { view: 'invalid' };
	}
	if (chat !== null) return { view: 'invalid' };
	return { view: 'new' };
}

export function getChatUrl(
	url: URL,
	state: Exclude<ChatUrlState, { view: 'invalid' }>
): PathnameWithSearchOrHash {
	const next = new URL(url);
	next.searchParams.delete(CHAT_PARAM);
	next.searchParams.delete(CONVERSATION_PARAM);

	if (state.view === 'conversations') {
		next.searchParams.set(CHAT_PARAM, CONVERSATION_LIST_VALUE);
	} else if (state.view === 'conversation') {
		next.searchParams.set(CONVERSATION_PARAM, state.conversationId);
	}

	return `${next.pathname}${next.search}${next.hash}` as PathnameWithSearchOrHash;
}

export function getPrimaryNavigationUrl(
	pathname: string,
	currentUrl: URL
): PathnameWithSearchOrHash {
	const target = new URL(pathname, currentUrl);
	const state = getChatUrlState(currentUrl);
	return state.view === 'invalid'
		? (`${target.pathname}${target.search}${target.hash}` as PathnameWithSearchOrHash)
		: getChatUrl(target, state);
}
