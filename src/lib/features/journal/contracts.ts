import type { Meal } from '$lib/features/meals/contracts';

export type JournalRecordReference = {
	type: 'meal';
	recordId: string;
	committedRevision: number;
};

export type JournalRecord = {
	kind: 'meal';
	reference: JournalRecordReference;
	value: Meal;
};

export type TurnJournalRecord = {
	turnId: string;
	record: JournalRecord;
};
