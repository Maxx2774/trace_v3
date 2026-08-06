import type { JwtPayload, SupabaseClient } from '@supabase/supabase-js';

declare global {
	namespace App {
		interface Locals {
			supabase: SupabaseClient;
			claims: JwtPayload | null;
		}
	}
}

export {};
