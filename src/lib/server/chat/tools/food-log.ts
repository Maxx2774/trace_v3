import type { MealOccurrenceInput } from '$lib/features/meals/contracts';
import { createMealFromChat, type RecordMealInput } from '$lib/server/meals/meals';
import type { RegisteredTool } from './registry';
import * as v from 'valibot';

const text = (maxLength: number) =>
	v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(maxLength));
const nullableAmount = v.nullable(text(80));
const timezone = v.pipe(text(255), v.check(validTimezone, 'Ogiltig tidszon.'));

const occurrenceSchema = v.union([
	v.strictObject({
		precision: v.literal('exact'),
		occurredAt: v.pipe(v.string(), v.isoTimestamp()),
		timezone,
		timeExpression: v.nullable(text(160))
	}),
	v.strictObject({
		precision: v.literal('approximate'),
		occurredAt: v.pipe(v.string(), v.isoTimestamp()),
		timezone,
		timeExpression: text(160)
	}),
	v.strictObject({
		precision: v.literal('approximate'),
		occurredAt: v.null(),
		occurredOn: v.pipe(v.string(), v.isoDate()),
		timezone,
		timeExpression: text(160)
	}),
	v.strictObject({
		precision: v.literal('date'),
		occurredAt: v.null(),
		occurredOn: v.pipe(v.string(), v.isoDate()),
		timezone,
		timeExpression: v.nullable(text(160))
	}),
	v.strictObject({
		precision: v.literal('unknown'),
		occurredAt: v.null(),
		occurredOn: v.null(),
		timezone: v.null(),
		timeExpression: v.null()
	})
]);

const ingredientSchema = v.strictObject({
	name: text(160),
	amountText: nullableAmount
});
const itemSchema = v.strictObject({
	name: text(160),
	amountText: nullableAmount,
	ingredients: v.pipe(v.array(ingredientSchema), v.maxLength(30))
});

export const foodLogRecordSchema = v.pipe(
	v.strictObject({
		responseRequired: v.boolean(),
		mealType: v.nullable(v.picklist(['breakfast', 'lunch', 'dinner', 'snack', 'other'])),
		items: v.pipe(v.array(itemSchema), v.minLength(1), v.maxLength(20)),
		occurred: occurrenceSchema
	}),
	v.check(
		(input) => input.items.reduce((total, item) => total + item.ingredients.length, 0) <= 100,
		'Måltiden innehåller för många ingredienser.'
	),
	v.check((input) => serializedSize(input) <= 32 * 1024, 'Måltidsregistreringen är för stor.')
);

const amountProperty = {
	type: ['string', 'null'],
	minLength: 1,
	maxLength: 80
} as const;
const timezoneProperty = { type: 'string', minLength: 1, maxLength: 255 } as const;
const expressionProperty = {
	type: ['string', 'null'],
	minLength: 1,
	maxLength: 160
} as const;

