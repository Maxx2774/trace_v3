import { requireUserId } from '$lib/server/auth';
import { listOwnedConversations } from '$lib/server/chat/conversations';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	const userId = requireUserId(event);
	const initialConversationPage = await listOwnedConversations(event.locals.supabase, userId);

	const claims = event.locals.claims;
	const metadata = (claims?.user_metadata ?? {}) as Record<string, unknown>;
	const email = typeof claims?.email === 'string' ? claims.email : '';
	const displayName =
		stringValue(metadata.full_name) || stringValue(metadata.name) || email.split('@')[0] || 'Du';

	return {
		displayName,
		initialConversationPage,
		sidebarOpen: event.cookies.get('trace-sidebar-open') === '1'
	};
};

function stringValue(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}
