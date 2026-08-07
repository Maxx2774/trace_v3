import { buildModelContext } from '$lib/server/chat/history';
import type { TurnJournalRecord } from '$lib/features/journal/contracts';
import type { MealDuplicateInteractionV1 } from '$lib/features/meals/contracts';
import { describe, expect, it } from 'vitest';
import { mealFixture, mealRecordFixture } from '../../helpers/meals';

describe('buildModelContext', () => {
	it('includes the immutable current message exactly once and preserves whole turns', () => {
		const context = buildModelContext({
			history: [
				message('turn-1', 'user', 'Första frågan', 0),
				message('turn-1', 'assistant', 'Första svaret', 1),
				message('incomplete', 'user', 'Saknar svar', 2),
				message('turn-2', 'user', 'Andra frågan', 3),
				message('turn-2', 'assistant', 'Andra svaret', 4)
			],
			journalRecords: [],
			current: { turnId: 'current', content: 'Aktuellt meddelande' },
			systemPrompt: 'System',
			timezone: 'Europe/Stockholm',
			now: new Date('2026-08-06T12:00:00.000Z')
		});

		expect(context.messages.filter((item) => item.content === 'Aktuellt meddelande')).toHaveLength(
			1
		);
		expect(context.messages.some((item) => item.content === 'Saknar svar')).toBe(false);
		expect(context.messages.map((item) => item.content)).toEqual([
			'Första frågan',
			'Första svaret',
			'Andra frågan',
			'Andra svaret',
			expect.stringContaining(
				'Aktuellt lokalt datum: 2026-08-06\nAktuell lokal tid: 14:00\nVerifierad tidszon: Europe/Stockholm'
			),
			'Aktuellt meddelande'
		]);
	});

	it('projects journal records through symbolic handles without exposing ids', () => {
		const record = mealRecord();
		const context = buildModelContext({
			history: [
				message('turn-1', 'user', 'Jag åt', 0),
				message('turn-1', 'assistant', 'Sparat', 1)
			],
			journalRecords: [record],
			current: { turnId: 'current', content: 'Hur känns det?' },
			systemPrompt: 'System',
			timezone: 'Europe/Stockholm',
			now: new Date('2026-08-06T12:00:00.000Z')
		});

		const serialized = JSON.stringify(context.messages);
		expect(serialized).toContain('ref_1');
		expect(serialized).toContain('Gröt');
		expect(serialized).toContain('breakfast');
		expect(serialized).toContain('occurrence');
		expect(serialized).not.toContain(record.record.value.id);
		expect(context.referenceBindings).toEqual([
			{ handle: 'ref_1', kind: 'meal', recordId: record.record.value.id }
		]);
	});

	it('projects only symbolic handles and verified payload for pending interactions', () => {
		const interaction = pendingInteraction();
		const context = buildModelContext({
			history: [],
			journalRecords: [],
			pendingInteractions: [interaction],
			current: { turnId: 'current', content: 'Ja' },
			systemPrompt: 'System',
			timezone: 'Europe/Stockholm',
			now: new Date('2026-08-06T12:00:00.000Z')
		});

		const serialized = JSON.stringify(context.messages);
		expect(serialized).toContain('pending_meal_1');
		expect(serialized).toContain('Gröt');
		expect(serialized).toContain('En hälsning eller en fråga om ett orelaterat ämne');
		expect(serialized).not.toContain(interaction.id);
		expect(context.interactionBindings).toEqual([
			{ handle: 'pending_meal_1', kind: 'meal_duplicate', interactionId: interaction.id }
		]);
	});
});

function message(turnId: string, role: 'user' | 'assistant', content: string, seconds: number) {
	return {
		turnId,
		role,
		content,
		createdAt: new Date(Date.UTC(2026, 7, 6, 12, 0, seconds)).toISOString()
	};
}

function mealRecord(): TurnJournalRecord {
	const meal = mealFixture({ id: 'meal-internal-id' });
	return {
		turnId: 'turn-1',
		record: mealRecordFixture(meal)
	};
}

function pendingInteraction(): MealDuplicateInteractionV1 {
	const meal = mealFixture();
	const summary = {
		mealType: meal.mealType,
		occurrence: meal.occurrence,
		items: meal.items.map((item) => ({
			name: item.name,
			amountText: item.amountText,
			ingredients: item.ingredients.map((ingredient) => ({
				name: ingredient.name,
				amountText: ingredient.amountText
			}))
		}))
	};
	return {
		id: 'internal-interaction-id',
		kind: 'meal_duplicate',
		status: 'pending',
		schemaVersion: 1,
		policyVersion: 1,
		proposalTurnId: 'turn-1',
		proposalOperationId: '30000000-0000-4000-8000-000000000000:0',
		proposalInputHash: 'a'.repeat(64),
		resolutionTurnId: null,
		resolutionOperationId: null,
		resolutionReason: null,
		payload: {
			proposedMeal: summary,
			existingMealSnapshot: summary,
			matchDetails: {
				policyVersion: 1,
				anchor: 'identical_payload',
				timeDifferenceMinutes: null,
				candidateCount: 1,
				differences: { mealType: 'match', amounts: 'match', ingredients: 'match' }
			}
		},
		createdAt: '2026-08-06T10:00:00.000Z',
		activatedAt: '2026-08-06T10:00:01.000Z',
		resolvedAt: null
	};
}
