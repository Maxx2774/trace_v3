import { generateConversationTitle } from '$lib/server/chat/title';
import { describe, expect, it } from 'vitest';

type EvaluationCase = {
	name: string;
	message: string;
	expectedCategory: 'meal' | 'symptom' | 'sleep' | 'weight' | 'general';
};

const canaryCases: EvaluationCase[] = [
	{ name: 'meal canary', message: 'Jag åt gröt igår', expectedCategory: 'meal' }
];

const semanticCases: EvaluationCase[] = [
	{ name: 'meal', message: 'Jag åt gröt igår', expectedCategory: 'meal' },
	{ name: 'symptom', message: 'Jag har ont i magen sedan i morse', expectedCategory: 'symptom' },
	{ name: 'sleep', message: 'Jag sov bara fyra timmar i natt', expectedCategory: 'sleep' },
	{ name: 'weight', message: 'Jag väger 82,4 kg idag', expectedCategory: 'weight' },
	{ name: 'general', message: 'Hur fungerar den här appen?', expectedCategory: 'general' },
	{
		name: 'symptom over incidental meal',
		message: 'Jag fick ont i magen efter att jag åt gröt',
		expectedCategory: 'symptom'
	},
	{
		name: 'sleep over incidental symptom',
		message: 'Jag sov dåligt eftersom magen gjorde ont',
		expectedCategory: 'sleep'
	}
];

const mode = process.env.TRACE_CONVERSATION_TITLE_EVAL;

describe.skipIf(mode !== 'canary')('conversation title provider canary', () => {
	for (const evaluationCase of canaryCases) {
		it(
			evaluationCase.name,
			async () => {
				await expectCase(evaluationCase);
			},
			60_000
		);
	}
});

describe.skipIf(mode !== 'semantic')('conversation title semantic evaluation', () => {
	for (const evaluationCase of semanticCases) {
		it(
			evaluationCase.name,
			async () => {
				await expectCase(evaluationCase);
			},
			60_000
		);
	}
});

async function expectCase(evaluationCase: EvaluationCase): Promise<void> {
	const result = await generateConversationTitle(
		evaluationCase.message,
		'conversation-title-live-evaluation',
		new AbortController().signal
	);

	expect(result?.category).toBe(evaluationCase.expectedCategory);
	expect(result?.title).toEqual(expect.any(String));
	expect(result?.title.length).toBeLessThanOrEqual(60);
}
