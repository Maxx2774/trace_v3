import { fail, redirect } from '@sveltejs/kit';
import { safeNext } from '$lib/server/redirects';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.claims?.sub) redirect(303, safeNext(url.searchParams.get('next')));
	return { next: safeNext(url.searchParams.get('next')) };
};

export const actions: Actions = {
	signIn: async ({ locals, request, url }) => {
		const form = await request.formData();
		const next = safeNext(form.get('next')?.toString() ?? url.searchParams.get('next'));
		const email = form.get('email')?.toString().trim() ?? '';
		const password = form.get('password')?.toString() ?? '';

		if (!email || !password) {
			return fail(400, { mode: 'signIn', email, error: 'E-post och lösenord krävs.' });
		}

		const { error } = await locals.supabase.auth.signInWithPassword({ email, password });
		if (error) return fail(400, { mode: 'signIn', email, error: error.message });

		redirect(303, next);
	},

	signUp: async ({ locals, request, url }) => {
		const form = await request.formData();
		const next = safeNext(form.get('next')?.toString() ?? url.searchParams.get('next'));
		const email = form.get('email')?.toString().trim() ?? '';
		const password = form.get('password')?.toString() ?? '';

		if (!email || !password) {
			return fail(400, { mode: 'signUp', email, error: 'E-post och lösenord krävs.' });
		}

		const { data, error } = await locals.supabase.auth.signUp({ email, password });
		if (error) return fail(400, { mode: 'signUp', email, error: error.message });

		if (!data.session) {
			return fail(400, {
				mode: 'signUp',
				email,
				error: 'Kontot skapades. Bekräfta e-postadressen innan du loggar in.'
			});
		}

		redirect(303, next);
	}
};
