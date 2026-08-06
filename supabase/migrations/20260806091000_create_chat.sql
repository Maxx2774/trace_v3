begin;

create table public.conversations (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references auth.users(id) on delete cascade,
	title text not null,
	created_at timestamptz not null default statement_timestamp(),
	updated_at timestamptz not null default statement_timestamp(),
	last_message_at timestamptz not null default statement_timestamp(),
	constraint conversations_id_user_id_key unique (id, user_id),
	constraint conversations_title_check check (
		title = btrim(title)
		and char_length(title) between 1 and 160
	),
	constraint conversations_timestamps_check check (
		updated_at >= created_at
		and last_message_at >= created_at
	)
);

create table public.messages (
	id uuid primary key default gen_random_uuid(),
	conversation_id uuid not null,
	user_id uuid not null references auth.users(id) on delete cascade,
	turn_id uuid not null,
	role text not null,
	content text not null,
	created_at timestamptz not null default statement_timestamp(),
	constraint messages_conversation_owner_fkey
		foreign key (conversation_id, user_id)
		references public.conversations(id, user_id)
		on delete cascade,
	constraint messages_role_check check (role in ('user', 'assistant')),
	constraint messages_content_check check (
		content = btrim(content)
		and char_length(content) >= 1
		and (
			(role = 'user' and char_length(content) <= 5000)
			or (role = 'assistant' and char_length(content) <= 32768)
		)
	),
	constraint messages_user_turn_role_key unique (user_id, turn_id, role)
);

create index conversations_user_activity_idx
	on public.conversations (user_id, last_message_at desc, id desc);

create index messages_conversation_history_idx
	on public.messages (conversation_id, created_at desc, id desc);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy conversations_select_own
	on public.conversations
	for select
	to authenticated
	using ((select auth.uid()) = user_id);

create policy messages_select_own
	on public.messages
	for select
	to authenticated
	using ((select auth.uid()) = user_id);

revoke all on table public.conversations from anon, authenticated;
revoke all on table public.messages from anon, authenticated;
grant select on table public.conversations to authenticated;
grant select on table public.messages to authenticated;

