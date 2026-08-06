import { safeNext } from '$lib/server/redirects';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	const code = url.searchParams.get('code');
	const next = safeNext(url.searchParams.get('next'));

	if (code) {
		const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
		if (!error) redirect(303, next);
		console.error('Failed to exchange OAuth code for session', error);
	}

	redirect(303, `/auth/email?auth=error&next=${encodeURIComponent(next)}`);
};
