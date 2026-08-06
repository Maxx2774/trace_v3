begin;

do $$
begin
	if exists (
		select 1
		from public.meals
		where description is null
			or description <> btrim(description)
			or char_length(description) not between 1 and 160
	) then
		raise exception using errcode = '22023', message = 'meal_description_preflight_failed';
	end if;

	if exists (
		select 1
		from public.meal_ingredients
		where reported_text is null
			or reported_text <> btrim(reported_text)
			or char_length(reported_text) not between 1 and 160
		or position not between 0 and 49
	) then
		raise exception using errcode = '22023', message = 'meal_ingredient_preflight_failed';
	end if;

	if exists (
		select 1
		from public.meal_ingredients
		group by meal_id
		having count(*) > 30
	) then
		raise exception using errcode = '22023', message = 'meal_ingredient_count_preflight_failed';
	end if;

	if exists (
		select 1
		from public.meals
		where (occurred_precision = 'approximate' and time_expression is null)
			or (occurred_precision = 'unknown' and time_expression is not null)
	) then
		raise exception using errcode = '22023', message = 'meal_occurrence_preflight_failed';
	end if;
end;
$$;

alter table public.meals
	add column meal_type text,
	add column revision integer not null default 1,
	add column source_input_hash text;

alter table public.meals
	add constraint meals_type_check check (
		meal_type is null or meal_type in ('breakfast', 'lunch', 'dinner', 'snack', 'other')
	),
	add constraint meals_revision_check check (revision > 0),
	add constraint meals_source_input_hash_check check (
		source_input_hash is null or source_input_hash ~ '^[0-9a-f]{64}$'
	);

alter table public.meals drop constraint meals_occurrence_check;
alter table public.meals add constraint meals_occurrence_check check (
	(
		occurred_precision = 'exact'
		and occurred_at is not null
		and occurred_on is not null
		and timezone is not null
	)
	or (
		occurred_precision = 'approximate'
		and occurred_on is not null
		and timezone is not null
		and time_expression is not null
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
		and time_expression is null
	)
);

create table public.meal_items (
	id uuid primary key default gen_random_uuid(),
	meal_id uuid not null references public.meals(id) on delete cascade,
	position integer not null,
	name text not null,
	amount_text text,
	created_at timestamptz not null default statement_timestamp(),
	updated_at timestamptz not null default statement_timestamp(),
	constraint meal_items_meal_position_unique
		unique (meal_id, position)
		deferrable initially deferred,
	constraint meal_items_position_check check (position between 0 and 49),
	constraint meal_items_name_check check (
		name = btrim(name) and char_length(name) between 1 and 160
	),
	constraint meal_items_amount_text_check check (
		amount_text is null
		or (amount_text = btrim(amount_text) and char_length(amount_text) between 1 and 80)
	),
	constraint meal_items_updated_at_check check (updated_at >= created_at)
);

create table public.meal_item_ingredients (
	id uuid primary key default gen_random_uuid(),
	meal_item_id uuid not null references public.meal_items(id) on delete cascade,
	position integer not null,
	name text not null,
	amount_text text,
	created_at timestamptz not null default statement_timestamp(),
	updated_at timestamptz not null default statement_timestamp(),
	constraint meal_item_ingredients_item_position_unique
		unique (meal_item_id, position)
		deferrable initially deferred,
	constraint meal_item_ingredients_position_check check (position between 0 and 49),
	constraint meal_item_ingredients_name_check check (
		name = btrim(name) and char_length(name) between 1 and 160
	),
	constraint meal_item_ingredients_amount_text_check check (
		amount_text is null
		or (amount_text = btrim(amount_text) and char_length(amount_text) between 1 and 80)
	),
	constraint meal_item_ingredients_updated_at_check check (updated_at >= created_at)
);

create table public.meal_update_receipts (
	user_id uuid not null references auth.users(id) on delete cascade,
	client_mutation_id uuid not null,
	meal_id uuid not null references public.meals(id) on delete cascade,
	input_hash text not null,
	previous_revision integer not null,
	new_revision integer not null,
	result jsonb not null,
	source text not null,
	created_at timestamptz not null default statement_timestamp(),
	primary key (user_id, client_mutation_id),
	constraint meal_update_receipts_hash_check check (input_hash ~ '^[0-9a-f]{64}$'),
	constraint meal_update_receipts_revision_check check (
		previous_revision > 0 and new_revision = previous_revision + 1
	),
	constraint meal_update_receipts_source_check check (source = 'meal_card')
);

