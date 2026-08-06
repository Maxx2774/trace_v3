import { error, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ locals }) => {
		const { error: signOutError } = await locals.supabase.auth.signOut({ scope: 'local' });

		if (signOutError) {
			console.error('Failed to sign out', signOutError);
			error(500, 'Kunde inte logga ut.');
		}

		redirect(303, '/auth/email');
	}
};
