begin;

do $$
declare
	v_user_id uuid := 'b1000000-0000-4000-8000-000000000000';
	v_other_user_id uuid := 'b2000000-0000-4000-8000-000000000000';
	v_turn_id uuid := gen_random_uuid();
	v_other_turn_id uuid := gen_random_uuid();
	v_mutation_id uuid := gen_random_uuid();
	v_result jsonb;
	v_repeat jsonb;
	v_page jsonb;
	v_conversation_id uuid;
	v_other_conversation_id uuid;
	v_lease timestamptz;
	v_other_lease timestamptz;
	v_meal_id uuid;
	v_other_meal_id uuid;
	v_item_id uuid;
	v_ingredient_id uuid;
	v_new_item_id uuid;
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
			'meal-test-1@example.invalid',
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
			'meal-test-2@example.invalid',
			'{}'::jsonb,
			'{}'::jsonb,
			now(),
			now()
		);

	v_result := public.begin_chat_turn(
		v_user_id,
		null,
		v_turn_id,
		'Jag åt chiapudding och äggröra med 4 ägg till frukost',
		120
	);
	v_conversation_id := (v_result #>> '{conversation,id}')::uuid;
	v_lease := (v_result ->> 'turnLeaseExpiresAt')::timestamptz;

	v_result := public.create_meal_from_chat(
		v_user_id,
		v_turn_id,
		v_lease,
		0,
		'breakfast',
		'exact',
		'2026-08-06T06:30:00Z',
		null,
		'Europe/Stockholm',
		null,
		'[
			{"name":"Chiapudding","amountText":null,"ingredients":[]},
			{"name":"Äggröra","amountText":null,"ingredients":[
				{"name":"Ägg","amountText":"4 st"}
			]}
		]'::jsonb
	);
	assert v_result ->> 'status' = 'created', 'first operation must create a meal';
	v_result := v_result -> 'meal';
	v_meal_id := (v_result ->> 'id')::uuid;
	v_item_id := (v_result #>> '{items,1,id}')::uuid;
	v_ingredient_id := (v_result #>> '{items,1,ingredients,0,id}')::uuid;

	assert v_result ->> 'mealType' = 'breakfast', 'meal type must be canonical';
	assert v_result #>> '{occurrence,occurredOn}' = '2026-08-06',
		'local date must be derived from instant and timezone';
	assert jsonb_array_length(v_result -> 'items') = 2,
		'nested create must preserve item grouping';
	assert v_result #>> '{items,1,ingredients,0,amountText}' = '4 st',
		'explicit ingredient amount must be preserved';
	assert (select count(*) from public.meal_items where meal_id = v_meal_id) = 2,
		'items must be created atomically';
	assert (
		select count(*)
		from public.meal_item_ingredients ingredient
		join public.meal_items item on item.id = ingredient.meal_item_id
		where item.meal_id = v_meal_id
	) = 1, 'ingredients must belong to their item';

	v_repeat := public.create_meal_from_chat(
		v_user_id,
		v_turn_id,
		v_lease,
		0,
		'breakfast',
		'exact',
		'2026-08-06T06:30:00Z',
		null,
		'Europe/Stockholm',
		null,
		'[
			{"name":"Chiapudding","amountText":null,"ingredients":[]},
			{"name":"Äggröra","amountText":null,"ingredients":[
				{"name":"Ägg","amountText":"4 st"}
			]}
		]'::jsonb
	);
	assert v_repeat ->> 'status' = 'created', 'same operation must replay a created outcome';
	assert v_repeat -> 'meal' = v_result, 'same operation and payload must replay the same record';
	assert (v_repeat ->> 'replayed')::boolean, 'same operation must be marked replayed';
	assert (select count(*) from public.meals where source_turn_id = v_turn_id) = 1,
		'idempotent create retry must not duplicate the meal';

	begin
		perform public.create_meal_from_chat(
			v_user_id,
			v_turn_id,
			v_lease,
			0,
			'breakfast',
			'unknown',
			null,
			null,
			null,
			null,
			'[{"name":"Annan måltid","amountText":null,"ingredients":[]}]'::jsonb
		);
		assert false, 'changed create payload under the same operation must conflict';
	exception when unique_violation then
		null;
	end;

	v_result := public.begin_chat_turn(
		v_other_user_id,
		null,
		v_other_turn_id,
		'Jag åt kaffe',
		120
	);
	v_other_conversation_id := (v_result #>> '{conversation,id}')::uuid;
	v_other_lease := (v_result ->> 'turnLeaseExpiresAt')::timestamptz;
	v_result := public.create_meal_from_chat(
		v_other_user_id,
		v_other_turn_id,
		v_other_lease,
		0,
		null,
		'unknown',
		null,
		null,
		null,
		null,
		'[{"name":"Kaffe","amountText":"1 kopp","ingredients":[]}]'::jsonb
	);
	v_result := v_result -> 'meal';
	v_other_meal_id := (v_result ->> 'id')::uuid;

	v_result := public.update_meal(
		v_user_id,
		v_meal_id,
		1,
		v_mutation_id,
		'lunch',
		'approximate',
		null,
		'2026-08-06',
		'Europe/Stockholm',
		'lunch',
		jsonb_build_array(
			jsonb_build_object(
				'id', v_item_id,
				'name', 'Äggröra',
				'amountText', null,
				'ingredients', jsonb_build_array(
					jsonb_build_object(
						'id', v_ingredient_id,
						'name', 'Ägg',
						'amountText', '3 st'
					)
				)
			),
			jsonb_build_object(
				'id', null,
				'name', 'Kaffe',
				'amountText', '1 kopp',
				'ingredients', '[]'::jsonb
			)
		)
	);
	v_new_item_id := (v_result #>> '{items,1,id}')::uuid;
	assert (v_result ->> 'revision')::integer = 2, 'update must bump revision exactly once';
	assert v_result ->> 'mealType' = 'lunch', 'update must replace meal type';
	assert v_result #>> '{occurrence,timePeriod}' = 'lunch',
		'approximate periods without a clock must remain structured';
	assert (v_result #>> '{items,0,id}')::uuid = v_item_id,
		'existing item identity must be preserved';
	assert (v_result #>> '{items,0,ingredients,0,id}')::uuid = v_ingredient_id,
		'existing ingredient identity must be preserved';
	assert v_new_item_id is not null, 'new item must receive a server-generated id';
	assert not exists (
		select 1 from public.meal_items
		where meal_id = v_meal_id and name = 'Chiapudding'
	), 'objects omitted from the replace payload must be deleted';

	v_repeat := public.update_meal(
		v_user_id,
		v_meal_id,
		1,
		v_mutation_id,
		'lunch',
		'approximate',
		null,
		'2026-08-06',
		'Europe/Stockholm',
		'lunch',
		jsonb_build_array(
			jsonb_build_object(
				'id', v_item_id,
				'name', 'Äggröra',
				'amountText', null,
				'ingredients', jsonb_build_array(
					jsonb_build_object(
						'id', v_ingredient_id,
						'name', 'Ägg',
						'amountText', '3 st'
					)
				)
			),
			jsonb_build_object(
				'id', null,
				'name', 'Kaffe',
				'amountText', '1 kopp',
				'ingredients', '[]'::jsonb
			)
		)
	);
	assert v_repeat = v_result, 'same mutation id and payload must replay the receipt';
	assert (select revision from public.meals where id = v_meal_id) = 2,
		'receipt replay must not bump revision again';
	assert (select count(*) from public.meal_update_receipts where meal_id = v_meal_id) = 1,
		'exactly one receipt must be stored';

	begin
		perform public.update_meal(
			v_user_id,
			v_meal_id,
			1,
			v_mutation_id,
			'dinner',
			'unknown',
			null,
			null,
			null,
			null,
			jsonb_build_array(jsonb_build_object(
				'id', v_item_id,
				'name', 'Äggröra',
				'amountText', null,
				'ingredients', '[]'::jsonb
			))
		);
		assert false, 'same mutation id with changed payload must conflict';
	exception when unique_violation then
		null;
	end;

	begin
		perform public.update_meal(
			v_user_id,
			v_meal_id,
			1,
			gen_random_uuid(),
			'lunch',
			'unknown',
			null,
			null,
			null,
			null,
			jsonb_build_array(jsonb_build_object(
				'id', v_item_id,
				'name', 'Äggröra',
				'amountText', null,
				'ingredients', '[]'::jsonb
			))
		);
		assert false, 'a stale revision with a new mutation id must conflict';
	exception when serialization_failure then
		null;
	end;

	begin
		perform public.update_meal(
			v_other_user_id,
			v_meal_id,
			2,
			gen_random_uuid(),
			'lunch',
			'unknown',
			null,
			null,
			null,
			null,
			jsonb_build_array(jsonb_build_object(
				'id', v_item_id,
				'name', 'Äggröra',
				'amountText', null,
				'ingredients', '[]'::jsonb
			))
		);
		assert false, 'another owner must not update the meal';
	exception when no_data_found then
		null;
	end;

	begin
		perform public.update_meal(
			v_user_id,
			v_meal_id,
			2,
			gen_random_uuid(),
			'lunch',
			'unknown',
			null,
			null,
			null,
			null,
			jsonb_build_array(jsonb_build_object(
				'id', (select id from public.meal_items where meal_id = v_other_meal_id limit 1),
				'name', 'Intrång',
				'amountText', null,
				'ingredients', '[]'::jsonb
			))
		);
		assert false, 'an item from another meal must not be adopted';
	exception when invalid_parameter_value then
		null;
	end;

	begin
		perform public.update_meal(
			v_user_id,
			v_meal_id,
			2,
			gen_random_uuid(),
			'lunch',
			'unknown',
			null,
			null,
			null,
			null,
			'[]'::jsonb
		);
		assert false, 'the last item must not be removed through meal update';
	exception when invalid_parameter_value then
		null;
	end;

	perform public.complete_chat_turn(v_user_id, v_turn_id, v_lease, 'Registrerat');
	v_result := public.begin_chat_turn(
		v_user_id,
		v_conversation_id,
		v_turn_id,
		'Jag åt chiapudding och äggröra med 4 ägg till frukost',
		120
	);
	assert v_result #>> '{journalRecords,0,record,reference,committedRevision}' = '1',
		'replay reference must retain the originally committed revision';
	assert v_result #>> '{journalRecords,0,record,value,revision}' = '2',
		'replay must hydrate the latest canonical revision';
	assert v_result #>> '{journalRecords,0,record,value,items,1,name}' = 'Kaffe',
		'replay must hydrate nested current items in one projection';

	v_page := public.get_conversation_page(v_user_id, v_conversation_id, null, null, 20);
	assert jsonb_array_length(v_page -> 'messages') = 2,
		'conversation page must return the complete meal turn';
	assert v_page #>> '{journalRecords,0,record,value,revision}' = '2',
		'conversation page must hydrate the latest canonical meal revision';
	assert v_page #>> '{journalRecords,0,record,value,items,1,name}' = 'Kaffe',
		'conversation page must include nested current meal items';

	assert not has_function_privilege(
		'authenticated',
		'public.create_meal_from_chat(uuid,uuid,timestamptz,integer,text,text,timestamptz,date,text,text,jsonb)',
		'execute'
	), 'authenticated must not execute meal creation';
	assert (
		select proargnames = array[
			'p_user_id', 'p_source_turn_id', 'p_turn_lease_expires_at',
			'p_tool_call_index', 'p_meal_type', 'p_occurred_precision', 'p_occurred_at',
			'p_occurred_on', 'p_timezone', 'p_time_period', 'p_items'
		]
		from pg_catalog.pg_proc
		where oid = 'public.create_meal_from_chat(uuid,uuid,timestamptz,integer,text,text,timestamptz,date,text,text,jsonb)'::regprocedure
	), 'meal creation RPC parameter names must match the server contract';
	assert not has_function_privilege(
		'authenticated',
		'public.update_meal(uuid,uuid,integer,uuid,text,text,timestamptz,date,text,text,jsonb)',
		'execute'
	), 'authenticated must not execute meal updates';
	assert has_table_privilege('authenticated', 'public.meals', 'select'),
		'authenticated may read own meals';
	assert has_table_privilege('authenticated', 'public.meal_items', 'select'),
		'authenticated may read own items';
	assert has_table_privilege('authenticated', 'public.meal_item_ingredients', 'select'),
		'authenticated may read own ingredients';
	assert not has_table_privilege('authenticated', 'public.meal_update_receipts', 'select'),
		'mutation receipts must remain server-only';

	assert exists (
		select 1 from pg_indexes
		where schemaname = 'public' and indexname = 'meal_update_receipts_meal_id_idx'
	), 'receipt meal foreign key must be indexed';
	assert exists (
		select 1 from pg_constraint
		where conname = 'meal_items_meal_position_unique' and condeferrable and condeferred
	), 'item positions must use a deferred unique constraint';
	assert exists (
		select 1 from pg_constraint
		where conname = 'meal_item_ingredients_item_position_unique' and condeferrable and condeferred
	), 'ingredient positions must use a deferred unique constraint';

	delete from public.conversations where id = v_conversation_id;
	assert (select count(*) from public.turns where conversation_id = v_conversation_id) = 0,
		'conversation deletion must remove turns';
	assert exists (select 1 from public.meals where id = v_meal_id),
		'conversation deletion must preserve domain records';
	assert (select source_turn_id from public.meals where id = v_meal_id) is null,
		'preserved meal must detach from the deleted turn';

	delete from auth.users where id = v_user_id;
	assert not exists (select 1 from public.meals where user_id = v_user_id),
		'account deletion must cascade to meals';
	assert not exists (
		select 1
		from public.meal_item_ingredients ingredient
		join public.meal_items item on item.id = ingredient.meal_item_id
		join public.meals meal on meal.id = item.meal_id
		where meal.user_id = v_user_id
	), 'account deletion must not leave nested ingredient rows';

	delete from public.conversations where id = v_other_conversation_id;
end;
$$;

do $$
declare
	v_user_id uuid := 'b3000000-0000-4000-8000-000000000000';
	v_other_user_id uuid := 'b4000000-0000-4000-8000-000000000000';
	v_turn_a uuid := gen_random_uuid();
	v_turn_b uuid := gen_random_uuid();
	v_turn_c uuid := gen_random_uuid();
	v_turn_d uuid := gen_random_uuid();
	v_turn_e uuid := gen_random_uuid();
	v_turn_f uuid := gen_random_uuid();
	v_other_turn uuid := gen_random_uuid();
	v_conversation_id uuid;
	v_other_conversation_id uuid;
	v_lease timestamptz;
	v_other_lease timestamptz;
	v_interaction_id uuid;
	v_second_interaction_id uuid;
	v_result jsonb;
	v_replay jsonb;
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
			'meal-duplicate-1@example.invalid',
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
			'meal-duplicate-2@example.invalid',
			'{}'::jsonb,
			'{}'::jsonb,
			now(),
			now()
		);

	v_result := public.begin_chat_turn(
		v_user_id, null, v_turn_a, 'Jag åt havregröt i lördags', 120
	);
	v_conversation_id := (v_result #>> '{conversation,id}')::uuid;
	v_lease := (v_result ->> 'turnLeaseExpiresAt')::timestamptz;
	v_result := public.create_meal_from_chat(
		v_user_id,
		v_turn_a,
		v_lease,
		0,
		'breakfast',
		'date',
		null,
		'2026-08-01',
		'Europe/Stockholm',
		null,
		'[{"name":"Havre  gröt","amountText":"1 skål","ingredients":[]}]'::jsonb
	);
	assert v_result ->> 'status' = 'created', 'first historical meal must be created';
	perform public.complete_chat_turn(v_user_id, v_turn_a, v_lease, 'Registrerat');

	v_result := public.begin_chat_turn(
		v_user_id, v_conversation_id, v_turn_b, 'Jag åt havregröt i lördags', 120
	);
	v_lease := (v_result ->> 'turnLeaseExpiresAt')::timestamptz;
	v_result := public.create_meal_from_chat(
		v_user_id,
		v_turn_b,
		v_lease,
		0,
		'breakfast',
		'date',
		null,
		'2026-08-01',
		'Europe/Stockholm',
		null,
		'[{"name":"havre gröt","amountText":"1 skål","ingredients":[]}]'::jsonb
	);
	assert v_result ->> 'status' = 'confirmation_required',
		'an identical historical date-only meal must require confirmation';
	v_interaction_id := (v_result #>> '{interaction,id}')::uuid;
	assert v_result #>> '{interaction,status}' = 'prepared',
		'interaction must remain prepared before the question commits';
	assert (select count(*) from public.meals where user_id = v_user_id) = 1,
		'duplicate proposal must not create a second meal';

	v_replay := public.create_meal_from_chat(
		v_user_id,
		v_turn_b,
		v_lease,
		0,
		'breakfast',
		'date',
		null,
		'2026-08-01',
		'Europe/Stockholm',
		null,
		'[{"name":"havre gröt","amountText":"1 skål","ingredients":[]}]'::jsonb
	);
	assert (v_replay #>> '{interaction,id}')::uuid = v_interaction_id,
		'same proposal operation must replay the same interaction';
	assert (v_replay ->> 'replayed')::boolean,
		'replayed interaction outcome must be explicit';

	perform public.fail_chat_turn(v_user_id, v_turn_b, v_lease, true);
	v_result := public.begin_chat_turn(
		v_user_id, v_conversation_id, v_turn_b, 'Jag åt havregröt i lördags', 120
	);
	v_lease := (v_result ->> 'turnLeaseExpiresAt')::timestamptz;
	assert (
		select status = 'prepared' and prompt_message_id is null
		from public.pending_interactions where id = v_interaction_id
	), 'retry before finalizer commit must keep the interaction non-answerable';
	perform public.complete_chat_turn(
		v_user_id,
		v_turn_b,
		v_lease,
		'Du har redan registrerat havregröt i lördags. Vill du registrera en till?'
	);
	assert (
		select status = 'pending' and prompt_message_id is not null and activated_at is not null
		from public.pending_interactions where id = v_interaction_id
	), 'assistant commit must activate the interaction atomically';

	v_result := public.begin_chat_turn(v_user_id, v_conversation_id, v_turn_c, 'Ja', 120);
	v_lease := (v_result ->> 'turnLeaseExpiresAt')::timestamptz;
	v_result := public.resolve_meal_duplicate_interaction(
		v_user_id, v_turn_c, v_lease, 0, v_interaction_id, 'register', null
	);
	assert v_result ->> 'status' = 'registered', 'explicit confirmation must create the meal';
	assert (select count(*) from public.meals where user_id = v_user_id) = 2,
		'confirmation must create exactly one additional meal';
	v_replay := public.resolve_meal_duplicate_interaction(
		v_user_id, v_turn_c, v_lease, 0, v_interaction_id, 'register', null
	);
	assert v_replay ->> 'status' = 'registered' and (v_replay ->> 'replayed')::boolean,
		'resolution retry must replay the same registered meal';
	perform public.complete_chat_turn(v_user_id, v_turn_c, v_lease, 'Registrerat');

	v_result := public.begin_chat_turn(
		v_user_id, v_conversation_id, v_turn_d, 'Jag åt havregröt i lördags igen', 120
	);
	v_lease := (v_result ->> 'turnLeaseExpiresAt')::timestamptz;
	v_result := public.create_meal_from_chat(
		v_user_id,
		v_turn_d,
		v_lease,
		0,
		'breakfast',
		'date',
		null,
		'2026-08-01',
		'Europe/Stockholm',
		null,
		'[{"name":"Havre gröt","amountText":"1 skål","ingredients":[]}]'::jsonb
	);
	v_second_interaction_id := (v_result #>> '{interaction,id}')::uuid;
	assert (v_result #>> '{interaction,payload,matchDetails,candidateCount}')::integer = 2,
		'multiple candidates must be represented without creating records';
	perform public.complete_chat_turn(
		v_user_id, v_turn_d, v_lease, 'Vill du registrera ytterligare en havregröt?'
	);

	v_result := public.begin_chat_turn(v_user_id, v_conversation_id, v_turn_e, 'Nej', 120);
	v_lease := (v_result ->> 'turnLeaseExpiresAt')::timestamptz;
	v_result := public.resolve_meal_duplicate_interaction(
		v_user_id,
		v_turn_e,
		v_lease,
		0,
		v_second_interaction_id,
		'discard',
		'user_declined'
	);
	assert v_result ->> 'status' = 'discarded', 'decline must discard the interaction';
	assert (select count(*) from public.meals where user_id = v_user_id) = 2,
		'discard must not create a meal';
	perform public.complete_chat_turn(v_user_id, v_turn_e, v_lease, 'Okej.');

	v_result := public.begin_chat_turn(
		v_user_id, v_conversation_id, v_turn_f, 'Hur ser resten av dagen ut?', 120
	);
	assert v_result ->> 'status' = 'created',
		'an unrelated message after decline must start normally';
	v_lease := (v_result ->> 'turnLeaseExpiresAt')::timestamptz;
	perform public.complete_chat_turn(v_user_id, v_turn_f, v_lease, 'Det ser lugnt ut.');
	assert (
		select status = 'completed'
		from public.turns
		where id = v_turn_f and user_id = v_user_id
	), 'an unrelated message after decline must complete normally';

	v_result := public.begin_chat_turn(
		v_other_user_id, null, v_other_turn, 'Försök lösa någon annans måltid', 120
	);
	v_other_conversation_id := (v_result #>> '{conversation,id}')::uuid;
	v_other_lease := (v_result ->> 'turnLeaseExpiresAt')::timestamptz;
	v_result := public.resolve_meal_duplicate_interaction(
		v_other_user_id,
		v_other_turn,
		v_other_lease,
		0,
		v_second_interaction_id,
		'discard',
		'user_declined'
	);
	assert v_result ->> 'status' = 'not_found',
		'another owner must not resolve the interaction';
	perform public.complete_chat_turn(v_other_user_id, v_other_turn, v_other_lease, 'Kunde inte lösas.');

	assert not has_table_privilege('authenticated', 'public.pending_interactions', 'select'),
		'pending interaction state must remain server-only';
	assert not has_function_privilege(
		'authenticated',
		'public.resolve_meal_duplicate_interaction(uuid,uuid,timestamptz,integer,uuid,text,text)',
		'execute'
	), 'authenticated must not execute interaction resolution';
	assert (
		select proargnames = array[
			'p_user_id', 'p_resolution_turn_id', 'p_turn_lease_expires_at',
			'p_tool_call_index', 'p_interaction_id', 'p_decision', 'p_reason'
		]
		from pg_catalog.pg_proc
		where oid = 'public.resolve_meal_duplicate_interaction(uuid,uuid,timestamptz,integer,uuid,text,text)'::regprocedure
	), 'interaction resolution RPC parameter names must match the server contract';
	assert (
		select pg_get_constraintdef(oid) like '%corrected_input%'
			and pg_get_constraintdef(oid) not like '%corrected_proposal%'
		from pg_catalog.pg_constraint
		where conrelid = 'public.pending_interactions'::regclass
			and conname = 'pending_interactions_lifecycle_check'
	), 'interaction lifecycle reasons must use the canonical corrected_input name';
	assert exists (
		select 1 from pg_indexes
		where schemaname = 'public'
			and indexname = 'pending_interactions_pending_conversation_idx'
	), 'pending interaction lookup must use a partial index';

	delete from public.conversations where id in (v_conversation_id, v_other_conversation_id);
	delete from auth.users where id in (v_user_id, v_other_user_id);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000000', true);

do $$
begin
	assert (select count(*) from public.meals) = 1, 'owner must see only their meal';
	assert (select count(*) from public.meal_items) = 1, 'owner must see only their item';
	assert (select count(*) from public.meal_item_ingredients) = 0,
		'owner must see only their ingredients';
end;
$$;

reset role;
rollback;