create or replace function public.begin_chat_turn(
	p_user_id uuid,
	p_conversation_id uuid,
	p_turn_id uuid,
	p_content text,
	p_system_prompt text,
	p_max_turns integer default 20,
	p_character_budget integer default 48000
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_now timestamptz := statement_timestamp();
	v_conversation public.conversations%rowtype;
	v_user_message public.messages%rowtype;
	v_assistant_message public.messages%rowtype;
	v_history jsonb := '[]'::jsonb;
	v_title text;
begin
	if p_content is null
		or p_content <> btrim(p_content)
		or char_length(p_content) not between 1 and 5000
		or p_max_turns not between 1 and 20
		or p_character_budget not between 1 and 48000
		or char_length(coalesce(p_system_prompt, '')) >= p_character_budget then
		raise exception using errcode = '22023', message = 'invalid_chat_turn_input';
	end if;

	perform pg_catalog.pg_advisory_xact_lock(
		pg_catalog.hashtextextended(p_user_id::text || ':' || p_turn_id::text, 0)
	);

	select *
	into v_user_message
	from public.messages
	where user_id = p_user_id
		and turn_id = p_turn_id
		and role = 'user';

	if found then
		if v_user_message.content <> p_content
			or (p_conversation_id is not null and v_user_message.conversation_id <> p_conversation_id) then
			return jsonb_build_object('status', 'conflict');
		end if;

		select * into v_conversation
		from public.conversations
		where id = v_user_message.conversation_id
			and user_id = p_user_id;

		select * into v_assistant_message
		from public.messages
		where user_id = p_user_id
			and turn_id = p_turn_id
			and role = 'assistant';

		if found then
			return jsonb_build_object(
				'status', 'completed',
				'conversation', jsonb_build_object(
					'id', v_conversation.id,
					'title', v_conversation.title,
					'createdAt', v_conversation.created_at,
					'updatedAt', v_conversation.updated_at,
					'lastMessageAt', v_conversation.last_message_at
				),
				'message', jsonb_build_object(
					'id', v_user_message.id,
					'conversationId', v_user_message.conversation_id,
					'turnId', v_user_message.turn_id,
					'role', v_user_message.role,
					'content', v_user_message.content,
					'createdAt', v_user_message.created_at
				),
				'assistantMessage', jsonb_build_object(
					'id', v_assistant_message.id,
					'conversationId', v_assistant_message.conversation_id,
					'turnId', v_assistant_message.turn_id,
					'role', v_assistant_message.role,
					'content', v_assistant_message.content,
					'createdAt', v_assistant_message.created_at
				)
			);
		end if;

		return jsonb_build_object('status', 'pending');
	end if;

	if p_conversation_id is null then
		v_title := left(regexp_replace(p_content, E'\\s+', ' ', 'g'), 80);
		insert into public.conversations (user_id, title, created_at, updated_at, last_message_at)
		values (p_user_id, v_title, v_now, v_now, v_now)
		returning * into v_conversation;
	else
		select * into v_conversation
		from public.conversations
		where id = p_conversation_id
			and user_id = p_user_id
		for update;

		if not found then
			return jsonb_build_object('status', 'not_found');
		end if;
	end if;

	insert into public.messages (
		conversation_id,
		user_id,
		turn_id,
		role,
		content,
		created_at
	)
	values (
		v_conversation.id,
		p_user_id,
		p_turn_id,
		'user',
		p_content,
		v_now
	)
	returning * into v_user_message;

	update public.conversations
	set updated_at = v_now,
		last_message_at = v_now
	where id = v_conversation.id
		and user_id = p_user_id
	returning * into v_conversation;

	with turn_totals as (
		select
			turn_id,
			max(created_at) as turn_created_at,
			sum(char_length(content))::integer as turn_characters
		from public.messages
		where conversation_id = v_conversation.id
			and user_id = p_user_id
		group by turn_id
	),
	ranked_turns as (
		select
			turn_id,
			row_number() over (order by turn_created_at desc, turn_id desc) as turn_rank,
			sum(turn_characters) over (
				order by turn_created_at desc, turn_id desc
				rows between unbounded preceding and current row
			) as running_characters
		from turn_totals
	),
	selected_turns as (
		select turn_id
		from ranked_turns
		where turn_rank <= p_max_turns
			and char_length(p_system_prompt) + running_characters <= p_character_budget
	),
	history_rows as (
		select m.*
		from public.messages m
		join selected_turns selected on selected.turn_id = m.turn_id
		where m.conversation_id = v_conversation.id
			and m.user_id = p_user_id
		order by m.created_at, case m.role when 'user' then 0 else 1 end, m.id
	)
	select coalesce(
		jsonb_agg(
			jsonb_build_object(
				'turnId', turn_id,
				'role', role,
				'content', content
			)
			order by created_at, case role when 'user' then 0 else 1 end, id
		),
		'[]'::jsonb
	)
	into v_history
	from history_rows;

	if not exists (
		select 1
		from jsonb_array_elements(v_history) item
		where (item ->> 'turnId')::uuid = p_turn_id
	) then
		raise exception using errcode = '22023', message = 'current_turn_exceeds_history_budget';
	end if;

	return jsonb_build_object(
		'status', 'created',
		'conversation', jsonb_build_object(
			'id', v_conversation.id,
			'title', v_conversation.title,
			'createdAt', v_conversation.created_at,
			'updatedAt', v_conversation.updated_at,
			'lastMessageAt', v_conversation.last_message_at
		),
		'message', jsonb_build_object(
			'id', v_user_message.id,
			'conversationId', v_user_message.conversation_id,
			'turnId', v_user_message.turn_id,
			'role', v_user_message.role,
			'content', v_user_message.content,
			'createdAt', v_user_message.created_at
		),
		'history', v_history
	);
end;
$$;

create or replace function public.commit_chat_turn(
	p_user_id uuid,
	p_conversation_id uuid,
	p_turn_id uuid,
	p_content text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_now timestamptz := statement_timestamp();
	v_conversation public.conversations%rowtype;
	v_user_message public.messages%rowtype;
	v_assistant_message public.messages%rowtype;
begin
	if p_content is null
		or p_content <> btrim(p_content)
		or char_length(p_content) not between 1 and 32768 then
		raise exception using errcode = '22023', message = 'invalid_chat_commit_input';
	end if;

	perform pg_catalog.pg_advisory_xact_lock(
		pg_catalog.hashtextextended(p_user_id::text || ':' || p_turn_id::text, 0)
	);

	select * into v_user_message
	from public.messages
	where user_id = p_user_id
		and conversation_id = p_conversation_id
		and turn_id = p_turn_id
		and role = 'user';

	if not found then
		raise exception using errcode = 'P0002', message = 'chat_turn_not_found';
	end if;

	select * into v_assistant_message
	from public.messages
	where user_id = p_user_id
		and conversation_id = p_conversation_id
		and turn_id = p_turn_id
		and role = 'assistant';

	if found then
		if v_assistant_message.content <> p_content then
			raise exception using errcode = '23505', message = 'chat_turn_commit_conflict';
		end if;
	else
		insert into public.messages (
			conversation_id,
			user_id,
			turn_id,
			role,
			content,
			created_at
		)
		values (
			p_conversation_id,
			p_user_id,
			p_turn_id,
			'assistant',
			p_content,
			v_now
		)
		returning * into v_assistant_message;
	end if;

	update public.conversations
	set updated_at = greatest(updated_at, v_assistant_message.created_at),
		last_message_at = greatest(last_message_at, v_assistant_message.created_at)
	where id = p_conversation_id
		and user_id = p_user_id
	returning * into v_conversation;

	if not found then
		raise exception using errcode = 'P0002', message = 'conversation_not_found';
	end if;

	return jsonb_build_object(
		'message', jsonb_build_object(
			'id', v_assistant_message.id,
			'conversationId', v_assistant_message.conversation_id,
			'turnId', v_assistant_message.turn_id,
			'role', v_assistant_message.role,
			'content', v_assistant_message.content,
			'createdAt', v_assistant_message.created_at
		),
		'conversation', jsonb_build_object(
			'id', v_conversation.id,
			'title', v_conversation.title,
			'createdAt', v_conversation.created_at,
			'updatedAt', v_conversation.updated_at,
			'lastMessageAt', v_conversation.last_message_at
		)
	);
end;
$$;

revoke execute on function public.begin_chat_turn(uuid, uuid, uuid, text, text, integer, integer)
	from public, anon, authenticated;
revoke execute on function public.commit_chat_turn(uuid, uuid, uuid, text)
	from public, anon, authenticated;
grant execute on function public.begin_chat_turn(uuid, uuid, uuid, text, text, integer, integer)
	to service_role;
grant execute on function public.commit_chat_turn(uuid, uuid, uuid, text)
	to service_role;

commit;
