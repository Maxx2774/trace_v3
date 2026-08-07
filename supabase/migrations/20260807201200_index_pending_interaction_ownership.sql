begin;

drop index if exists public.pending_interactions_proposal_turn_idx;
drop index if exists public.pending_interactions_resolution_turn_idx;
drop index if exists public.pending_interactions_prompt_message_idx;

create index pending_interactions_conversation_owner_idx
	on public.pending_interactions (conversation_id, user_id);
create index pending_interactions_proposal_turn_owner_idx
	on public.pending_interactions (proposal_turn_id, conversation_id, user_id);
create index pending_interactions_resolution_turn_owner_idx
	on public.pending_interactions (resolution_turn_id, conversation_id, user_id)
	where resolution_turn_id is not null;
create index pending_interactions_prompt_message_owner_idx
	on public.pending_interactions (prompt_message_id, conversation_id, user_id)
	where prompt_message_id is not null;

commit;