create index meal_update_receipts_meal_id_idx
	on public.meal_update_receipts (meal_id);

insert into public.meal_items (
	meal_id,
	position,
	name,
	amount_text,
	created_at,
	updated_at
)
select id, 0, description, null, created_at, updated_at
from public.meals;

insert into public.meal_item_ingredients (
	meal_item_id,
	position,
	name,
	amount_text,
	created_at,
	updated_at
)
select item.id, ingredient.position, ingredient.reported_text, null, meal.created_at, meal.updated_at
from public.meal_ingredients ingredient
join public.meals meal on meal.id = ingredient.meal_id
join public.meal_items item on item.meal_id = meal.id and item.position = 0;

do $$
begin
	if (select count(*) from public.meal_items) <> (select count(*) from public.meals) then
		raise exception using errcode = 'P0001', message = 'meal_item_backfill_count_mismatch';
	end if;

	if (select count(*) from public.meal_item_ingredients)
		<> (select count(*) from public.meal_ingredients) then
		raise exception using errcode = 'P0001', message = 'meal_ingredient_backfill_count_mismatch';
	end if;
end;
$$;

alter table public.meal_items enable row level security;
alter table public.meal_item_ingredients enable row level security;
alter table public.meal_update_receipts enable row level security;

create policy meal_items_select_own
	on public.meal_items
	for select
	to authenticated
	using (
		exists (
			select 1
			from public.meals
			where meals.id = meal_items.meal_id
				and meals.user_id = (select auth.uid())
		)
	);

create policy meal_item_ingredients_select_own
	on public.meal_item_ingredients
	for select
	to authenticated
	using (
		exists (
			select 1
			from public.meal_items
			join public.meals on meals.id = meal_items.meal_id
			where meal_items.id = meal_item_ingredients.meal_item_id
				and meals.user_id = (select auth.uid())
		)
	);

revoke all on table public.meal_items from anon, authenticated;
revoke all on table public.meal_item_ingredients from anon, authenticated;
revoke all on table public.meal_update_receipts from anon, authenticated;
grant select on table public.meal_items to authenticated;
grant select on table public.meal_item_ingredients to authenticated;
grant all on table public.meal_items to service_role;
grant all on table public.meal_item_ingredients to service_role;
grant all on table public.meal_update_receipts to service_role;

