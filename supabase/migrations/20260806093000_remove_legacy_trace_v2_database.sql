-- Irreversible retirement of the remaining Trace v2 database surface.
--
-- The live v2 schema was archived in the Trace v2 repository before this
-- migration was applied. The only application-owned objects retained for v3
-- are public.conversations, public.messages, public.begin_chat_turn and
-- public.commit_chat_turn. Supabase-managed schemas and auth data are retained.

do $$
begin
	if to_regclass('public.conversations') is null
		or to_regclass('public.messages') is null
		or to_regprocedure(
			'public.begin_chat_turn(uuid,uuid,uuid,text,text,integer,integer)'
		) is null
		or to_regprocedure('public.commit_chat_turn(uuid,uuid,uuid,text)') is null then
		raise exception 'Trace v3 chat allowlist is incomplete; refusing legacy cleanup';
	end if;
end;
$$;

-- This legacy PostgREST hook currently blocks every authenticated Data API
-- request once the request switches from authenticator to authenticated.
alter role authenticator reset pgrst.db_pre_request;

-- The v2 export bucket is private and was verified empty before retirement.
do $$
begin
	if exists (
		select 1
		from storage.objects
		where bucket_id = 'trace-data-exports'
	) then
		raise exception 'trace-data-exports is not empty; refusing to orphan stored objects';
	end if;

	-- Storage's statement trigger requires this transaction-local flag for the
	-- same protected delete path used by the Storage service.
	perform set_config('storage.allow_delete_query', 'true', true);

	delete from storage.buckets
	where id = 'trace-data-exports';
end;
$$;

-- Drop the public v2 domain tables first. Their table-owned constraints,
-- policies, indexes and triggers include dependencies on the legacy schemas.
drop table if exists public.check_in_request_signals cascade;
drop table if exists public.check_in_requests cascade;
drop table if exists public.check_in_responses cascade;
drop table if exists public.check_in_schedules cascade;
drop table if exists public.check_ins cascade;
drop table if exists public.experiment_periods cascade;
drop table if exists public.ingredient_suggestions cascade;
drop table if exists public.meal_item_components cascade;
drop table if exists public.meal_items cascade;
drop table if exists public.meals cascade;
drop table if exists public.saved_dish_aliases cascade;
drop table if exists public.saved_dish_version_components cascade;
drop table if exists public.saved_dish_versions cascade;
drop table if exists public.saved_dishes cascade;
drop table if exists public.sleep_episodes cascade;
drop table if exists public.symptom_occurrences cascade;
drop table if exists public.tracked_signals cascade;
drop table if exists public.user_memory_entries cascade;
drop table if exists public.weight_observations cascade;

-- The catalog audit found 93 remaining public v2 overloads. Dropping by exact
-- catalog signature handles overloads without touching the two v3 RPCs.
do $$
declare
	routine record;
begin
	for routine in
		select
			n.nspname as schema_name,
			p.proname as function_name,
			pg_get_function_identity_arguments(p.oid) as identity_arguments
		from pg_proc p
		join pg_namespace n on n.oid = p.pronamespace
		where p.prokind = 'f'
			and n.nspname = 'public'
			and p.proname like '%trace_v2%'
		order by p.proname, pg_get_function_identity_arguments(p.oid)
	loop
		execute format(
			'drop function %I.%I(%s) cascade',
			routine.schema_name,
			routine.function_name,
			routine.identity_arguments
		);
	end loop;
end;
$$;

drop schema if exists trace_analysis cascade;
drop schema if exists trace_runtime cascade;
drop schema if exists trace_private cascade;

-- These optional extensions were introduced by the retired database and have
-- no remaining columns, jobs, triggers or v3 references. Platform extensions
-- used by Supabase itself are intentionally retained.
drop extension if exists vector;
drop extension if exists pg_cron;
drop extension if exists moddatetime;

do $$
begin
	if exists (
		select 1
		from pg_db_role_setting setting
		cross join lateral unnest(setting.setconfig) as value
		join pg_roles role on role.oid = setting.setrole
		where role.rolname = 'authenticator'
			and value like 'pgrst.db_pre_request=%'
	) then
		raise exception 'Legacy PostgREST pre-request hook remains configured';
	end if;

	if exists (
		select 1
		from pg_namespace
		where nspname in ('trace_analysis', 'trace_runtime', 'trace_private')
	) then
		raise exception 'A legacy Trace schema remains after cleanup';
	end if;

	if exists (
		select 1
		from pg_class relation
		join pg_namespace namespace on namespace.oid = relation.relnamespace
		where namespace.nspname = 'public'
			and relation.relkind in ('r', 'p', 'v', 'm', 'S')
			and relation.relname not in ('conversations', 'messages')
	) then
		raise exception 'A non-v3 public relation remains after cleanup';
	end if;

	if exists (
		select 1
		from pg_proc routine
		join pg_namespace namespace on namespace.oid = routine.pronamespace
		where namespace.nspname = 'public'
			and routine.oid not in (
				'public.begin_chat_turn(uuid,uuid,uuid,text,text,integer,integer)'::regprocedure,
				'public.commit_chat_turn(uuid,uuid,uuid,text)'::regprocedure
			)
	) then
		raise exception 'A non-v3 public routine remains after cleanup';
	end if;

	if exists (
		select 1
		from storage.buckets
		where id = 'trace-data-exports'
	) then
		raise exception 'Legacy export bucket remains after cleanup';
	end if;
end;
$$;

-- Notifications are delivered when the migration transaction commits.
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
