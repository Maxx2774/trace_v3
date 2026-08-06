begin;

create table public.turns (
	id uuid primary key,
	conversation_id uuid not null,
	user_id uuid not null references auth.users(id) on delete cascade,
	status text not null,
	lease_expires_at timestamptz,
	created_at timestamptz not null default statement_timestamp(),
	completed_at timestamptz,
	constraint turns_id_conversation_user_key unique (id, conversation_id, user_id),
	constraint turns_conversation_owner_fkey
		foreign key (conversation_id, user_id)
		references public.conversations(id, user_id)
		on delete cascade,
	constraint turns_status_check check (
		status in ('processing', 'completed', 'failed_retryable', 'failed_terminal')
	),
	constraint turns_lifecycle_check check (
		(status = 'processing' and lease_expires_at is not null and completed_at is null)
		or (status = 'completed' and lease_expires_at is null and completed_at is not null)
		or (
			status in ('failed_retryable', 'failed_terminal')
			and lease_expires_at is null
			and completed_at is null
		)
	),
	constraint turns_completed_at_check check (
		completed_at is null or completed_at >= created_at
	)
);

insert into public.turns (
	id,
	conversation_id,
	user_id,
	status,
	lease_expires_at,
	created_at,
	completed_at
)
select
	turn_id,
	conversation_id,
	user_id,
	case when bool_or(role = 'assistant') then 'completed' else 'failed_retryable' end,
	null,
	min(created_at),
	max(created_at) filter (where role = 'assistant')
from public.messages
group by turn_id, conversation_id, user_id;

alter table public.messages
	add constraint messages_turn_owner_fkey
	foreign key (turn_id, conversation_id, user_id)
	references public.turns(id, conversation_id, user_id)
	on delete cascade;

create table public.meals (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references auth.users(id) on delete cascade,
	description text not null,
	source_turn_id uuid references public.turns(id) on delete set null,
	source_operation_id text not null,
	occurred_precision text not null,
	occurred_at timestamptz,
	occurred_on date,
	timezone text,
	time_expression text,
	created_at timestamptz not null default statement_timestamp(),
	updated_at timestamptz not null default statement_timestamp(),
	constraint meals_user_operation_key unique (user_id, source_operation_id),
	constraint meals_description_check check (
		description = btrim(description) and char_length(description) between 1 and 1000
	),
	constraint meals_source_operation_check check (
		char_length(source_operation_id) between 38 and 40
	),
	constraint meals_precision_check check (
		occurred_precision in ('exact', 'approximate', 'date', 'unknown')
	),
	constraint meals_time_expression_check check (
		time_expression is null
		or (time_expression = btrim(time_expression) and char_length(time_expression) between 1 and 160)
	),
	constraint meals_timezone_check check (
		timezone is null or char_length(timezone) between 1 and 255
	),
	constraint meals_occurrence_check check (
		(
			occurred_precision in ('exact', 'approximate')
			and occurred_at is not null
			and occurred_on is not null
			and timezone is not null
		)
		or (
			occurred_precision = 'date'
			and occurred_at is null
			and occurred_on is not null
			and timezone is not null
		)
		or (
			occurred_precision = 'unknown'
			and occurred_at is null
			and occurred_on is null
			and timezone is null
		)
	),
	constraint meals_updated_at_check check (updated_at >= created_at)
);

create table public.meal_ingredients (
	meal_id uuid not null references public.meals(id) on delete cascade,
	position integer not null,
	reported_text text not null,
	normalized_name text not null,
	primary key (meal_id, position),
	constraint meal_ingredients_position_check check (position between 0 and 49),
	constraint meal_ingredients_reported_text_check check (
		reported_text = btrim(reported_text) and char_length(reported_text) between 1 and 160
	),
	constraint meal_ingredients_normalized_name_check check (
		normalized_name = btrim(normalized_name) and char_length(normalized_name) between 1 and 160
	)
);

create index turns_conversation_owner_idx on public.turns (conversation_id, user_id);
create index turns_user_id_idx on public.turns (user_id);
create index messages_turn_owner_idx on public.messages (turn_id, conversation_id, user_id);
create index meals_source_turn_id_idx on public.meals (source_turn_id);
create index meals_user_occurred_idx
	on public.meals (user_id, occurred_on desc, occurred_at desc, id desc);
