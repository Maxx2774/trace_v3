import type { JwtPayload, SupabaseClient } from '@supabase/supabase-js';
import type { Meal } from '$lib/features/meals/contracts';

declare global {
	interface WindowEventMap {
		tracemealcreated: CustomEvent<Meal>;
		tracemealreloadrequested: CustomEvent;
	}

	namespace App {
		interface Locals {
			supabase: SupabaseClient;
			claims: JwtPayload | null;
		}
	}
}

export {};
