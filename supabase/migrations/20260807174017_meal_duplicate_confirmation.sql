begin;

alter table public.messages
	add constraint messages_id_conversation_user_key unique (id, conversation_id, user_id);

create table public.pending_interactions (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references auth.users(id) on delete cascade,
	conversation_id uuid not null,
	kind text not null,
	status text not null,
	schema_version smallint not null,
	policy_version smallint,
	proposal_turn_id uuid not null,
	proposal_operation_id text not null,
	proposal_input_hash text not null,
	prompt_message_id uuid,
	resolution_turn_id uuid,
	resolution_operation_id text,
	resolution_reason text,
	payload jsonb not null,
	created_at timestamptz not null default statement_timestamp(),
	activated_at timestamptz,
	resolved_at timestamptz,
	constraint pending_interactions_conversation_owner_fkey
		foreign key (conversation_id, user_id)
		references public.conversations(id, user_id)
		on delete cascade,
	constraint pending_interactions_proposal_turn_owner_fkey
		foreign key (proposal_turn_id, conversation_id, user_id)
		references public.turns(id, conversation_id, user_id)
		on delete cascade,
	constraint pending_interactions_prompt_message_owner_fkey
		foreign key (prompt_message_id, conversation_id, user_id)
		references public.messages(id, conversation_id, user_id),
	constraint pending_interactions_resolution_turn_owner_fkey
		foreign key (resolution_turn_id, conversation_id, user_id)
		references public.turns(id, conversation_id, user_id)
		on delete cascade,
	constraint pending_interactions_user_proposal_operation_key
		unique (user_id, proposal_operation_id),
	constraint pending_interactions_user_resolution_operation_key
		unique (user_id, resolution_operation_id),
	constraint pending_interactions_kind_check check (kind = 'meal_duplicate'),
	constraint pending_interactions_status_check check (
		status in ('prepared', 'pending', 'confirmed', 'discarded')
	),
	constraint pending_interactions_version_check check (
		kind <> 'meal_duplicate'
		or (schema_version = 1 and policy_version = 1)
	),
	constraint pending_interactions_operation_check check (
		char_length(proposal_operation_id) between 38 and 40
		and (
			resolution_operation_id is null
			or char_length(resolution_operation_id) between 38 and 40
		)
	),
	constraint pending_interactions_input_hash_check check (
		proposal_input_hash ~ '^[0-9a-f]{64}$'
	),
	constraint pending_interactions_payload_check check (jsonb_typeof(payload) = 'object'),
	constraint pending_interactions_timestamps_check check (
		(activated_at is null or activated_at >= created_at)
		and (resolved_at is null or (activated_at is not null and resolved_at >= activated_at))
	),
	constraint pending_interactions_lifecycle_check check (
		(
			status = 'prepared'
			and prompt_message_id is null
			and activated_at is null
			and resolution_turn_id is null
			and resolution_operation_id is null
			and resolution_reason is null
			and resolved_at is null
		)
		or (
			status = 'pending'
			and prompt_message_id is not null
			and activated_at is not null
			and resolution_turn_id is null
			and resolution_operation_id is null
			and resolution_reason is null
			and resolved_at is null
		)
		or (
			status = 'confirmed'
			and prompt_message_id is not null
			and activated_at is not null
			and resolution_turn_id is not null
			and resolution_operation_id is not null
			and resolution_reason = 'user_confirmed'
			and resolved_at is not null
		)
		or (
			status = 'discarded'
			and prompt_message_id is not null
			and activated_at is not null
			and resolution_turn_id is not null
			and resolution_operation_id is not null
			and resolution_reason in (
				'user_declined', 'conversation_moved_on', 'corrected_proposal'
			)
			and resolved_at is not null
		)
	)
);

create index pending_interactions_pending_conversation_idx
	on public.pending_interactions (user_id, conversation_id, created_at desc, id)
	where status = 'pending';
create index pending_interactions_proposal_turn_idx
	on public.pending_interactions (proposal_turn_id);
create index pending_interactions_resolution_turn_idx
	on public.pending_interactions (resolution_turn_id)
	where resolution_turn_id is not null;
create index pending_interactions_prompt_message_idx
	on public.pending_interactions (prompt_message_id)
	where prompt_message_id is not null;

alter table public.pending_interactions enable row level security;
revoke all on table public.pending_interactions from anon, authenticated;

create function public.normalize_meal_duplicate_text_v1(p_value text)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $$
	select pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(p_value), E'\\s+', ' ', 'g'));
$$;

