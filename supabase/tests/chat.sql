begin;

do $$
declare
	v_user_id uuid := 'a1000000-0000-4000-8000-000000000000';
	v_other_user_id uuid := 'a2000000-0000-4000-8000-000000000000';
	v_turn_id uuid := gen_random_uuid();
	v_result jsonb;
	v_conversation_id uuid;
begin
	insert into auth.users (
		id,
		instance_id,
		aud,
		role,
		email,
		raw_app_meta_data,
		raw_user_meta_data,
		created_at,
		updated_at
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

	v_result := public.begin_chat_turn(
		v_user_id,
		null,
		v_turn_id,
		'Hej Trace',
		'Kort systemprompt',
		20,
		48000
	);

	assert v_result ->> 'status' = 'created', 'begin must create a new turn';
	v_conversation_id := (v_result #>> '{conversation,id}')::uuid;
	assert (v_result #>> '{message,turnId}')::uuid = v_turn_id, 'begin must return the user row';
	assert jsonb_array_length(v_result -> 'history') = 1, 'history must include the current user turn';
	assert (select count(*) from public.messages where turn_id = v_turn_id) = 1,
		'begin must persist exactly one user message';

	v_result := public.begin_chat_turn(
		v_user_id,
		v_conversation_id,
		v_turn_id,
		'Hej Trace',
		'Kort systemprompt',
		20,
		48000
	);
	assert v_result ->> 'status' = 'pending', 'an uncommitted retry must not start another model call';

	v_result := public.commit_chat_turn(
		v_user_id,
		v_conversation_id,
		v_turn_id,
		'Hej! Hur kan jag hjälpa dig?'
	);
	assert v_result #>> '{message,role}' = 'assistant', 'commit must return the assistant row';
	assert (select count(*) from public.messages where turn_id = v_turn_id) = 2,
		'commit must add exactly one assistant message';

	v_result := public.commit_chat_turn(
		v_user_id,
		v_conversation_id,
		v_turn_id,
		'Hej! Hur kan jag hjälpa dig?'
	);
	assert (select count(*) from public.messages where turn_id = v_turn_id) = 2,
		'an identical commit retry must be idempotent';

	v_result := public.begin_chat_turn(
		v_user_id,
		v_conversation_id,
		v_turn_id,
		'Hej Trace',
		'Kort systemprompt',
		20,
		48000
	);
	assert v_result ->> 'status' = 'completed', 'a completed retry must return saved output';
	assert v_result #>> '{assistantMessage,content}' = 'Hej! Hur kan jag hjälpa dig?',
		'a completed retry must return the canonical assistant content';

	v_result := public.begin_chat_turn(
		v_user_id,
		v_conversation_id,
		v_turn_id,
		'Annat innehåll',
		'Kort systemprompt',
		20,
		48000
	);
	assert v_result ->> 'status' = 'conflict', 'reusing a turn id with other content must conflict';

	v_result := public.begin_chat_turn(
		v_other_user_id,
		v_conversation_id,
		gen_random_uuid(),
		'Försök över ägargränsen',
		'Kort systemprompt',
		20,
		48000
	);
	assert v_result ->> 'status' = 'not_found', 'another owner must not append to the conversation';

	v_result := public.begin_chat_turn(
		v_other_user_id,
		null,
		gen_random_uuid(),
		'En annan användares konversation',
		'Kort systemprompt',
		20,
		48000
	);
	assert v_result ->> 'status' = 'created', 'the second owner needs an isolated fixture';

	assert not has_function_privilege(
		'anon',
		'public.begin_chat_turn(uuid,uuid,uuid,text,text,integer,integer)',
		'execute'
	), 'anon must not execute begin_chat_turn';
	assert not has_function_privilege(
		'authenticated',
		'public.commit_chat_turn(uuid,uuid,uuid,text)',
		'execute'
	), 'authenticated must not execute commit_chat_turn';
	assert has_function_privilege(
		'service_role',
		'public.begin_chat_turn(uuid,uuid,uuid,text,text,integer,integer)',
		'execute'
	), 'service_role must execute begin_chat_turn';
	assert not has_table_privilege('authenticated', 'public.conversations', 'insert'),
		'authenticated must not insert conversations directly';
	assert not has_table_privilege('authenticated', 'public.messages', 'delete'),
		'authenticated must not delete messages directly';
end;
$$;

set local role authenticated;
select set_config(
	'request.jwt.claim.sub',
	'a1000000-0000-4000-8000-000000000000',
	true
);

do $$
begin
	assert (select count(*) from public.conversations) = 1,
		'RLS must expose exactly the signed-in owner conversation';
	assert not exists (
		select 1
		from public.conversations
		where user_id = 'a2000000-0000-4000-8000-000000000000'
	), 'RLS must hide another owner conversation';
	assert not exists (
		select 1
		from public.messages
		where user_id = 'a2000000-0000-4000-8000-000000000000'
	), 'RLS must hide another owner messages';
end;
$$;

reset role;

rollback;
