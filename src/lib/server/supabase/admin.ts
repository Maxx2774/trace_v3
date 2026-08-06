import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let adminClient: SupabaseClient | undefined;

export function getAdminSupabaseClient(): SupabaseClient {
	if (adminClient) return adminClient;

	const url = publicEnv.PUBLIC_SUPABASE_URL;
	const secretKey = privateEnv.SUPABASE_SECRET_KEY;

	if (!url || !secretKey) {
		throw new Error('Supabase adminåtkomst är inte konfigurerad.');
	}

	adminClient = createClient(url, secretKey, {
		auth: {
			autoRefreshToken: false,
			persistSession: false
		}
	});

	return adminClient;
}
