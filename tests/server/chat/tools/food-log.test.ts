import { foodLogRecordSchema, foodLogRecordTool } from '$lib/server/chat/tools/food-log';
import { safeParse } from 'valibot';
import { describe, expect, it } from 'vitest';

const base = {
	responseRequired: false,
	mealType: 'breakfast' as const,
	items: [
		{
			name: 'Gröt',
			amountText: null,
			ingredients: [
				{ name: 'Havregryn', amountText: null },
				{ name: 'Banan', amountText: '1 st' }
			]
		}
	],
	occurred: {
		date: '2026-08-06',
		time: { kind: 'exact' as const, localTime: '08:30' }
	}
};

describe('food_log.record', () => {
	it('is deferred, strict and namespaced as record', () => {
		expect(foodLogRecordTool.key).toBe('food_log.record');
		expect(foodLogRecordTool.definition).toMatchObject({
			name: 'record',
			defer_loading: true,
			strict: true
		});
	});

	it('accepts nested items, explicit ingredients and exact time', () => {
		expect(safeParse(foodLogRecordSchema, base).success).toBe(true);
	});

	it('accepts a controlled period without inventing a clock time', () => {
		expect(
			safeParse(foodLogRecordSchema, {
				...base,
				occurred: {
					date: '2026-08-06',
					time: { kind: 'period', value: 'lunch' }
				}
			}).success
		).toBe(true);
	});

	it('represents yesterday as a date without duplicating it as a time expression', () => {
		expect(
			safeParse(foodLogRecordSchema, {
				...base,
				occurred: { date: '2026-08-05', time: null }
			}).success
		).toBe(true);
	});

	it.each([
		{
			date: null,
			time: { kind: 'exact', localTime: '08:30' }
		},
		{
			date: '2026-08-06',
			time: { kind: 'approximate', localTime: 'halv nio' }
		},
		{
			date: '2026-08-06',
			time: null,
			timezone: 'Europe/Stockholm'
		}
	])('rejects inconsistent or model-generated server fields', (occurred) => {
		expect(safeParse(foodLogRecordSchema, { ...base, occurred }).success).toBe(false);
	});

	it('rejects implicit or extra ingredient fields', () => {
		expect(
			safeParse(foodLogRecordSchema, {
				...base,
				items: [
					{
						name: 'Lasagne',
						amountText: null,
						ingredients: [{ name: 'Ost', amountText: null, assumed: true }]
					}
				]
			}).success
		).toBe(false);
	});

	it('rejects an empty meal and excessive nested payloads', () => {
		expect(safeParse(foodLogRecordSchema, { ...base, items: [] }).success).toBe(false);
		expect(
			safeParse(foodLogRecordSchema, {
				...base,
				items: [
					{
						name: 'Buffé',
						amountText: null,
						ingredients: Array.from({ length: 31 }, (_, index) => ({
							name: `Ingrediens ${index}`,
							amountText: null
						}))
					}
				]
			}).success
		).toBe(false);
	});
});
