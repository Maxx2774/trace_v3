create function public.update_meal(
	p_user_id uuid,
	p_meal_id uuid,
	p_description text,
	p_ingredients jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_meal public.meals%rowtype;
begin
	if p_description is null
		or p_description <> btrim(p_description)
		or char_length(p_description) not between 1 and 1000
		or p_ingredients is null
		or jsonb_typeof(p_ingredients) <> 'array'
		or jsonb_array_length(p_ingredients) > 50 then
		raise exception using errcode = '22023', message = 'invalid_meal_update';
	end if;

	if exists (
		select 1
		from jsonb_array_elements(p_ingredients) as input(ingredient)
		where jsonb_typeof(ingredient) <> 'object'
			or not ingredient ? 'reportedText'
			or jsonb_typeof(ingredient -> 'reportedText') <> 'string'
			or exists (
				select 1
				from jsonb_object_keys(ingredient) as keys(key)
				where key <> 'reportedText'
			)
			or ingredient ->> 'reportedText' <> btrim(ingredient ->> 'reportedText')
			or char_length(ingredient ->> 'reportedText') not between 1 and 160
	) then
		raise exception using errcode = '22023', message = 'invalid_meal_ingredients';
	end if;

	select * into v_meal
	from public.meals
	where id = p_meal_id and user_id = p_user_id
	for update;

	if not found then
		raise exception using errcode = 'P0002', message = 'meal_not_found';
	end if;

	update public.meals
	set description = p_description, updated_at = clock_timestamp()
	where id = p_meal_id and user_id = p_user_id
	returning * into v_meal;

	delete from public.meal_ingredients
	where meal_id = p_meal_id;

	insert into public.meal_ingredients (
		meal_id, position, reported_text, normalized_name
	)
	select
		p_meal_id,
		(ordinal - 1)::integer,
		ingredient ->> 'reportedText',
		ingredient ->> 'reportedText'
	from jsonb_array_elements(p_ingredients) with ordinality input(ingredient, ordinal);

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
			select jsonb_agg(
				jsonb_build_object('reportedText', ingredient.reported_text)
				order by ingredient.position
			)
			from public.meal_ingredients ingredient
			where ingredient.meal_id = v_meal.id
		), '[]'::jsonb)
	);
end;
$$;

revoke execute on function public.update_meal(uuid, uuid, text, jsonb)
	from public, anon, authenticated;
grant execute on function public.update_meal(uuid, uuid, text, jsonb)
	to service_role;
