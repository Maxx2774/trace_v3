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
		precision: 'exact' as const,
		occurredAt: '2026-08-06T06:30:00.000Z',
		timezone: 'Europe/Stockholm',
		timeExpression: 'klockan halv nio'
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

	it('accepts an approximate expression without inventing a clock time', () => {
		expect(
			safeParse(foodLogRecordSchema, {
				...base,
				occurred: {
					precision: 'approximate',
					occurredAt: null,
					occurredOn: '2026-08-06',
					timezone: 'Europe/Stockholm',
					timeExpression: 'vid lunch'
				}
			}).success
		).toBe(true);
	});

	it.each([
		{
			precision: 'unknown',
			occurredAt: '2026-08-06T06:30:00.000Z',
			occurredOn: null,
			timezone: null,
			timeExpression: null
		},
		{
			precision: 'date',
			occurredAt: '2026-08-06T06:30:00.000Z',
			occurredOn: '2026-08-06',
			timezone: 'Europe/Stockholm',
			timeExpression: 'i dag'
		},
		{
			precision: 'exact',
			occurredAt: null,
			timezone: 'Europe/Stockholm',
			timeExpression: null
		}
	])('rejects inconsistent $precision occurrence data', (occurred) => {
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