create function public.meal_record_json(p_meal_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
	select jsonb_build_object(
		'id', meal.id,
		'revision', meal.revision,
		'mealType', meal.meal_type,
		'occurrence', jsonb_build_object(
			'precision', meal.occurred_precision,
			'occurredAt', meal.occurred_at,
			'occurredOn', meal.occurred_on,
			'timezone', meal.timezone,
			'timeExpression', meal.time_expression
		),
		'createdAt', meal.created_at,
		'updatedAt', meal.updated_at,
		'items', coalesce((
			select jsonb_agg(
				jsonb_build_object(
					'id', item.id,
					'name', item.name,
					'amountText', item.amount_text,
					'ingredients', coalesce((
						select jsonb_agg(
							jsonb_build_object(
								'id', ingredient.id,
								'name', ingredient.name,
								'amountText', ingredient.amount_text
							)
							order by ingredient.position
						)
						from public.meal_item_ingredients ingredient
						where ingredient.meal_item_id = item.id
					), '[]'::jsonb)
				)
				order by item.position
			)
			from public.meal_items item
			where item.meal_id = meal.id
		), '[]'::jsonb)
	)
	from public.meals meal
	where meal.id = p_meal_id;
$$;

create or replace function public.begin_chat_turn(
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
					meal.source_operation_id,
					jsonb_build_object(
						'turnId', p_turn_id,
						'record', jsonb_build_object(
							'kind', 'meal',
							'reference', jsonb_build_object(
								'type', 'meal',
								'recordId', meal.id,
								'committedRevision', 1
							),
							'value', public.meal_record_json(meal.id)
						)
					) as record
				from public.meals meal
				where meal.user_id = p_user_id and meal.source_turn_id = p_turn_id
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
			meal.source_operation_id,
			jsonb_build_object(
				'turnId', p_turn_id,
				'record', jsonb_build_object(
					'kind', 'meal',
					'reference', jsonb_build_object(
						'type', 'meal',
						'recordId', meal.id,
						'committedRevision', 1
					),
					'value', public.meal_record_json(meal.id)
				)
			) as record
		from public.meals meal
		where meal.user_id = p_user_id and meal.source_turn_id = p_turn_id
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

drop function public.create_meal_from_chat(
	uuid, uuid, timestamptz, integer, text, text, timestamptz, date, text, text, jsonb
);
drop function public.update_meal(uuid, uuid, text, jsonb);

create function public.create_meal_from_chat(
	p_user_id uuid,
	p_source_turn_id uuid,
	p_lease_expires_at timestamptz,
	p_operation_index integer,
	p_meal_type text,
	p_occurred_precision text,
	p_occurred_at timestamptz,
	p_occurred_on date,
	p_timezone text,
	p_time_expression text,
	p_items jsonb
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
	v_local_date date;
	v_payload jsonb;
	v_input_hash text;
begin
	if p_operation_index not between 0 and 4
		or (p_meal_type is not null and p_meal_type not in ('breakfast', 'lunch', 'dinner', 'snack', 'other'))
		or p_occurred_precision not in ('exact', 'approximate', 'date', 'unknown')
		or p_items is null
		or jsonb_typeof(p_items) <> 'array'
		or jsonb_array_length(p_items) not between 1 and 20
		or (p_timezone is not null and char_length(p_timezone) not between 1 and 255)
		or (p_time_expression is not null and (
			p_time_expression <> btrim(p_time_expression)
			or char_length(p_time_expression) not between 1 and 160
		)) then
		raise exception using errcode = '22023', message = 'invalid_meal_input';
	end if;

	if exists (
		select 1
		from jsonb_array_elements(p_items) item
		where jsonb_typeof(item) <> 'object'
			or not item ?& array['name', 'amountText', 'ingredients']
			or exists (
				select 1
				from jsonb_object_keys(item) as keys(key)
				where key not in ('name', 'amountText', 'ingredients')
			)
			or jsonb_typeof(item -> 'name') <> 'string'
			or item ->> 'name' <> btrim(item ->> 'name')
			or char_length(item ->> 'name') not between 1 and 160
			or not (
				item -> 'amountText' = 'null'::jsonb
				or (
					jsonb_typeof(item -> 'amountText') = 'string'
					and item ->> 'amountText' = btrim(item ->> 'amountText')
					and char_length(item ->> 'amountText') between 1 and 80
				)
			)
			or jsonb_typeof(item -> 'ingredients') <> 'array'
			or jsonb_array_length(item -> 'ingredients') > 30
	) or exists (
		select 1
		from jsonb_array_elements(p_items) item,
			jsonb_array_elements(item -> 'ingredients') ingredient
		where jsonb_typeof(ingredient) <> 'object'
			or not ingredient ?& array['name', 'amountText']
			or exists (
				select 1
				from jsonb_object_keys(ingredient) as keys(key)
				where key not in ('name', 'amountText')
			)
			or jsonb_typeof(ingredient -> 'name') <> 'string'
			or ingredient ->> 'name' <> btrim(ingredient ->> 'name')
			or char_length(ingredient ->> 'name') not between 1 and 160
			or not (
				ingredient -> 'amountText' = 'null'::jsonb
				or (
					jsonb_typeof(ingredient -> 'amountText') = 'string'
					and ingredient ->> 'amountText' = btrim(ingredient ->> 'amountText')
					and char_length(ingredient ->> 'amountText') between 1 and 80
				)
			)
	) or (
		select coalesce(sum(jsonb_array_length(item -> 'ingredients')), 0)
		from jsonb_array_elements(p_items) item
	) > 100 then
		raise exception using errcode = '22023', message = 'invalid_meal_items';
	end if;

	if p_timezone is not null and not exists (
		select 1 from pg_catalog.pg_timezone_names where name = p_timezone
	) then
		raise exception using errcode = '22023', message = 'invalid_meal_timezone';
	end if;

	if p_occurred_precision = 'exact' then
		if p_occurred_at is null or p_occurred_on is not null or p_timezone is null then
			raise exception using errcode = '22023', message = 'invalid_meal_occurrence';
		end if;
		v_local_date := (p_occurred_at at time zone p_timezone)::date;
	elsif p_occurred_precision = 'approximate' then
		if p_timezone is null or p_time_expression is null then
			raise exception using errcode = '22023', message = 'invalid_meal_occurrence';
		end if;
		if p_occurred_at is not null then
			if p_occurred_on is not null then
				raise exception using errcode = '22023', message = 'invalid_meal_occurrence';
			end if;
			v_local_date := (p_occurred_at at time zone p_timezone)::date;
		else
			if p_occurred_on is null then
				raise exception using errcode = '22023', message = 'invalid_meal_occurrence';
			end if;
			v_local_date := p_occurred_on;
		end if;
	elsif p_occurred_precision = 'date' then
		if p_occurred_at is not null or p_occurred_on is null or p_timezone is null then
			raise exception using errcode = '22023', message = 'invalid_meal_occurrence';
		end if;
		v_local_date := p_occurred_on;
	else
		if p_occurred_at is not null or p_occurred_on is not null or p_timezone is not null
			or p_time_expression is not null then
			raise exception using errcode = '22023', message = 'invalid_meal_occurrence';
		end if;
		v_local_date := null;
	end if;

	v_payload := jsonb_build_object(
		'mealType', p_meal_type,
		'occurrence', jsonb_build_object(
			'precision', p_occurred_precision,
			'occurredAt', p_occurred_at,
			'occurredOn', v_local_date,
			'timezone', p_timezone,
			'timeExpression', p_time_expression
		),
		'items', p_items
	);
	if octet_length(pg_catalog.convert_to(v_payload::text, 'UTF8')) > 32768 then
		raise exception using errcode = '22023', message = 'meal_payload_too_large';
	end if;
	v_input_hash := pg_catalog.encode(
		pg_catalog.sha256(pg_catalog.convert_to(v_payload::text, 'UTF8')),
		'hex'
	);

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
		if v_meal.source_input_hash is distinct from v_input_hash then
			raise exception using errcode = '23505', message = 'meal_operation_conflict';
		end if;
	else
		insert into public.meals (
			user_id,
			meal_type,
			source_turn_id,
			source_operation_id,
			source_input_hash,
			occurred_precision,
			occurred_at,
			occurred_on,
			timezone,
			time_expression
		)
		values (
			p_user_id,
			p_meal_type,
			p_source_turn_id,
			v_operation_id,
			v_input_hash,
			p_occurred_precision,
			p_occurred_at,
			v_local_date,
			p_timezone,
			p_time_expression
		)
		returning * into v_meal;

		insert into public.meal_items (meal_id, position, name, amount_text)
		select
			v_meal.id,
			ordinal - 1,
			item ->> 'name',
			case when item -> 'amountText' = 'null'::jsonb then null else item ->> 'amountText' end
		from jsonb_array_elements(p_items) with ordinality input(item, ordinal);

		insert into public.meal_item_ingredients (
			meal_item_id, position, name, amount_text
		)
		select
			meal_item.id,
			ingredient_ordinal - 1,
			ingredient ->> 'name',
			case
				when ingredient -> 'amountText' = 'null'::jsonb then null
				else ingredient ->> 'amountText'
			end
		from jsonb_array_elements(p_items) with ordinality item_input(item, item_ordinal)
		join public.meal_items meal_item
			on meal_item.meal_id = v_meal.id and meal_item.position = item_ordinal - 1
		cross join lateral jsonb_array_elements(item -> 'ingredients')
			with ordinality ingredient_input(ingredient, ingredient_ordinal);
	end if;

	return public.meal_record_json(v_meal.id);
end;
$$;

create function public.update_meal(
	p_user_id uuid,
	p_meal_id uuid,
	p_expected_revision integer,
	p_client_mutation_id uuid,
	p_meal_type text,
	p_occurred_precision text,
	p_occurred_at timestamptz,
	p_occurred_on date,
	p_timezone text,
	p_time_expression text,
	p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_meal public.meals%rowtype;
	v_receipt public.meal_update_receipts%rowtype;
	v_local_date date;
	v_payload jsonb;
	v_input_hash text;
	v_result jsonb;
	v_now timestamptz := clock_timestamp();
	v_item_entry record;
	v_ingredient_entry record;
	v_item_id uuid;
	v_ingredient_id uuid;
	v_item_ids uuid[] := array[]::uuid[];
	v_ingredient_ids uuid[] := array[]::uuid[];
begin
	if p_expected_revision < 1
		or p_client_mutation_id is null
		or (p_meal_type is not null and p_meal_type not in ('breakfast', 'lunch', 'dinner', 'snack', 'other'))
		or p_occurred_precision not in ('exact', 'approximate', 'date', 'unknown')
		or p_items is null
		or jsonb_typeof(p_items) <> 'array'
		or jsonb_array_length(p_items) not between 1 and 20
		or (p_timezone is not null and char_length(p_timezone) not between 1 and 255)
		or (p_time_expression is not null and (
			p_time_expression <> btrim(p_time_expression)
			or char_length(p_time_expression) not between 1 and 160
		)) then
		raise exception using errcode = '22023', message = 'invalid_meal_update';
	end if;

	if exists (
		select 1
		from jsonb_array_elements(p_items) item
		where jsonb_typeof(item) <> 'object'
			or not item ?& array['id', 'name', 'amountText', 'ingredients']
			or exists (
				select 1 from jsonb_object_keys(item) as keys(key)
				where key not in ('id', 'name', 'amountText', 'ingredients')
			)
			or not (
				item -> 'id' = 'null'::jsonb
				or (
					jsonb_typeof(item -> 'id') = 'string'
					and item ->> 'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
				)
			)
			or jsonb_typeof(item -> 'name') <> 'string'
			or item ->> 'name' <> btrim(item ->> 'name')
			or char_length(item ->> 'name') not between 1 and 160
			or not (
				item -> 'amountText' = 'null'::jsonb
				or (
					jsonb_typeof(item -> 'amountText') = 'string'
					and item ->> 'amountText' = btrim(item ->> 'amountText')
					and char_length(item ->> 'amountText') between 1 and 80
				)
			)
			or jsonb_typeof(item -> 'ingredients') <> 'array'
			or jsonb_array_length(item -> 'ingredients') > 30
	) or exists (
		select 1
		from jsonb_array_elements(p_items) item,
			jsonb_array_elements(item -> 'ingredients') ingredient
		where jsonb_typeof(ingredient) <> 'object'
			or not ingredient ?& array['id', 'name', 'amountText']
			or exists (
				select 1 from jsonb_object_keys(ingredient) as keys(key)
				where key not in ('id', 'name', 'amountText')
			)
			or not (
				ingredient -> 'id' = 'null'::jsonb
				or (
					jsonb_typeof(ingredient -> 'id') = 'string'
					and ingredient ->> 'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
				)
			)
			or jsonb_typeof(ingredient -> 'name') <> 'string'
			or ingredient ->> 'name' <> btrim(ingredient ->> 'name')
			or char_length(ingredient ->> 'name') not between 1 and 160
			or not (
				ingredient -> 'amountText' = 'null'::jsonb
				or (
					jsonb_typeof(ingredient -> 'amountText') = 'string'
					and ingredient ->> 'amountText' = btrim(ingredient ->> 'amountText')
					and char_length(ingredient ->> 'amountText') between 1 and 80
				)
			)
	) or (
		select coalesce(sum(jsonb_array_length(item -> 'ingredients')), 0)
		from jsonb_array_elements(p_items) item
	) > 100 then
		raise exception using errcode = '22023', message = 'invalid_meal_items';
	end if;

	if exists (
		select item ->> 'id'
		from jsonb_array_elements(p_items) item
		where item -> 'id' <> 'null'::jsonb
		group by item ->> 'id'
		having count(*) > 1
	) or exists (
		select ingredient ->> 'id'
		from jsonb_array_elements(p_items) item,
			jsonb_array_elements(item -> 'ingredients') ingredient
		where ingredient -> 'id' <> 'null'::jsonb
		group by ingredient ->> 'id'
		having count(*) > 1
	) then
		raise exception using errcode = '22023', message = 'duplicate_meal_object_id';
	end if;

	if p_timezone is not null and not exists (
		select 1 from pg_catalog.pg_timezone_names where name = p_timezone
	) then
		raise exception using errcode = '22023', message = 'invalid_meal_timezone';
	end if;

	if p_occurred_precision = 'exact' then
		if p_occurred_at is null or p_occurred_on is not null or p_timezone is null then
			raise exception using errcode = '22023', message = 'invalid_meal_occurrence';
		end if;
		v_local_date := (p_occurred_at at time zone p_timezone)::date;
	elsif p_occurred_precision = 'approximate' then
		if p_timezone is null or p_time_expression is null then
			raise exception using errcode = '22023', message = 'invalid_meal_occurrence';
		end if;
		if p_occurred_at is not null then
			if p_occurred_on is not null then
				raise exception using errcode = '22023', message = 'invalid_meal_occurrence';
			end if;
			v_local_date := (p_occurred_at at time zone p_timezone)::date;
		else
			if p_occurred_on is null then
				raise exception using errcode = '22023', message = 'invalid_meal_occurrence';
			end if;
			v_local_date := p_occurred_on;
		end if;
	elsif p_occurred_precision = 'date' then
		if p_occurred_at is not null or p_occurred_on is null or p_timezone is null then
			raise exception using errcode = '22023', message = 'invalid_meal_occurrence';
		end if;
		v_local_date := p_occurred_on;
	else
		if p_occurred_at is not null or p_occurred_on is not null or p_timezone is not null
			or p_time_expression is not null then
			raise exception using errcode = '22023', message = 'invalid_meal_occurrence';
		end if;
		v_local_date := null;
	end if;

	v_payload := jsonb_build_object(
		'id', p_meal_id,
		'expectedRevision', p_expected_revision,
		'mealType', p_meal_type,
		'occurrence', jsonb_build_object(
			'precision', p_occurred_precision,
			'occurredAt', p_occurred_at,
			'occurredOn', v_local_date,
			'timezone', p_timezone,
			'timeExpression', p_time_expression
		),
		'items', p_items
	);
	if octet_length(pg_catalog.convert_to(v_payload::text, 'UTF8')) > 32768 then
		raise exception using errcode = '22023', message = 'meal_payload_too_large';
	end if;
	v_input_hash := pg_catalog.encode(
		pg_catalog.sha256(pg_catalog.convert_to(v_payload::text, 'UTF8')),
		'hex'
	);

	perform pg_catalog.pg_advisory_xact_lock(
		pg_catalog.hashtextextended(p_user_id::text || ':' || p_client_mutation_id::text, 0)
	);

	select * into v_receipt
	from public.meal_update_receipts
	where user_id = p_user_id and client_mutation_id = p_client_mutation_id;

	if found then
		if v_receipt.meal_id is distinct from p_meal_id
			or v_receipt.input_hash is distinct from v_input_hash then
			raise exception using errcode = '23505', message = 'meal_mutation_id_conflict';
		end if;
		return v_receipt.result;
	end if;

	select * into v_meal
	from public.meals
	where id = p_meal_id and user_id = p_user_id
	for update;

	if not found then
		raise exception using errcode = 'P0002', message = 'meal_not_found';
	end if;
	if v_meal.revision <> p_expected_revision then
		raise exception using errcode = '40001', message = 'meal_revision_conflict';
	end if;

	if exists (
		select 1
		from jsonb_array_elements(p_items) item
		left join public.meal_items existing
			on existing.id = (item ->> 'id')::uuid and existing.meal_id = p_meal_id
		where item -> 'id' <> 'null'::jsonb and existing.id is null
	) or exists (
		select 1
		from jsonb_array_elements(p_items) item,
			jsonb_array_elements(item -> 'ingredients') ingredient
		left join public.meal_item_ingredients existing
			on existing.id = (ingredient ->> 'id')::uuid
		left join public.meal_items parent
			on parent.id = existing.meal_item_id
		where ingredient -> 'id' <> 'null'::jsonb
			and (
				item -> 'id' = 'null'::jsonb
				or existing.id is null
				or existing.meal_item_id <> (item ->> 'id')::uuid
				or parent.meal_id <> p_meal_id
			)
	) then
		raise exception using errcode = '22023', message = 'meal_object_ownership_mismatch';
	end if;

	for v_item_entry in
		select item, (ordinal - 1)::integer as position
		from jsonb_array_elements(p_items) with ordinality input(item, ordinal)
	loop
		if v_item_entry.item -> 'id' = 'null'::jsonb then
			insert into public.meal_items (meal_id, position, name, amount_text, created_at, updated_at)
			values (
				p_meal_id,
				v_item_entry.position,
				v_item_entry.item ->> 'name',
				case
					when v_item_entry.item -> 'amountText' = 'null'::jsonb then null
					else v_item_entry.item ->> 'amountText'
				end,
				v_now,
				v_now
			)
			returning id into v_item_id;
		else
			v_item_id := (v_item_entry.item ->> 'id')::uuid;
			update public.meal_items
			set
				position = v_item_entry.position,
				name = v_item_entry.item ->> 'name',
				amount_text = case
					when v_item_entry.item -> 'amountText' = 'null'::jsonb then null
					else v_item_entry.item ->> 'amountText'
				end,
				updated_at = v_now
			where id = v_item_id and meal_id = p_meal_id;
		end if;
		v_item_ids := array_append(v_item_ids, v_item_id);

		for v_ingredient_entry in
			select ingredient, (ordinal - 1)::integer as position
			from jsonb_array_elements(v_item_entry.item -> 'ingredients')
				with ordinality input(ingredient, ordinal)
		loop
			if v_ingredient_entry.ingredient -> 'id' = 'null'::jsonb then
				insert into public.meal_item_ingredients (
					meal_item_id, position, name, amount_text, created_at, updated_at
				)
				values (
					v_item_id,
					v_ingredient_entry.position,
					v_ingredient_entry.ingredient ->> 'name',
					case
						when v_ingredient_entry.ingredient -> 'amountText' = 'null'::jsonb then null
						else v_ingredient_entry.ingredient ->> 'amountText'
					end,
					v_now,
					v_now
				)
				returning id into v_ingredient_id;
			else
				v_ingredient_id := (v_ingredient_entry.ingredient ->> 'id')::uuid;
				update public.meal_item_ingredients
				set
					position = v_ingredient_entry.position,
					name = v_ingredient_entry.ingredient ->> 'name',
					amount_text = case
						when v_ingredient_entry.ingredient -> 'amountText' = 'null'::jsonb then null
						else v_ingredient_entry.ingredient ->> 'amountText'
					end,
					updated_at = v_now
				where id = v_ingredient_id and meal_item_id = v_item_id;
			end if;
			v_ingredient_ids := array_append(v_ingredient_ids, v_ingredient_id);
		end loop;
	end loop;

	delete from public.meal_item_ingredients ingredient
	using public.meal_items item
	where ingredient.meal_item_id = item.id
		and item.meal_id = p_meal_id
		and not (ingredient.id = any(v_ingredient_ids));

	delete from public.meal_items
	where meal_id = p_meal_id and not (id = any(v_item_ids));

	update public.meals
	set
		meal_type = p_meal_type,
		occurred_precision = p_occurred_precision,
		occurred_at = p_occurred_at,
		occurred_on = v_local_date,
		timezone = p_timezone,
		time_expression = p_time_expression,
		revision = revision + 1,
		updated_at = v_now
	where id = p_meal_id and user_id = p_user_id
	returning * into v_meal;

	v_result := public.meal_record_json(p_meal_id);
	insert into public.meal_update_receipts (
		user_id,
		client_mutation_id,
		meal_id,
		input_hash,
		previous_revision,
		new_revision,
		result,
		source,
		created_at
	)
	values (
		p_user_id,
		p_client_mutation_id,
		p_meal_id,
		v_input_hash,
		p_expected_revision,
		v_meal.revision,
		v_result,
		'meal_card',
		v_now
	);

	return v_result;
end;
$$;

drop policy meal_ingredients_select_own on public.meal_ingredients;
drop table public.meal_ingredients;
alter table public.meals drop column description;

revoke execute on function public.meal_record_json(uuid) from public, anon, authenticated;
revoke execute on function public.begin_chat_turn(uuid, uuid, uuid, text, integer)
	from public, anon, authenticated;
revoke execute on function public.create_meal_from_chat(
	uuid, uuid, timestamptz, integer, text, text, timestamptz, date, text, text, jsonb
) from public, anon, authenticated;
revoke execute on function public.update_meal(
	uuid, uuid, integer, uuid, text, text, timestamptz, date, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.meal_record_json(uuid) to service_role;
grant execute on function public.begin_chat_turn(uuid, uuid, uuid, text, integer) to service_role;
grant execute on function public.create_meal_from_chat(
	uuid, uuid, timestamptz, integer, text, text, timestamptz, date, text, text, jsonb
) to service_role;
grant execute on function public.update_meal(
	uuid, uuid, integer, uuid, text, text, timestamptz, date, text, text, jsonb
) to service_role;

commit;
