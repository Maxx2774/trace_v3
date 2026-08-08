begin;

do $$
declare
	v_user_id uuid := 'a1000000-0000-4000-8000-000000000000';
	v_other_user_id uuid := 'a2000000-0000-4000-8000-000000000000';
	v_turn_id uuid := gen_random_uuid();
	v_result jsonb;
	v_conversation_id uuid;
	v_first_lease timestamptz;
	v_second_lease timestamptz;
	v_extra_turn_id uuid;
	v_page jsonb;
	v_older_page jsonb;
	v_index integer;
begin
	insert into auth.users (
		id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
	)
	values
		(
			v_user_id,
			'00000000-0000-0000-0000-000000000000',
			'authenticated',
			'authenticated',
			'chat-test-1@example.invalid',
			'{}'::jsonb,
			'{}'::jsonb,
			now(),
			now()
		),
		(
			v_other_user_id,
			'00000000-0000-0000-0000-000000000000',
			'authenticated',
			'authenticated',
			'chat-test-2@example.invalid',
			'{}'::jsonb,
			'{}'::jsonb,
			now(),
			now()
		);

	v_result := public.begin_chat_turn(v_user_id, null, v_turn_id, 'Hej Trace', 120);
	assert v_result ->> 'status' = 'created', 'begin must create a new turn';
	v_conversation_id := (v_result #>> '{conversation,id}')::uuid;
	assert (
		select category from public.conversations where id = v_conversation_id
	) = 'general', 'new conversations must start with the safe general category';
	v_first_lease := (v_result ->> 'turnLeaseExpiresAt')::timestamptz;
	assert (select count(*) from public.turns where id = v_turn_id) = 1,
		'begin must create exactly one lifecycle row';
	assert (select count(*) from public.messages where turn_id = v_turn_id and role = 'user') = 1,
		'begin must create exactly one user message';

	begin
		update public.conversations set category = 'unsupported' where id = v_conversation_id;
		assert false, 'conversation categories outside the canonical set must be rejected';
	exception when check_violation then
		null;
	end;

	v_result := public.begin_chat_turn(v_user_id, v_conversation_id, v_turn_id, 'Hej Trace', 120);
	assert v_result ->> 'status' = 'pending', 'a valid processing lease must return pending';

	update public.turns
	set lease_expires_at = statement_timestamp() - interval '1 second'
	where id = v_turn_id;

	v_result := public.begin_chat_turn(v_user_id, v_conversation_id, v_turn_id, 'Hej Trace', 120);
	assert v_result ->> 'status' = 'resumed', 'an expired lease must be reclaimable';
	v_second_lease := (v_result ->> 'turnLeaseExpiresAt')::timestamptz;
	assert v_second_lease > v_first_lease, 'reclaim must issue a new fencing value';

	begin
		perform public.complete_chat_turn(v_user_id, v_turn_id, v_first_lease, 'Stale svar');
		assert false, 'a stale lease must not finalize';
	exception when sqlstate '55000' then
		null;
	end;

	v_result := public.complete_chat_turn(v_user_id, v_turn_id, v_second_lease, 'Hej!');
	assert v_result #>> '{message,role}' = 'assistant', 'complete must return the assistant row';
	assert (select status from public.turns where id = v_turn_id) = 'completed',
		'complete must finalize the lifecycle';
	assert (select count(*) from public.messages where turn_id = v_turn_id) = 2,
		'a completed turn must have one user and one assistant message';

	v_result := public.begin_chat_turn(v_user_id, v_conversation_id, v_turn_id, 'Hej Trace', 120);
	assert v_result ->> 'status' = 'completed', 'completed begin must replay';
	assert v_result #>> '{assistantMessage,content}' = 'Hej!', 'replay must return canonical text';
	assert jsonb_array_length(v_result -> 'journalRecords') = 0,
		'replay without records must return an empty projection';

	v_result := public.begin_chat_turn(v_user_id, v_conversation_id, v_turn_id, 'Annat', 120);
	assert v_result ->> 'status' = 'conflict', 'changed input under the same turn id must conflict';

	v_result := public.begin_chat_turn(
		v_other_user_id, v_conversation_id, gen_random_uuid(), 'Ägarförsök', 120
	);
	assert v_result ->> 'status' = 'not_found', 'another owner must not append to the conversation';

	v_result := public.begin_chat_turn(
		v_user_id,
		null,
		gen_random_uuid(),
		'Jag åt en banan men minns inte när. Jag åt yoghurt ungefär klockan 08 idag. Jag åt middag exakt klockan 19:30 idag.',
		120
	);
	assert v_result ->> 'status' = 'created', 'long input must still create a turn';
	assert v_result #>> '{conversation,title}' = btrim(v_result #>> '{conversation,title}'),
		'truncated provisional titles must remain trimmed';
	assert char_length(v_result #>> '{conversation,title}') <= 80,
		'provisional titles must remain within the initial limit';

	for v_index in 1..21 loop
		v_extra_turn_id := gen_random_uuid();
		insert into public.turns (
			id, conversation_id, user_id, status, lease_expires_at, created_at, completed_at
		)
		values (
			v_extra_turn_id,
			v_conversation_id,
			v_user_id,
			'completed',
			null,
			statement_timestamp() - make_interval(mins => v_index),
			statement_timestamp() - make_interval(mins => v_index) + interval '1 second'
		);

		insert into public.messages (
			conversation_id, user_id, turn_id, role, content, created_at
		)
		values
			(
				v_conversation_id,
				v_user_id,
				v_extra_turn_id,
				'user',
				'Fråga ' || v_index,
				statement_timestamp() - make_interval(mins => v_index)
			),
			(
				v_conversation_id,
				v_user_id,
				v_extra_turn_id,
				'assistant',
				'Svar ' || v_index,
				statement_timestamp() - make_interval(mins => v_index) + interval '1 second'
			);
	end loop;

	v_page := public.get_conversation_page(v_user_id, v_conversation_id, null, null, 20);
	assert jsonb_array_length(v_page -> 'messages') = 40,
		'initial history page must contain twenty complete turns';
	assert (
		select count(distinct message ->> 'turnId')
		from jsonb_array_elements(v_page -> 'messages') message
	) = 20, 'history pagination must not split turns';
	assert v_page -> 'olderCursor' <> 'null'::jsonb,
		'initial history page must return an older cursor';

	v_older_page := public.get_conversation_page(
		v_user_id,
		v_conversation_id,
		(v_page #>> '{olderCursor,createdAt}')::timestamptz,
		(v_page #>> '{olderCursor,turnId}')::uuid,
		15
	);
	assert jsonb_array_length(v_older_page -> 'messages') = 4,
		'older history page must return the remaining two complete turns';
	assert v_older_page -> 'olderCursor' = 'null'::jsonb,
		'last history page must not return another cursor';
	assert public.get_conversation_page(
		v_other_user_id, v_conversation_id, null, null, 20
	) is null, 'conversation pages must enforce ownership';

	assert not has_function_privilege(
		'authenticated',
		'public.begin_chat_turn(uuid,uuid,uuid,text,integer)',
		'execute'
	), 'authenticated must not execute lifecycle RPCs';
	assert (
		select proargnames = array[
			'p_user_id', 'p_conversation_id', 'p_turn_id', 'p_content',
			'p_lease_duration_seconds'
		]
		from pg_catalog.pg_proc
		where oid = 'public.begin_chat_turn(uuid,uuid,uuid,text,integer)'::regprocedure
	), 'begin RPC parameter names must match the server contract';
	assert (
		select proargnames = array[
			'p_user_id', 'p_turn_id', 'p_turn_lease_expires_at', 'p_content'
		]
		from pg_catalog.pg_proc
		where oid = 'public.complete_chat_turn(uuid,uuid,timestamptz,text)'::regprocedure
	), 'complete RPC parameter names must match the server contract';
	assert (
		select proargnames = array[
			'p_user_id', 'p_turn_id', 'p_turn_lease_expires_at', 'p_retryable'
		]
		from pg_catalog.pg_proc
		where oid = 'public.fail_chat_turn(uuid,uuid,timestamptz,boolean)'::regprocedure
	), 'failure RPC parameter names must match the server contract';
	assert has_function_privilege(
		'service_role',
		'public.complete_chat_turn(uuid,uuid,timestamptz,text)',
		'execute'
	), 'service role must finalize turns';
	assert not has_function_privilege(
		'authenticated',
		'public.get_conversation_page(uuid,uuid,timestamptz,uuid,integer)',
		'execute'
	), 'authenticated must not execute the conversation page RPC directly';
	assert has_function_privilege(
		'service_role',
		'public.get_conversation_page(uuid,uuid,timestamptz,uuid,integer)',
		'execute'
	), 'service role must read paginated conversation history';
	assert not has_table_privilege('authenticated', 'public.turns', 'select'),
		'turn lifecycle must remain server-only';
	assert not has_table_privilege('authenticated', 'public.messages', 'insert'),
		'authenticated must not insert messages directly';
end;
$$;

rollback;
