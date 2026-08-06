-- Irreversible Trace v2 conversation teardown.
-- The migration deliberately removes known dependencies before the two data tables.
-- It does not use CASCADE, so an unclassified dependency stops the migration.

begin;

revoke execute on all functions in schema trace_runtime
	from public, anon, authenticated, service_role;

drop trigger if exists conversation_messages_operation_response_snapshot_provenance
	on public.conversation_messages;
drop trigger if exists populate_trace_v2_assistant_payload_before_insert
	on public.conversation_messages;
drop trigger if exists prepare_conversation_message_before_insert
	on public.conversation_messages;
drop trigger if exists trace_v2_account_write_guard
	on public.conversation_messages;
drop trigger if exists initialize_trace_v2_conversation_state_after_insert
	on public.conversations;
drop trigger if exists trace_v2_account_write_guard
	on public.conversations;

alter table if exists trace_runtime.conversation_admissions
	drop constraint if exists conversation_admissions_conversation_owner_fkey;
alter table if exists trace_runtime.conversation_states
	drop constraint if exists conversation_states_conversation_owner_fkey;
alter table if exists trace_runtime.conversation_turns
	drop constraint if exists conversation_turns_conversation_owner_fkey;
alter table if exists trace_runtime.runtime_invocations
	drop constraint if exists runtime_invocations_conversation_owner_fkey;
alter table if exists trace_runtime.turn_references
	drop constraint if exists turn_references_conversation_owner_fkey;
alter table if exists trace_runtime.turn_references
	drop constraint if exists turn_references_assistant_message_id_fkey;
alter table if exists trace_runtime.turn_finalizations
	drop constraint if exists turn_finalizations_assistant_message_id_fkey;
alter table if exists trace_runtime.operation_response_call_telemetry
	drop constraint if exists operation_response_call_telemetry_assistant_message_id_fkey;

-- Remove triggers anywhere in the legacy schemas whose trigger function names a
-- legacy conversation table. This covers deferred/runtime cleanup triggers as
-- well as triggers attached directly to the two public tables.
do $$
declare
	legacy_trigger record;
begin
	for legacy_trigger in
		select
			table_ns.nspname as table_schema,
			table_class.relname as table_name,
			trigger.tgname as trigger_name
		from pg_trigger trigger
		join pg_class table_class on table_class.oid = trigger.tgrelid
		join pg_namespace table_ns on table_ns.oid = table_class.relnamespace
		join pg_proc trigger_function on trigger_function.oid = trigger.tgfoid
		join pg_namespace function_ns on function_ns.oid = trigger_function.pronamespace
		where not trigger.tgisinternal
			and function_ns.nspname in ('public', 'trace_private', 'trace_runtime')
			and (
				pg_get_functiondef(trigger_function.oid) ilike '%public.conversations%'
				or pg_get_functiondef(trigger_function.oid) ilike '%public.conversation_messages%'
			)
		order by table_ns.nspname, table_class.relname, trigger.tgname
	loop
		execute format(
			'drop trigger %I on %I.%I',
			legacy_trigger.trigger_name,
			legacy_trigger.table_schema,
			legacy_trigger.table_name
		);
	end loop;
end;
$$;

-- PL/pgSQL does not record table references from function bodies as pg_depend rows.
-- Remove every function whose stored definition still names either legacy table.
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
			and n.nspname in ('public', 'trace_private', 'trace_runtime')
			and (
				pg_get_functiondef(p.oid) ilike '%public.conversations%'
				or pg_get_functiondef(p.oid) ilike '%public.conversation_messages%'
			)
		order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
	loop
		execute format(
			'drop function %I.%I(%s)',
			routine.schema_name,
			routine.function_name,
			routine.identity_arguments
		);
	end loop;
end;
$$;

do $$
begin
	if exists (
		select 1
		from pg_proc p
		join pg_namespace n on n.oid = p.pronamespace
		where p.prokind = 'f'
			and n.nspname not in ('pg_catalog', 'information_schema')
			and (
				pg_get_functiondef(p.oid) ilike '%public.conversations%'
				or pg_get_functiondef(p.oid) ilike '%public.conversation_messages%'
			)
	) then
		raise exception 'A Trace v2 routine still references a legacy conversation table';
	end if;
end;
$$;

drop table if exists public.conversation_messages;
drop table if exists public.conversations;

do $$
begin
	if to_regclass('public.conversation_messages') is not null
		or to_regclass('public.conversations') is not null then
		raise exception 'Trace v2 conversation tables remain after teardown';
	end if;
end;
$$;

commit;
