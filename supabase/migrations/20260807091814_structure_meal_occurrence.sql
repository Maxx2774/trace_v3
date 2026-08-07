begin;

alter table public.meals add column time_period text;

update public.meals
set time_period = case
	when occurred_precision = 'approximate' and occurred_at is null then
		case
			when lower(btrim(time_expression)) ~ '(morgon|förmiddag|morning)' then 'morning'
			when lower(btrim(time_expression)) ~ '(lunch|middagstid|noon)' then 'lunch'
			when lower(btrim(time_expression)) ~ '(eftermiddag|afternoon)' then 'afternoon'
			when lower(btrim(time_expression)) ~ '(kväll|evening)' then 'evening'
			when lower(btrim(time_expression)) ~ '(natt|night)' then 'night'
			else null
		end
	else null
end;

update public.meals
set occurred_precision = 'date'
where occurred_precision = 'approximate'
	and occurred_at is null
	and time_period is null;

create or replace function public.meal_record_json(p_meal_id uuid)
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
			'timePeriod', meal.time_period
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

drop function public.create_meal_from_chat(
	uuid, uuid, timestamptz, integer, text, text, timestamptz, date, text, text, jsonb
);
drop function public.update_meal(
	uuid, uuid, integer, uuid, text, text, timestamptz, date, text, text, jsonb
);

alter table public.meals
	drop constraint meals_occurrence_check,
	drop constraint meals_time_expression_check,
	drop column time_expression;

alter table public.meals
	add constraint meals_time_period_check check (
		time_period is null
		or time_period in ('morning', 'lunch', 'afternoon', 'evening', 'night')
	),
	add constraint meals_occurrence_check check (
		(
			occurred_precision = 'exact'
			and occurred_at is not null
			and occurred_on is not null
			and timezone is not null
			and time_period is null
		)
		or (
			occurred_precision = 'approximate'
			and occurred_on is not null
			and timezone is not null
			and (
				(occurred_at is not null and time_period is null)
				or (occurred_at is null and time_period is not null)
			)
		)
		or (
			occurred_precision = 'date'
			and occurred_at is null
			and occurred_on is not null
			and timezone is not null
			and time_period is null
		)
		or (
			occurred_precision = 'unknown'
			and occurred_at is null
			and occurred_on is null
			and timezone is null
			and time_period is null
		)
	);

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

	v_payload := jsonb_build_object(
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
	p_time_period text,
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
		or (p_time_period is not null and p_time_period not in (
			'morning', 'lunch', 'afternoon', 'evening', 'night'
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

	v_payload := jsonb_build_object(
		'id', p_meal_id,
		'expectedRevision', p_expected_revision,
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
		time_period = p_time_period,
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

revoke execute on function public.create_meal_from_chat(
	uuid, uuid, timestamptz, integer, text, text, timestamptz, date, text, text, jsonb
) from public, anon, authenticated;
revoke execute on function public.update_meal(
	uuid, uuid, integer, uuid, text, text, timestamptz, date, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.create_meal_from_chat(
	uuid, uuid, timestamptz, integer, text, text, timestamptz, date, text, text, jsonb
) to service_role;
grant execute on function public.update_meal(
	uuid, uuid, integer, uuid, text, text, timestamptz, date, text, text, jsonb
) to service_role;

commit;
