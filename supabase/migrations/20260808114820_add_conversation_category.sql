begin;

alter table public.conversations
	add column category text not null default 'general',
	add constraint conversations_category_check check (
		category in ('meal', 'symptom', 'sleep', 'weight', 'general')
	);

commit;
