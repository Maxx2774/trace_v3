import { error, redirect, type RequestEvent } from '@sveltejs/kit';

type AuthEvent = Pick<RequestEvent, 'locals' | 'url'>;

export function requireUserId({ locals, url }: AuthEvent): string {
	const userId = locals.claims?.sub;

	if (!userId) {
		const next = `${url.pathname}${url.search}`;
		redirect(303, `/auth/email?next=${encodeURIComponent(next)}`);
	}

	return userId;
}

export function requireAuthenticatedUserId({ locals }: Pick<RequestEvent, 'locals'>): string {
	const userId = locals.claims?.sub;
	if (!userId) error(401, 'Du måste vara inloggad.');
	return userId;
}