create index meals_user_unknown_idx
	on public.meals (user_id, created_at desc, id desc)
	where occurred_precision = 'unknown';

alter table public.turns enable row level security;
alter table public.meals enable row level security;
alter table public.meal_ingredients enable row level security;

create policy meals_select_own
	on public.meals
	for select
	to authenticated
	using ((select auth.uid()) = user_id);

create policy meal_ingredients_select_own
	on public.meal_ingredients
	for select
	to authenticated
	using (
		exists (
			select 1
			from public.meals
			where meals.id = meal_ingredients.meal_id
				and meals.user_id = (select auth.uid())
		)
	);

revoke all on table public.turns from anon, authenticated;
revoke all on table public.meals from anon, authenticated;
revoke all on table public.meal_ingredients from anon, authenticated;
grant select on table public.meals to authenticated;
grant select on table public.meal_ingredients to authenticated;

drop function public.begin_chat_turn(uuid, uuid, uuid, text, text, integer, integer);
drop function public.commit_chat_turn(uuid, uuid, uuid, text);

create function public.begin_chat_turn(
	p_user_id uuid,
	p_conversation_id uuid,
	p_turn_id uuid,
	p_content text,
	p_lease_duration_seconds integer default 120
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_now timestamptz := clock_timestamp();
	v_lease_expires_at timestamptz;
	v_conversation public.conversations%rowtype;
	v_turn public.turns%rowtype;
	v_user_message public.messages%rowtype;
	v_assistant_message public.messages%rowtype;
	v_title text;
	v_journal_records jsonb := '[]'::jsonb;
	v_created boolean := false;
begin
	if p_content is null
		or p_content <> btrim(p_content)
		or char_length(p_content) not between 1 and 5000
		or p_lease_duration_seconds not between 60 and 300 then
		raise exception using errcode = '22023', message = 'invalid_chat_turn_input';
	end if;

	perform pg_catalog.pg_advisory_xact_lock(
		pg_catalog.hashtextextended(p_user_id::text || ':' || p_turn_id::text, 0)
	);

	select * into v_turn
	from public.turns
	where id = p_turn_id;

	if found then
		if v_turn.user_id <> p_user_id
			or (p_conversation_id is not null and v_turn.conversation_id <> p_conversation_id) then
			return jsonb_build_object('status', 'conflict');
		end if;

		select * into v_user_message
		from public.messages
		where turn_id = p_turn_id and user_id = p_user_id and role = 'user';

		if not found or v_user_message.content <> p_content then
			return jsonb_build_object('status', 'conflict');
		end if;

		select * into v_conversation
		from public.conversations
		where id = v_turn.conversation_id and user_id = p_user_id;

		if v_turn.status = 'completed' then
			select * into v_assistant_message
			from public.messages
			where turn_id = p_turn_id and user_id = p_user_id and role = 'assistant';

			select coalesce(jsonb_agg(record order by source_operation_id), '[]'::jsonb)
			into v_journal_records
			from (
				select
					m.source_operation_id,
					jsonb_build_object(
						'turnId', p_turn_id,
						'record', jsonb_build_object(
							'kind', 'meal',
							'value', jsonb_build_object(
								'id', m.id,
								'description', m.description,
								'occurredPrecision', m.occurred_precision,
								'occurredAt', m.occurred_at,
								'occurredOn', m.occurred_on,
								'timezone', m.timezone,
								'timeExpression', m.time_expression,
								'createdAt', m.created_at,
								'ingredients', coalesce((
									select jsonb_agg(
										jsonb_build_object('reportedText', i.reported_text)
										order by i.position
									)
									from public.meal_ingredients i
									where i.meal_id = m.id
								), '[]'::jsonb)
							)
						)
					) as record
				from public.meals m
				where m.user_id = p_user_id and m.source_turn_id = p_turn_id
			) records;

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
				),
				'journalRecords', v_journal_records
			);
		end if;

		if v_turn.status = 'failed_terminal' then
			return jsonb_build_object('status', 'failed_terminal', 'code', 'turn_failed_terminal');
		end if;

		if v_turn.status = 'processing' and v_turn.lease_expires_at > clock_timestamp() then
			return jsonb_build_object('status', 'pending');
		end if;

		v_lease_expires_at := v_now + make_interval(secs => p_lease_duration_seconds);
		update public.turns
		set status = 'processing', lease_expires_at = v_lease_expires_at, completed_at = null
		where id = p_turn_id and user_id = p_user_id
		returning * into v_turn;
	else
		v_created := true;
		if p_conversation_id is null then
			v_title := btrim(left(regexp_replace(p_content, E'\\s+', ' ', 'g'), 80));
			insert into public.conversations (user_id, title, created_at, updated_at, last_message_at)
			values (p_user_id, v_title, v_now, v_now, v_now)
			returning * into v_conversation;
		else
			select * into v_conversation
			from public.conversations
			where id = p_conversation_id and user_id = p_user_id
			for update;

			if not found then
				return jsonb_build_object('status', 'not_found');
			end if;
		end if;

		v_lease_expires_at := v_now + make_interval(secs => p_lease_duration_seconds);
		insert into public.turns (
			id, conversation_id, user_id, status, lease_expires_at, created_at
		)
		values (
			p_turn_id, v_conversation.id, p_user_id, 'processing', v_lease_expires_at, v_now
		)
		returning * into v_turn;

		insert into public.messages (
			conversation_id, user_id, turn_id, role, content, created_at
		)
		values (
			v_conversation.id, p_user_id, p_turn_id, 'user', p_content, v_now
		)
		returning * into v_user_message;

		update public.conversations
		set updated_at = v_now, last_message_at = v_now
		where id = v_conversation.id and user_id = p_user_id
		returning * into v_conversation;
	end if;

	select coalesce(jsonb_agg(record order by source_operation_id), '[]'::jsonb)
	into v_journal_records
	from (
		select
			m.source_operation_id,
			jsonb_build_object(
				'turnId', p_turn_id,
				'record', jsonb_build_object(
					'kind', 'meal',
					'value', jsonb_build_object(
						'id', m.id,
						'description', m.description,
						'occurredPrecision', m.occurred_precision,
						'occurredAt', m.occurred_at,
						'occurredOn', m.occurred_on,
						'timezone', m.timezone,
						'timeExpression', m.time_expression,
						'createdAt', m.created_at,
						'ingredients', coalesce((
							select jsonb_agg(
								jsonb_build_object('reportedText', i.reported_text)
								order by i.position
							)
							from public.meal_ingredients i
							where i.meal_id = m.id
						), '[]'::jsonb)
					)
				)
			) as record
		from public.meals m
		where m.user_id = p_user_id and m.source_turn_id = p_turn_id
	) records;

	return jsonb_build_object(
		'status', case when v_created then 'created' else 'resumed' end,
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
		'leaseExpiresAt', v_turn.lease_expires_at,
		'journalRecords', v_journal_records
	);
