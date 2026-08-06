import { safeNext } from '$lib/server/redirects';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	const next = safeNext(url.searchParams.get('next'));
	const redirectTo = new URL('/auth/callback', url);
	redirectTo.searchParams.set('next', next);

	const { data, error } = await locals.supabase.auth.signInWithOAuth({
		provider: 'google',
		options: { redirectTo: redirectTo.toString() }
	});

	if (error || !data.url) {
		console.error('Failed to start OAuth flow', error);
		redirect(303, `/auth/email?auth=error&next=${encodeURIComponent(next)}`);
	}

	redirect(303, data.url);
};
