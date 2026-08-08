import { foodLogRecordSchema, foodLogRecordTool } from '$lib/server/chat/tools/food-log-record';
import {
	foodLogResolveRegistrationSchema,
	foodLogResolveRegistrationTool
} from '$lib/server/chat/tools/food-log-resolve-registration';
import { createToolCatalog } from '$lib/server/chat/tools/registry';
import { safeParse } from 'valibot';
import { describe, expect, it, vi } from 'vitest';

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

	it('exposes resolution only when verified pending state exists', () => {
		const withoutPending = createToolCatalog({ hasPendingMealInteraction: false });
		const withPending = createToolCatalog({ hasPendingMealInteraction: true });
		expect(withoutPending.allowedKeys.has('food_log.resolve_registration')).toBe(false);
		expect(withPending.allowedKeys.has('food_log.resolve_registration')).toBe(true);
		expect(withPending.namespaces[0].tools.map((tool) => tool.name)).toEqual(['record']);
		expect(withPending.directTools.map((tool) => tool.name)).toEqual(['resolve_registration']);
		expect(withPending.directTools[0]).not.toHaveProperty('defer_loading');
		expect(withPending.directToolKeyByName.get('resolve_registration')).toBe(
			'food_log.resolve_registration'
		);
		expect(withPending.namespaces[0].description).toContain(
			'Endast confirmation_required från verktyget'
		);
	});

	it('uses an OpenAI-compatible strict object schema for resolution', () => {
		expect(foodLogResolveRegistrationTool.definition.parameters).toMatchObject({
			type: 'object',
			additionalProperties: false,
			required: ['confirmationRef', 'decision', 'reason', 'responseRequired']
		});
		expect(
			safeParse(foodLogResolveRegistrationSchema, {
				confirmationRef: 'pending_meal_1',
				decision: 'register',
				reason: null,
				responseRequired: false
			}).success
		).toBe(true);
		expect(
			safeParse(foodLogResolveRegistrationSchema, {
				confirmationRef: 'pending_meal_1',
				decision: 'discard',
				reason: null,
				responseRequired: false
			}).success
		).toBe(false);
		expect(
			safeParse(foodLogResolveRegistrationSchema, {
				confirmationRef: 'pending_meal_1',
				decision: 'leave_pending',
				reason: 'interaction_followup',
				responseRequired: true
			}).success
		).toBe(true);
	});

	it('leaves a follow-up pending without touching the database', async () => {
		const rpc = vi.fn();
		const result = await foodLogResolveRegistrationTool.execute(
			{
				client: { rpc } as never,
				userId: 'user-id',
				turnId: 'turn-id',
				leaseExpiresAt: '2026-08-07T10:02:00.000Z',
				operationIndex: 0,
				timezone: 'Europe/Stockholm',
				interactionBindings: [
					{
						handle: 'pending_meal_1',
						kind: 'meal_duplicate',
						interactionId: 'interaction-id'
					}
				]
			},
			{
				confirmationRef: 'pending_meal_1',
				decision: 'leave_pending',
				reason: 'interaction_followup',
				responseRequired: true
			} as never
		);

		expect(rpc).not.toHaveBeenCalled();
		expect(result).toEqual({
			output: { status: 'pending', reason: 'interaction_followup' },
			effects: {
				requiresAgentContinuation: true,
				canonicalParts: [],
				responseObligations: []
			}
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