end;
$$;

create function public.create_meal_from_chat(
	p_user_id uuid,
	p_source_turn_id uuid,
	p_lease_expires_at timestamptz,
	p_operation_index integer,
	p_description text,
	p_occurred_precision text,
	p_occurred_at timestamptz,
	p_occurred_on date,
	p_timezone text,
	p_time_expression text,
	p_ingredients jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_operation_id text := p_source_turn_id::text || ':' || p_operation_index::text;
	v_turn public.turns%rowtype;
	v_meal public.meals%rowtype;
	v_existing_ingredients jsonb;
	v_input_ingredients jsonb;
begin
	if p_operation_index not between 0 and 4
		or p_description is null
		or p_description <> btrim(p_description)
		or char_length(p_description) not between 1 and 1000
		or p_occurred_precision not in ('exact', 'approximate', 'date', 'unknown')
		or p_ingredients is null
		or jsonb_typeof(p_ingredients) <> 'array'
		or jsonb_array_length(p_ingredients) > 50
		or (p_time_expression is not null and (
			p_time_expression <> btrim(p_time_expression)
			or char_length(p_time_expression) not between 1 and 160
		)) then
		raise exception using errcode = '22023', message = 'invalid_meal_input';
	end if;

	if exists (
		select 1
		from jsonb_array_elements(p_ingredients) as input(ingredient)
		where jsonb_typeof(ingredient) <> 'object'
			or not ingredient ? 'reportedText'
			or not ingredient ? 'normalizedName'
			or exists (
				select 1 from jsonb_object_keys(ingredient) as keys(key)
				where key not in ('reportedText', 'normalizedName')
			)
			or ingredient ->> 'reportedText' <> btrim(ingredient ->> 'reportedText')
			or char_length(ingredient ->> 'reportedText') not between 1 and 160
			or ingredient ->> 'normalizedName' <> btrim(ingredient ->> 'normalizedName')
			or char_length(ingredient ->> 'normalizedName') not between 1 and 160
	) then
		raise exception using errcode = '22023', message = 'invalid_meal_ingredients';
	end if;

	if (
		p_occurred_precision in ('exact', 'approximate')
		and (p_occurred_at is null or p_occurred_on is null or p_timezone is null)
	) or (
		p_occurred_precision = 'date'
		and (p_occurred_at is not null or p_occurred_on is null or p_timezone is null)
	) or (
		p_occurred_precision = 'unknown'
		and (p_occurred_at is not null or p_occurred_on is not null or p_timezone is not null)
	) then
		raise exception using errcode = '22023', message = 'invalid_meal_occurrence';
	end if;

	if p_timezone is not null and not exists (
		select 1 from pg_catalog.pg_timezone_names where name = p_timezone
	) then
		raise exception using errcode = '22023', message = 'invalid_meal_timezone';
	end if;

	if p_occurred_at is not null
		and p_occurred_on <> (p_occurred_at at time zone p_timezone)::date then
		raise exception using errcode = '22023', message = 'meal_local_date_mismatch';
	end if;

	perform pg_catalog.pg_advisory_xact_lock(
		pg_catalog.hashtextextended(p_user_id::text || ':' || v_operation_id, 0)
	);

	select * into v_turn
	from public.turns
	where id = p_source_turn_id and user_id = p_user_id
	for update;

	if not found
		or v_turn.status <> 'processing'
		or v_turn.lease_expires_at is distinct from p_lease_expires_at
		or v_turn.lease_expires_at <= clock_timestamp() then
		raise exception using errcode = '55000', message = 'stale_chat_turn_lease';
	end if;

	select * into v_meal
	from public.meals
	where user_id = p_user_id and source_operation_id = v_operation_id;

	if found then
		select coalesce(jsonb_agg(
			jsonb_build_object(
				'reportedText', reported_text,
				'normalizedName', normalized_name
			) order by position
		), '[]'::jsonb)
		into v_existing_ingredients
		from public.meal_ingredients
		where meal_id = v_meal.id;

		select coalesce(jsonb_agg(
			jsonb_build_object(
				'reportedText', ingredient ->> 'reportedText',
				'normalizedName', ingredient ->> 'normalizedName'
			) order by ordinal
		), '[]'::jsonb)
		into v_input_ingredients
		from jsonb_array_elements(p_ingredients) with ordinality input(ingredient, ordinal);

		if v_meal.description is distinct from p_description
			or v_meal.source_turn_id is distinct from p_source_turn_id
			or v_meal.occurred_precision is distinct from p_occurred_precision
			or v_meal.occurred_at is distinct from p_occurred_at
			or v_meal.occurred_on is distinct from p_occurred_on
			or v_meal.timezone is distinct from p_timezone
			or v_meal.time_expression is distinct from p_time_expression
			or v_existing_ingredients is distinct from v_input_ingredients then
			raise exception using errcode = '23505', message = 'meal_operation_conflict';
		end if;
	else
		insert into public.meals (
			user_id,
			description,
			source_turn_id,
			source_operation_id,
			occurred_precision,
			occurred_at,
			occurred_on,
			timezone,
			time_expression
		)
		values (
			p_user_id,
			p_description,
			p_source_turn_id,
			v_operation_id,
			p_occurred_precision,
			p_occurred_at,
			p_occurred_on,
			p_timezone,
			p_time_expression
		)
		returning * into v_meal;

		insert into public.meal_ingredients (meal_id, position, reported_text, normalized_name)
		select
			v_meal.id,
			ordinal - 1,
			ingredient ->> 'reportedText',
			ingredient ->> 'normalizedName'
		from jsonb_array_elements(p_ingredients) with ordinality input(ingredient, ordinal);
	end if;

	return jsonb_build_object(
		'id', v_meal.id,
		'description', v_meal.description,
		'occurredPrecision', v_meal.occurred_precision,
		'occurredAt', v_meal.occurred_at,
		'occurredOn', v_meal.occurred_on,
		'timezone', v_meal.timezone,
		'timeExpression', v_meal.time_expression,
		'createdAt', v_meal.created_at,
		'ingredients', coalesce((
			select jsonb_agg(jsonb_build_object('reportedText', reported_text) order by position)
			from public.meal_ingredients
			where meal_id = v_meal.id
		), '[]'::jsonb)
	);
end;
$$;

create function public.complete_chat_turn(
	p_user_id uuid,
	p_turn_id uuid,
	p_lease_expires_at timestamptz,
	p_content text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_now timestamptz := clock_timestamp();
	v_turn public.turns%rowtype;
	v_conversation public.conversations%rowtype;
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

	select * into v_turn
	from public.turns
	where id = p_turn_id and user_id = p_user_id
	for update;

	if not found then
		raise exception using errcode = 'P0002', message = 'chat_turn_not_found';
	end if;

	select * into v_assistant_message
	from public.messages
	where turn_id = p_turn_id and user_id = p_user_id and role = 'assistant';

	if v_turn.status = 'completed' then
		if not found or v_assistant_message.content <> p_content then
			raise exception using errcode = '23505', message = 'chat_turn_commit_conflict';
		end if;
	elsif v_turn.status <> 'processing'
		or v_turn.lease_expires_at is distinct from p_lease_expires_at
		or v_turn.lease_expires_at <= clock_timestamp() then
		raise exception using errcode = '55000', message = 'stale_chat_turn_lease';
	else
		insert into public.messages (
			conversation_id, user_id, turn_id, role, content, created_at
		)
		values (
			v_turn.conversation_id, p_user_id, p_turn_id, 'assistant', p_content, v_now
		)
		returning * into v_assistant_message;

		update public.turns
		set status = 'completed', lease_expires_at = null, completed_at = v_now
		where id = p_turn_id and user_id = p_user_id;
	end if;

	update public.conversations
	set updated_at = greatest(updated_at, v_assistant_message.created_at),
		last_message_at = greatest(last_message_at, v_assistant_message.created_at)
	where id = v_turn.conversation_id and user_id = p_user_id
	returning * into v_conversation;

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

create function public.fail_chat_turn(
	p_user_id uuid,
	p_turn_id uuid,
	p_lease_expires_at timestamptz,
	p_retryable boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_status text := case when p_retryable then 'failed_retryable' else 'failed_terminal' end;
begin
	update public.turns
	set status = v_status, lease_expires_at = null, completed_at = null
	where id = p_turn_id
		and user_id = p_user_id
		and status = 'processing'
		and lease_expires_at = p_lease_expires_at
		and lease_expires_at > clock_timestamp();

	if not found then
		raise exception using errcode = '55000', message = 'stale_chat_turn_lease';
	end if;

	return jsonb_build_object('status', v_status);
end;
$$;

revoke execute on function public.begin_chat_turn(uuid, uuid, uuid, text, integer)
	from public, anon, authenticated;
revoke execute on function public.create_meal_from_chat(
	uuid, uuid, timestamptz, integer, text, text, timestamptz, date, text, text, jsonb
)
	from public, anon, authenticated;
revoke execute on function public.complete_chat_turn(uuid, uuid, timestamptz, text)
	from public, anon, authenticated;
revoke execute on function public.fail_chat_turn(uuid, uuid, timestamptz, boolean)
	from public, anon, authenticated;

grant execute on function public.begin_chat_turn(uuid, uuid, uuid, text, integer)
	to service_role;
grant execute on function public.create_meal_from_chat(
	uuid, uuid, timestamptz, integer, text, text, timestamptz, date, text, text, jsonb
)
	to service_role;
grant execute on function public.complete_chat_turn(uuid, uuid, timestamptz, text)
	to service_role;
grant execute on function public.fail_chat_turn(uuid, uuid, timestamptz, boolean)
	to service_role;

commit;
