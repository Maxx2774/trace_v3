begin;

drop index if exists public.messages_conversation_history_idx;

create index messages_conversation_owner_history_idx
	on public.messages (conversation_id, user_id, created_at desc, id desc);

commit;
