import {
	createMealOccurrenceDraft,
	mealOccurrenceFromDraft,
	removeMealIngredient,
	removeMealItem,
	upsertMealIngredient,
	upsertMealItem
} from '$lib/features/meals/meal-mutations';
import { describe, expect, it } from 'vitest';
import { mealFixture } from '../../helpers/meals';

describe('meal item mutations', () => {
	it('updates and adds meal items without mutating the canonical meal', () => {
		const meal = mealFixture();
		const updated = upsertMealItem(meal.items, {
			id: meal.items[0].id,
			name: ' Havregrynsgröt ',
			amountText: ' 1 portion '
		});
		const added = upsertMealItem(meal.items, {
			id: null,
			name: 'Kaffe',
			amountText: ' '
		});

		expect(updated[0]).toMatchObject({ name: 'Havregrynsgröt', amountText: '1 portion' });
		expect(added.at(-1)).toEqual({
			id: null,
			name: 'Kaffe',
			amountText: null,
			ingredients: []
		});
		expect(meal.items[0].name).toBe('Gröt');
		expect(
			removeMealItem(
				[
					...meal.items,
					{
						id: '43000000-0000-4000-8000-000000000000',
						name: 'Kaffe',
						amountText: null,
						ingredients: []
					}
				],
				meal.items[0].id
			)
		).toHaveLength(1);
	});

	it('updates, adds and removes ingredients under the correct item', () => {
		const meal = mealFixture();
		const item = meal.items[0];
		const ingredient = item.ingredients[0];
		const updated = upsertMealIngredient(meal.items, {
			itemId: item.id,
			id: ingredient.id,
			name: ' Havre ',
			amountText: ' 1 dl '
		});
		const added = upsertMealIngredient(meal.items, {
			itemId: item.id,
			id: null,
			name: 'Banan',
			amountText: '1 st'
		});

		expect(updated[0].ingredients[0]).toMatchObject({ name: 'Havre', amountText: '1 dl' });
		expect(added[0].ingredients).toHaveLength(2);
		expect(removeMealIngredient(meal.items, item.id, ingredient.id)[0].ingredients).toEqual([]);
	});

	it('rejects empty names and missing parent items', () => {
		const meal = mealFixture();
		expect(() =>
			upsertMealItem(meal.items, { id: meal.items[0].id, name: ' ', amountText: '' })
		).toThrow('Namnet får inte vara tomt.');
		expect(() =>
			upsertMealIngredient(meal.items, {
				itemId: '90000000-0000-4000-8000-000000000000',
				id: null,
				name: 'Banan',
				amountText: ''
			})
		).toThrow('Måltidsdelen hittades inte.');
	});
});

describe('meal occurrence mutations', () => {
	it('creates an editable draft from the canonical occurrence', () => {
		const draft = createMealOccurrenceDraft(
			{
				precision: 'exact',
				occurredAt: '2026-08-06T06:30:00.000Z',
				occurredOn: '2026-08-06',
				timezone: 'Europe/Stockholm',
				timePeriod: null
			},
			new Date('2026-08-07T10:00:00.000Z'),
			'UTC'
		);

		expect(draft).toEqual({
			precision: 'exact',
			date: '2026-08-06',
			time: '08:30',
			timezone: 'Europe/Stockholm',
			timePeriod: null
		});
	});

	it('converts drafts back to canonical occurrence inputs', () => {
		expect(
			mealOccurrenceFromDraft({
				precision: 'approximate',
				date: '2026-08-06',
				time: '',
				timezone: 'Europe/Stockholm',
				timePeriod: 'evening'
			})
		).toEqual({
			precision: 'approximate',
			occurredAt: null,
			occurredOn: '2026-08-06',
			timezone: 'Europe/Stockholm',
			timePeriod: 'evening'
		});
	});
});
