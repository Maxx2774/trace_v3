import { requireUserId } from '$lib/server/auth';
import { listOwnedMeals } from '$lib/server/meals/meals';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const userId = requireUserId(event);
	return {
		meals: await listOwnedMeals(event.locals.supabase, userId)
	};
};