const definition = {
	type: 'function',
	name: 'record',
	description:
		'Registrera exakt ett konsumtionstillfälle för mat eller dryck som användaren själv faktiskt har konsumerat. Sätt responseRequired till true endast när användaren också ställer en faktisk fråga eller begär något som kräver ett naturligt svar efter registreringen; en ren registrering, ett tack eller en begäran om bekräftelse ska vara false. MealItem är en separat rätt, mat, dryck eller ett tillbehör i användarens beskrivning. MealIngredient är endast en uttryckligen beskriven beståndsdel i ett namngivet item; ordet "med" betyder inte automatiskt ingrediens. Exempel: "äggröra med 4 ägg och smör" är itemet Äggröra med ingredienserna Ägg (amountText 4) och Smör, medan "biff med pommes och bearnaisesås" är tre items utan härledda ingredienser. Fyll aldrig i sannolika receptingredienser. Sätt mealType endast när den framgår uttryckligen eller är bekräftad, annars null. Dela bara name och amountText när mängden är tydlig; bevara annars hela uttrycket i name och sätt amountText null. Bevara tidsuttryckets precision och hitta aldrig på en klocktid.',
	defer_loading: true,
	strict: true,
	parameters: {
		type: 'object',
		additionalProperties: false,
		properties: {
			responseRequired: { type: 'boolean' },
			mealType: {
				type: ['string', 'null'],
				enum: ['breakfast', 'lunch', 'dinner', 'snack', 'other', null]
			},
			items: {
				type: 'array',
				minItems: 1,
				maxItems: 20,
				items: {
					type: 'object',
					additionalProperties: false,
					properties: {
						name: { type: 'string', minLength: 1, maxLength: 160 },
						amountText: amountProperty,
						ingredients: {
							type: 'array',
							maxItems: 30,
							items: {
								type: 'object',
								additionalProperties: false,
								properties: {
									name: { type: 'string', minLength: 1, maxLength: 160 },
									amountText: amountProperty
								},
								required: ['name', 'amountText']
							}
						}
					},
					required: ['name', 'amountText', 'ingredients']
				}
			},
			occurred: {
				anyOf: [
					{
						type: 'object',
						additionalProperties: false,
						properties: {
							precision: { type: 'string', enum: ['exact'] },
							occurredAt: { type: 'string', format: 'date-time' },
							timezone: timezoneProperty,
							timeExpression: expressionProperty
						},
						required: ['precision', 'occurredAt', 'timezone', 'timeExpression']
					},
					{
						type: 'object',
						additionalProperties: false,
						properties: {
							precision: { type: 'string', enum: ['approximate'] },
							occurredAt: { type: 'string', format: 'date-time' },
							timezone: timezoneProperty,
							timeExpression: { type: 'string', minLength: 1, maxLength: 160 }
						},
						required: ['precision', 'occurredAt', 'timezone', 'timeExpression']
					},
					{
						type: 'object',
						additionalProperties: false,
						properties: {
							precision: { type: 'string', enum: ['approximate'] },
							occurredAt: { type: 'null' },
							occurredOn: { type: 'string', format: 'date' },
							timezone: timezoneProperty,
							timeExpression: { type: 'string', minLength: 1, maxLength: 160 }
						},
						required: ['precision', 'occurredAt', 'occurredOn', 'timezone', 'timeExpression']
					},
					{
						type: 'object',
						additionalProperties: false,
						properties: {
							precision: { type: 'string', enum: ['date'] },
							occurredAt: { type: 'null' },
							occurredOn: { type: 'string', format: 'date' },
							timezone: timezoneProperty,
							timeExpression: expressionProperty
						},
						required: ['precision', 'occurredAt', 'occurredOn', 'timezone', 'timeExpression']
					},
					{
						type: 'object',
						additionalProperties: false,
						properties: {
							precision: { type: 'string', enum: ['unknown'] },
							occurredAt: { type: 'null' },
							occurredOn: { type: 'null' },
							timezone: { type: 'null' },
							timeExpression: { type: 'null' }
						},
						required: ['precision', 'occurredAt', 'occurredOn', 'timezone', 'timeExpression']
					}
				]
			}
		},
		required: ['responseRequired', 'mealType', 'items', 'occurred']
	}
} as const;

export const foodLogRecordTool = {
	key: 'food_log.record',
	definition,
	schema: foodLogRecordSchema,
	policy: { effect: 'write', parallelSafe: true },
	async execute(context, args) {
		const input = args as v.InferOutput<typeof foodLogRecordSchema>;
		const mealInput: RecordMealInput = {
			mealType: input.mealType,
			items: input.items,
			occurred: input.occurred as MealOccurrenceInput
		};
		const meal = await createMealFromChat(context.client, {
			userId: context.userId,
			turnId: context.turnId,
			leaseExpiresAt: context.leaseExpiresAt,
			operationIndex: context.operationIndex,
			meal: mealInput
		});

		return {
			output: { status: 'created', meal },
			continueModel: input.responseRequired,
			record: {
				kind: 'meal' as const,
				reference: { type: 'meal' as const, recordId: meal.id, committedRevision: meal.revision },
				value: meal
			}
		};
	}
} satisfies RegisteredTool;

function serializedSize(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function validTimezone(value: string): boolean {
	try {
		new Intl.DateTimeFormat('sv-SE', { timeZone: value }).format();
		return true;
	} catch {
		return false;
	}
}
