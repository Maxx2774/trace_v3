alter table public.pending_interactions
	drop constraint pending_interactions_lifecycle_check;

update public.pending_interactions
set resolution_reason = 'corrected_input'
where resolution_reason = 'corrected_proposal';

alter table public.pending_interactions
	add constraint pending_interactions_lifecycle_check check (
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
				'user_declined', 'conversation_moved_on', 'corrected_input'
			)
			and resolved_at is not null
		)
	);

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
			and p_reason not in ('user_declined', 'conversation_moved_on', 'corrected_input')
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
