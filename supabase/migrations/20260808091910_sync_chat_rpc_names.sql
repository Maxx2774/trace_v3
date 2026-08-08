begin;

drop function public.create_meal_from_chat(
	uuid, uuid, timestamptz, integer, text, text, timestamptz, date, text, text, jsonb
);
drop function public.resolve_meal_duplicate_interaction(
	uuid, uuid, timestamptz, integer, uuid, text, text
);
drop function public.complete_chat_turn(uuid, uuid, timestamptz, text);
drop function public.fail_chat_turn(uuid, uuid, timestamptz, boolean);

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
		'turnLeaseExpiresAt', v_turn.lease_expires_at,
		'journalRecords', v_journal_records
	);
end;
$$;

create or replace function public.create_meal_from_chat(
	p_user_id uuid,
	p_source_turn_id uuid,
	p_turn_lease_expires_at timestamptz,
	p_tool_call_index integer,
	p_meal_type text,
	p_occurred_precision text,
	p_occurred_at timestamptz,
	p_occurred_on date,
	p_timezone text,
	p_time_period text,
	p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_operation_id text := p_source_turn_id::text || ':' || p_tool_call_index::text;
	v_turn public.turns%rowtype;
	v_meal public.meals%rowtype;
	v_interaction public.pending_interactions%rowtype;
	v_local_date date;
	v_proposal jsonb;
	v_input_hash text;
	v_duplicate jsonb;
	v_payload jsonb;
	v_replayed boolean := false;
begin
	if p_tool_call_index not between 0 and 4
		or (p_meal_type is not null and p_meal_type not in ('breakfast', 'lunch', 'dinner', 'snack', 'other'))
		or p_occurred_precision not in ('exact', 'approximate', 'date', 'unknown')
		or p_items is null
		or jsonb_typeof(p_items) <> 'array'
		or jsonb_array_length(p_items) not between 1 and 20
		or (p_timezone is not null and char_length(p_timezone) not between 1 and 255)
		or (p_time_period is not null and p_time_period not in (
			'morning', 'lunch', 'afternoon', 'evening', 'night'
		)) then
		raise exception using errcode = '22023', message = 'invalid_meal_input';
	end if;

	if exists (
		select 1
		from jsonb_array_elements(p_items) item
		where jsonb_typeof(item) <> 'object'
			or not item ?& array['name', 'amountText', 'ingredients']
			or exists (
				select 1 from jsonb_object_keys(item) keys(key)
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
				select 1 from jsonb_object_keys(ingredient) keys(key)
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
		if p_occurred_at is null or p_occurred_on is not null or p_timezone is null
			or p_time_period is not null then
			raise exception using errcode = '22023', message = 'invalid_meal_occurrence';
		end if;
		v_local_date := (p_occurred_at at time zone p_timezone)::date;
	elsif p_occurred_precision = 'approximate' then
		if p_timezone is null then
			raise exception using errcode = '22023', message = 'invalid_meal_occurrence';
		end if;
		if p_occurred_at is not null then
			if p_occurred_on is not null or p_time_period is not null then
				raise exception using errcode = '22023', message = 'invalid_meal_occurrence';
			end if;
			v_local_date := (p_occurred_at at time zone p_timezone)::date;
		else
			if p_occurred_on is null or p_time_period is null then
				raise exception using errcode = '22023', message = 'invalid_meal_occurrence';
			end if;
			v_local_date := p_occurred_on;
		end if;
	elsif p_occurred_precision = 'date' then
		if p_occurred_at is not null or p_occurred_on is null or p_timezone is null
			or p_time_period is not null then
			raise exception using errcode = '22023', message = 'invalid_meal_occurrence';
		end if;
		v_local_date := p_occurred_on;
	else
		if p_occurred_at is not null or p_occurred_on is not null or p_timezone is not null
			or p_time_period is not null then
			raise exception using errcode = '22023', message = 'invalid_meal_occurrence';
		end if;
		v_local_date := null;
	end if;

	v_proposal := jsonb_build_object(
		'mealType', p_meal_type,
		'occurrence', jsonb_build_object(
			'precision', p_occurred_precision,
			'occurredAt', p_occurred_at,
			'occurredOn', v_local_date,
			'timezone', p_timezone,
			'timePeriod', p_time_period
		),
		'items', p_items
	);
	if octet_length(pg_catalog.convert_to(v_proposal::text, 'UTF8')) > 32768 then
		raise exception using errcode = '22023', message = 'meal_payload_too_large';
	end if;
	v_input_hash := pg_catalog.encode(
		pg_catalog.sha256(pg_catalog.convert_to(v_proposal::text, 'UTF8')),
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
		or v_turn.lease_expires_at is distinct from p_turn_lease_expires_at
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
		return jsonb_build_object(
			'status', 'created',
			'meal', public.meal_record_json(v_meal.id),
			'replayed', true
		);
	end if;

	select * into v_interaction
	from public.pending_interactions
	where user_id = p_user_id and proposal_operation_id = v_operation_id;
	if found then
		if v_interaction.proposal_input_hash is distinct from v_input_hash then
			raise exception using errcode = '23505', message = 'meal_operation_conflict';
		end if;
		return jsonb_build_object(
			'status', 'confirmation_required',
			'interaction', public.pending_interaction_json(v_interaction.id),
			'replayed', true
		);
	end if;

	if v_local_date is not null then
		perform pg_catalog.pg_advisory_xact_lock(
			pg_catalog.hashtextextended(p_user_id::text || ':' || v_local_date::text, 0)
		);
		v_duplicate := public.find_meal_duplicate_v1(
			p_user_id,
			p_meal_type,
			p_occurred_precision,
			p_occurred_at,
			v_local_date,
			p_timezone,
			p_time_period,
			p_items
		);
	else
		v_duplicate := null;
	end if;

	if v_duplicate is not null then
		v_payload := jsonb_build_object(
			'proposedMeal', v_proposal,
			'existingMealSnapshot', v_duplicate -> 'primaryCandidate',
			'matchDetails', (v_duplicate -> 'match') || jsonb_build_object(
				'candidateCount', v_duplicate -> 'candidateCount'
			)
		);
		insert into public.pending_interactions (
			user_id,
			conversation_id,
			kind,
			status,
			schema_version,
			policy_version,
			proposal_turn_id,
			proposal_operation_id,
			proposal_input_hash,
			payload
		)
		values (
			p_user_id,
			v_turn.conversation_id,
			'meal_duplicate',
			'prepared',
			1,
			1,
			p_source_turn_id,
			v_operation_id,
			v_input_hash,
			v_payload
		)
		returning * into v_interaction;

		return jsonb_build_object(
			'status', 'confirmation_required',
			'interaction', public.pending_interaction_json(v_interaction.id),
			'replayed', false
		);
	end if;

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
		time_period
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
		p_time_period
	)
	returning * into v_meal;

	insert into public.meal_items (meal_id, position, name, amount_text)
	select
		v_meal.id,
		ordinal - 1,
		item ->> 'name',
		case when item -> 'amountText' = 'null'::jsonb then null else item ->> 'amountText' end
	from jsonb_array_elements(p_items) with ordinality input(item, ordinal);

	insert into public.meal_item_ingredients (meal_item_id, position, name, amount_text)
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

	return jsonb_build_object(
		'status', 'created',
		'meal', public.meal_record_json(v_meal.id),
		'replayed', v_replayed
	);
end;
$$;

create or replace function public.resolve_meal_duplicate_interaction(
	p_user_id uuid,
	p_resolution_turn_id uuid,
	p_turn_lease_expires_at timestamptz,
	p_tool_call_index integer,
	p_interaction_id uuid,
	p_decision text,
	p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_operation_id text := p_resolution_turn_id::text || ':' || p_tool_call_index::text;
	v_now timestamptz := clock_timestamp();
	v_turn public.turns%rowtype;
	v_interaction public.pending_interactions%rowtype;
	v_meal public.meals%rowtype;
	v_proposal jsonb;
begin
	if p_tool_call_index not between 0 and 4
		or p_interaction_id is null
		or p_decision not in ('register', 'discard')
		or (
			p_decision = 'register'
			and p_reason is not null
		)
		or (
			p_decision = 'discard'
			and p_reason not in ('user_declined', 'conversation_moved_on', 'corrected_proposal')
		) then
		raise exception using errcode = '22023', message = 'invalid_interaction_resolution';
	end if;

	perform pg_catalog.pg_advisory_xact_lock(
		pg_catalog.hashtextextended(p_user_id::text || ':' || v_operation_id, 0)
	);

	select * into v_turn
	from public.turns
	where id = p_resolution_turn_id and user_id = p_user_id
	for update;
	if not found
		or v_turn.status <> 'processing'
		or v_turn.lease_expires_at is distinct from p_turn_lease_expires_at
		or v_turn.lease_expires_at <= clock_timestamp() then
		raise exception using errcode = '55000', message = 'stale_chat_turn_lease';
	end if;

	select * into v_interaction
	from public.pending_interactions
	where user_id = p_user_id and resolution_operation_id = v_operation_id
	for update;
	if found then
		if v_interaction.id <> p_interaction_id
			or (p_decision = 'register' and v_interaction.status <> 'confirmed')
			or (p_decision = 'discard' and (
				v_interaction.status <> 'discarded'
				or v_interaction.resolution_reason <> p_reason
			)) then
			raise exception using errcode = '23505', message = 'interaction_resolution_conflict';
		end if;
		if v_interaction.status = 'confirmed' then
			select * into v_meal
			from public.meals
			where user_id = p_user_id and source_operation_id = v_operation_id;
			return jsonb_build_object(
				'status', 'registered',
				'meal', public.meal_record_json(v_meal.id),
				'replayed', true
			);
		end if;
		return jsonb_build_object(
			'status', 'discarded',
			'reason', v_interaction.resolution_reason,
			'replayed', true
		);
	end if;

	select * into v_interaction
	from public.pending_interactions
	where id = p_interaction_id
		and user_id = p_user_id
		and conversation_id = v_turn.conversation_id
	for update;
	if not found then
		return jsonb_build_object('status', 'not_found');
	end if;
	if v_interaction.status <> 'pending' then
		return jsonb_build_object(
			'status', 'already_resolved',
			'decision', case when v_interaction.status = 'confirmed' then 'register' else 'discard' end
		);
	end if;

	if p_decision = 'discard' then
		update public.pending_interactions
		set
			status = 'discarded',
			resolution_turn_id = p_resolution_turn_id,
			resolution_operation_id = v_operation_id,
			resolution_reason = p_reason,
			resolved_at = v_now
		where id = v_interaction.id;
		return jsonb_build_object('status', 'discarded', 'reason', p_reason, 'replayed', false);
	end if;

	v_proposal := v_interaction.payload -> 'proposedMeal';
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
		time_period
	)
	values (
		p_user_id,
		v_proposal ->> 'mealType',
		p_resolution_turn_id,
		v_operation_id,
		v_interaction.proposal_input_hash,
		v_proposal #>> '{occurrence,precision}',
		(v_proposal #>> '{occurrence,occurredAt}')::timestamptz,
		(v_proposal #>> '{occurrence,occurredOn}')::date,
		v_proposal #>> '{occurrence,timezone}',
		v_proposal #>> '{occurrence,timePeriod}'
	)
	returning * into v_meal;

	insert into public.meal_items (meal_id, position, name, amount_text)
	select
		v_meal.id,
		ordinal - 1,
		item ->> 'name',
		case when item -> 'amountText' = 'null'::jsonb then null else item ->> 'amountText' end
	from jsonb_array_elements(v_proposal -> 'items') with ordinality input(item, ordinal);

	insert into public.meal_item_ingredients (meal_item_id, position, name, amount_text)
	select
		meal_item.id,
		ingredient_ordinal - 1,
		ingredient ->> 'name',
		case
			when ingredient -> 'amountText' = 'null'::jsonb then null
			else ingredient ->> 'amountText'
		end
	from jsonb_array_elements(v_proposal -> 'items') with ordinality item_input(item, item_ordinal)
	join public.meal_items meal_item
		on meal_item.meal_id = v_meal.id and meal_item.position = item_ordinal - 1
	cross join lateral jsonb_array_elements(item -> 'ingredients')
		with ordinality ingredient_input(ingredient, ingredient_ordinal);

	update public.pending_interactions
	set
		status = 'confirmed',
		resolution_turn_id = p_resolution_turn_id,
		resolution_operation_id = v_operation_id,
		resolution_reason = 'user_confirmed',
		resolved_at = v_now
	where id = v_interaction.id;

	return jsonb_build_object(
		'status', 'registered',
		'meal', public.meal_record_json(v_meal.id),
		'replayed', false
	);
end;
$$;

create or replace function public.complete_chat_turn(
	p_user_id uuid,
	p_turn_id uuid,
	p_turn_lease_expires_at timestamptz,
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
		or v_turn.lease_expires_at is distinct from p_turn_lease_expires_at
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

		update public.pending_interactions
		set
			status = 'pending',
			prompt_message_id = v_assistant_message.id,
			activated_at = v_now
		where user_id = p_user_id
			and conversation_id = v_turn.conversation_id
			and proposal_turn_id = p_turn_id
			and status = 'prepared';

		update public.turns
		set status = 'completed', lease_expires_at = null, completed_at = v_now
		where id = p_turn_id and user_id = p_user_id;
	end if;

	update public.conversations
	set
		updated_at = greatest(updated_at, v_assistant_message.created_at),
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

create or replace function public.fail_chat_turn(
	p_user_id uuid,
	p_turn_id uuid,
	p_turn_lease_expires_at timestamptz,
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
		and lease_expires_at = p_turn_lease_expires_at
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
) from public, anon, authenticated;
revoke execute on function public.resolve_meal_duplicate_interaction(
	uuid, uuid, timestamptz, integer, uuid, text, text
) from public, anon, authenticated;
revoke execute on function public.complete_chat_turn(uuid, uuid, timestamptz, text)
	from public, anon, authenticated;
revoke execute on function public.fail_chat_turn(uuid, uuid, timestamptz, boolean)
	from public, anon, authenticated;

grant execute on function public.begin_chat_turn(uuid, uuid, uuid, text, integer)
	to service_role;
grant execute on function public.create_meal_from_chat(
	uuid, uuid, timestamptz, integer, text, text, timestamptz, date, text, text, jsonb
) to service_role;
grant execute on function public.resolve_meal_duplicate_interaction(
	uuid, uuid, timestamptz, integer, uuid, text, text
) to service_role;
grant execute on function public.complete_chat_turn(uuid, uuid, timestamptz, text)
	to service_role;
grant execute on function public.fail_chat_turn(uuid, uuid, timestamptz, boolean)
	to service_role;

commit;