create function public.meal_duplicate_identity_v1(
	p_meal_type text,
	p_occurred_precision text,
	p_occurred_at timestamptz,
	p_occurred_on date,
	p_time_period text,
	p_items jsonb
)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
	with normalized_items as (
		select jsonb_build_object(
			'name', public.normalize_meal_duplicate_text_v1(item ->> 'name'),
			'amountText', case
				when item -> 'amountText' = 'null'::jsonb then null
				else public.normalize_meal_duplicate_text_v1(item ->> 'amountText')
			end,
			'ingredients', coalesce((
				select jsonb_agg(normalized order by normalized::text)
				from (
					select jsonb_build_object(
						'name', public.normalize_meal_duplicate_text_v1(ingredient ->> 'name'),
						'amountText', case
							when ingredient -> 'amountText' = 'null'::jsonb then null
							else public.normalize_meal_duplicate_text_v1(
								ingredient ->> 'amountText'
							)
						end
					) as normalized
					from jsonb_array_elements(item -> 'ingredients') ingredient
				) ingredient_rows
			), '[]'::jsonb)
		) as normalized
		from jsonb_array_elements(p_items) item
	)
	select jsonb_build_object(
		'mealType', p_meal_type,
		'occurrence', jsonb_build_object(
			'precision', p_occurred_precision,
			'occurredAt', p_occurred_at,
			'occurredOn', p_occurred_on,
			'timePeriod', p_time_period
		),
		'items', coalesce(jsonb_agg(normalized order by normalized::text), '[]'::jsonb)
	)
	from normalized_items;
$$;

