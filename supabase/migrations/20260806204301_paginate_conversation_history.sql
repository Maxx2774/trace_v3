begin;

drop index if exists public.turns_conversation_owner_idx;

create index turns_conversation_owner_history_idx
	on public.turns (conversation_id, user_id, created_at desc, id desc);

create function public.get_conversation_page(
	p_user_id uuid,
	p_conversation_id uuid,
	p_before_created_at timestamptz,
	p_before_turn_id uuid,
	p_turn_limit integer
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
	v_conversation public.conversations%rowtype;
	v_candidate_turn_ids uuid[];
	v_turn_ids uuid[];
	v_has_older boolean;
	v_oldest_turn public.turns%rowtype;
	v_messages jsonb;
	v_journal_records jsonb;
begin
	if p_user_id is null
		or p_conversation_id is null
		or p_turn_limit not between 1 and 50
		or ((p_before_created_at is null) <> (p_before_turn_id is null)) then
		raise exception using errcode = '22023', message = 'invalid_conversation_page_input';
	end if;

	select * into v_conversation
	from public.conversations
	where id = p_conversation_id and user_id = p_user_id;

	if not found then
		return null;
	end if;

	select coalesce(
		array_agg(candidate.id order by candidate.created_at desc, candidate.id desc),
		'{}'::uuid[]
	)
	into v_candidate_turn_ids
	from (
		select turn_row.id, turn_row.created_at
		from public.turns turn_row
		where turn_row.conversation_id = p_conversation_id
			and turn_row.user_id = p_user_id
			and (
				p_before_created_at is null
				or (turn_row.created_at, turn_row.id) < (p_before_created_at, p_before_turn_id)
			)
		order by turn_row.created_at desc, turn_row.id desc
		limit p_turn_limit + 1
	) candidate;

	v_has_older := cardinality(v_candidate_turn_ids) > p_turn_limit;
	v_turn_ids := v_candidate_turn_ids[1:least(cardinality(v_candidate_turn_ids), p_turn_limit)];

	select coalesce(
		jsonb_agg(
			jsonb_build_object(
				'id', message.id,
				'conversationId', message.conversation_id,
				'turnId', message.turn_id,
				'role', message.role,
				'content', message.content,
				'createdAt', message.created_at
			)
			order by message.created_at, message.id
		),
		'[]'::jsonb
	)
	into v_messages
	from public.messages message
	where message.conversation_id = p_conversation_id
		and message.user_id = p_user_id
		and message.turn_id = any(v_turn_ids);

	select coalesce(jsonb_agg(record order by turn_created_at, source_operation_id), '[]'::jsonb)
	into v_journal_records
	from (
		select
			turn_row.created_at as turn_created_at,
			meal.source_operation_id,
			jsonb_build_object(
				'turnId', meal.source_turn_id,
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
		join public.turns turn_row on turn_row.id = meal.source_turn_id
		where meal.user_id = p_user_id
			and meal.source_turn_id = any(v_turn_ids)
	) records;

	if v_has_older then
		select * into v_oldest_turn
		from public.turns
		where id = v_turn_ids[cardinality(v_turn_ids)] and user_id = p_user_id;
	end if;

	return jsonb_build_object(
		'id', v_conversation.id,
		'title', v_conversation.title,
		'createdAt', v_conversation.created_at,
		'updatedAt', v_conversation.updated_at,
		'lastMessageAt', v_conversation.last_message_at,
		'messages', v_messages,
		'journalRecords', v_journal_records,
		'olderCursor', case
			when v_has_older then jsonb_build_object(
				'createdAt', v_oldest_turn.created_at,
				'turnId', v_oldest_turn.id
			)
			else null
		end
	);
end;
$$;

revoke execute on function public.get_conversation_page(
	uuid, uuid, timestamptz, uuid, integer
) from public, anon, authenticated;

grant execute on function public.get_conversation_page(
	uuid, uuid, timestamptz, uuid, integer
) to service_role;

commit;