create function public.pending_interaction_json(p_interaction_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
	select jsonb_build_object(
		'id', interaction.id,
		'kind', interaction.kind,
		'status', interaction.status,
		'schemaVersion', interaction.schema_version,
		'policyVersion', interaction.policy_version,
		'proposalTurnId', interaction.proposal_turn_id,
		'proposalOperationId', interaction.proposal_operation_id,
		'proposalInputHash', interaction.proposal_input_hash,
		'resolutionTurnId', interaction.resolution_turn_id,
		'resolutionOperationId', interaction.resolution_operation_id,
		'resolutionReason', interaction.resolution_reason,
		'payload', interaction.payload,
		'createdAt', interaction.created_at,
		'activatedAt', interaction.activated_at,
		'resolvedAt', interaction.resolved_at
	)
	from public.pending_interactions interaction
	where interaction.id = p_interaction_id;
$$;

create function public.find_meal_duplicate_v1(
	p_user_id uuid,
	p_meal_type text,
	p_occurred_precision text,
	p_occurred_at timestamptz,
	p_occurred_on date,
	p_timezone text,
	p_time_period text,
	p_items jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
	with proposed as (
		select
			public.meal_duplicate_identity_v1(
				p_meal_type,
				p_occurred_precision,
				p_occurred_at,
				p_occurred_on,
				p_time_period,
				p_items
			) as identity,
			(
				select jsonb_agg(
					public.normalize_meal_duplicate_text_v1(item ->> 'name')
					order by public.normalize_meal_duplicate_text_v1(item ->> 'name')
				)
				from jsonb_array_elements(p_items) item
			) as item_names
	),
	meal_payloads as (
		select
			meal.*,
			coalesce((
				select jsonb_agg(
					jsonb_build_object(
						'name', item.name,
						'amountText', item.amount_text,
						'ingredients', coalesce((
							select jsonb_agg(
								jsonb_build_object(
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
			), '[]'::jsonb) as items
		from public.meals meal
		where meal.user_id = p_user_id
			and meal.occurred_on = p_occurred_on
			and p_occurred_on is not null
	),
	identified as (
		select
			meal_payloads.*,
			public.meal_duplicate_identity_v1(
				meal_type,
				occurred_precision,
				occurred_at,
				occurred_on,
				time_period,
				items
			) as identity,
			(
				select jsonb_agg(
					public.normalize_meal_duplicate_text_v1(item ->> 'name')
					order by public.normalize_meal_duplicate_text_v1(item ->> 'name')
				)
				from jsonb_array_elements(items) item
			) as item_names
		from meal_payloads
	),
	base_candidates as (
		select
			identified.*,
			proposed.identity as proposed_identity,
			abs(extract(epoch from (identified.occurred_at - p_occurred_at))) / 60.0
				as time_difference_minutes
		from identified
		cross join proposed
		where identified.item_names = proposed.item_names
	),
	anchored as (
		select
			base_candidates.*,
			case
				when p_occurred_at is not null
					and occurred_at is not null
					and time_difference_minutes <= case
						when p_occurred_precision = 'exact' and occurred_precision = 'exact'
							then 30
						else 90
					end
					then 'time'
				when p_occurred_at is null
					and occurred_at is null
					and identity = proposed_identity
					then 'identical_payload'
				else null
			end as anchor,
			case
				when meal_type is not distinct from p_meal_type then 'match'
				when meal_type is null or p_meal_type is null then 'unknown'
				else 'different'
			end as meal_type_relation,
			case
				when (
					select jsonb_agg(
						jsonb_build_object('name', item -> 'name', 'amountText', item -> 'amountText')
						order by item::text
					)
					from jsonb_array_elements(identity -> 'items') item
				) = (
					select jsonb_agg(
						jsonb_build_object('name', item -> 'name', 'amountText', item -> 'amountText')
						order by item::text
					)
					from jsonb_array_elements(proposed_identity -> 'items') item
				) then 'match'
				when exists (
					select 1 from jsonb_array_elements(identity -> 'items') item
					where item -> 'amountText' = 'null'::jsonb
				) or exists (
					select 1 from jsonb_array_elements(proposed_identity -> 'items') item
					where item -> 'amountText' = 'null'::jsonb
				) then 'unknown'
				else 'different'
			end as amount_relation,
			case
				when (
					select jsonb_agg(
						jsonb_build_object('name', item -> 'name', 'ingredients', item -> 'ingredients')
						order by item::text
					)
					from jsonb_array_elements(identity -> 'items') item
				) = (
					select jsonb_agg(
						jsonb_build_object('name', item -> 'name', 'ingredients', item -> 'ingredients')
						order by item::text
					)
					from jsonb_array_elements(proposed_identity -> 'items') item
				) then 'match'
				when exists (
					select 1 from jsonb_array_elements(identity -> 'items') item
					where jsonb_array_length(item -> 'ingredients') = 0
				) or exists (
					select 1 from jsonb_array_elements(proposed_identity -> 'items') item
					where jsonb_array_length(item -> 'ingredients') = 0
				) then 'unknown'
				else 'different'
			end as ingredients_relation
		from base_candidates
	),
	eligible as (
		select
			anchored.*,
			((meal_type_relation = 'different')::integer
				+ (amount_relation = 'different')::integer
				+ (ingredients_relation = 'different')::integer) as different_count
		from anchored
		where anchor is not null
	),
	ranked as (
		select
			eligible.*,
			count(*) over () as candidate_count,
			row_number() over (
				order by
					case anchor when 'time' then 0 else 1 end,
					time_difference_minutes nulls last,
					different_count,
					created_at desc,
					id
			) as candidate_rank
		from eligible
	)
	select jsonb_build_object(
		'candidateCount', candidate_count,
		'primaryCandidate', jsonb_build_object(
			'mealType', meal_type,
			'occurrence', jsonb_build_object(
				'precision', occurred_precision,
				'occurredAt', occurred_at,
				'occurredOn', occurred_on,
				'timezone', timezone,
				'timePeriod', time_period
			),
			'items', items
		),
		'match', jsonb_build_object(
			'policyVersion', 1,
			'anchor', anchor,
			'timeDifferenceMinutes', case
				when time_difference_minutes is null then null
				else round(time_difference_minutes::numeric, 2)
			end,
			'differences', jsonb_build_object(
				'mealType', meal_type_relation,
				'amounts', amount_relation,
				'ingredients', ingredients_relation
			)
		)
	)
	from ranked
	where candidate_rank = 1;
$$;

create or replace function public.create_meal_from_chat(
	p_user_id uuid,
	p_source_turn_id uuid,
	p_lease_expires_at timestamptz,
	p_operation_index integer,
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
	v_operation_id text := p_source_turn_id::text || ':' || p_operation_index::text;
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
	if p_operation_index not between 0 and 4
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

create function public.resolve_meal_duplicate_interaction(
	p_user_id uuid,
	p_resolution_turn_id uuid,
	p_lease_expires_at timestamptz,
	p_operation_index integer,
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
	v_operation_id text := p_resolution_turn_id::text || ':' || p_operation_index::text;
	v_now timestamptz := clock_timestamp();
	v_turn public.turns%rowtype;
	v_interaction public.pending_interactions%rowtype;
	v_meal public.meals%rowtype;
	v_proposal jsonb;
begin
	if p_operation_index not between 0 and 4
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
		or v_turn.lease_expires_at is distinct from p_lease_expires_at
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

revoke execute on function public.normalize_meal_duplicate_text_v1(text)
	from public, anon, authenticated;
revoke execute on function public.meal_duplicate_identity_v1(
	text, text, timestamptz, date, text, jsonb
) from public, anon, authenticated;
revoke execute on function public.pending_interaction_json(uuid)
	from public, anon, authenticated;
revoke execute on function public.find_meal_duplicate_v1(
	uuid, text, text, timestamptz, date, text, text, jsonb
) from public, anon, authenticated;
revoke execute on function public.create_meal_from_chat(
	uuid, uuid, timestamptz, integer, text, text, timestamptz, date, text, text, jsonb
) from public, anon, authenticated;
revoke execute on function public.resolve_meal_duplicate_interaction(
	uuid, uuid, timestamptz, integer, uuid, text, text
) from public, anon, authenticated;
revoke execute on function public.complete_chat_turn(uuid, uuid, timestamptz, text)
	from public, anon, authenticated;

grant execute on function public.create_meal_from_chat(
	uuid, uuid, timestamptz, integer, text, text, timestamptz, date, text, text, jsonb
) to service_role;
grant execute on function public.normalize_meal_duplicate_text_v1(text)
	to service_role;
grant execute on function public.meal_duplicate_identity_v1(
	text, text, timestamptz, date, text, jsonb
) to service_role;
grant execute on function public.pending_interaction_json(uuid)
	to service_role;
grant execute on function public.find_meal_duplicate_v1(
	uuid, text, text, timestamptz, date, text, text, jsonb
) to service_role;
grant execute on function public.resolve_meal_duplicate_interaction(
	uuid, uuid, timestamptz, integer, uuid, text, text
) to service_role;
grant execute on function public.complete_chat_turn(uuid, uuid, timestamptz, text)
	to service_role;

commit;
