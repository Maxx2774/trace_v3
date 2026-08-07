import { LOCAL_TIME_PATTERN } from '$lib/date-time';
import {
	MEAL_LIMITS,
	MEAL_TIME_PERIODS,
	MEAL_TYPES,
	type MealOccurrenceExtraction
} from '$lib/features/meals/contracts';
import { occurrenceFromExtraction } from '$lib/features/meals/meal-time';
import {
	hasAllowedIngredientCount,
	hasAllowedMealPayloadSize,
	mealNameSchema,
	mealTimePeriodSchema,
	mealTypeSchema,
	nullableMealAmountSchema
} from '$lib/features/meals/validation';
import { createMealFromChat, type RecordMealInput } from '$lib/server/meals/meals';
import type { RegisteredTool } from './registry';
import * as v from 'valibot';

const localTime = v.pipe(v.string(), v.regex(LOCAL_TIME_PATTERN));
const timeSchema = v.union([
	v.strictObject({ kind: v.literal('exact'), localTime }),
	v.strictObject({ kind: v.literal('approximate'), localTime }),
	v.strictObject({
		kind: v.literal('period'),
		value: mealTimePeriodSchema
	})
]);
const occurrenceSchema = v.pipe(
	v.strictObject({
		date: v.nullable(v.pipe(v.string(), v.isoDate())),
		time: v.nullable(timeSchema)
	}),
	v.check(
		(occurrence) => occurrence.date !== null || occurrence.time === null,
		'En tid kräver datum.'
	)
);

const ingredientSchema = v.strictObject({
	name: mealNameSchema,
	amountText: nullableMealAmountSchema
});
const itemSchema = v.strictObject({
	name: mealNameSchema,
	amountText: nullableMealAmountSchema,
	ingredients: v.pipe(v.array(ingredientSchema), v.maxLength(MEAL_LIMITS.maxIngredientsPerItem))
});

export const foodLogRecordSchema = v.pipe(
	v.strictObject({
		responseRequired: v.boolean(),
		mealType: mealTypeSchema,
		items: v.pipe(v.array(itemSchema), v.minLength(1), v.maxLength(MEAL_LIMITS.maxItems)),
		occurred: occurrenceSchema
	}),
	v.check(
		(input) => hasAllowedIngredientCount(input.items),
		'Måltiden innehåller för många ingredienser.'
	),
	v.check((input) => hasAllowedMealPayloadSize(input), 'Måltidsregistreringen är för stor.')
);

const amountProperty = {
	type: ['string', 'null'],
	minLength: 1,
	maxLength: MEAL_LIMITS.maxAmountLength
} as const;
const definition = {
	type: 'function',
	name: 'record',
	description:
		'Registrera exakt ett konsumtionstillfälle för mat eller dryck som användaren själv faktiskt har konsumerat. Sätt responseRequired till true endast när användaren också ställer en faktisk fråga eller begär något som kräver ett naturligt svar efter registreringen; en ren registrering, ett tack eller en begäran om bekräftelse ska vara false. MealItem är en separat rätt, mat, dryck eller ett tillbehör i användarens beskrivning. MealIngredient är endast en uttryckligen beskriven beståndsdel i ett namngivet item; ordet "med" betyder inte automatiskt ingrediens. Exempel: "äggröra med 4 ägg och smör" är itemet Äggröra med ingredienserna Ägg (amountText 4) och Smör, medan "biff med pommes och bearnaisesås" är tre items utan härledda ingredienser. Fyll aldrig i sannolika receptingredienser. Sätt mealType endast när den framgår uttryckligen eller är bekräftad, annars null. Dela bara name och amountText när mängden är tydlig; bevara annars hela uttrycket i name och sätt amountText null. occurred.date är det tolkade lokala datumet i YYYY-MM-DD eller null när datumet är okänt. Datumord som "igår" hör endast till date: "igår" ger föregående lokala datum och time null. Använd time.kind exact eller approximate bara för ett uttryckligt klockslag i HH:MM. Använd period endast för en uttrycklig del av dagen: morning, lunch, afternoon, evening eller night. "Igår kväll" ger gårdagens date och period evening. Hitta aldrig på en klocktid.',
	defer_loading: true,
	strict: true,
	parameters: {
		type: 'object',
		additionalProperties: false,
		properties: {
			responseRequired: { type: 'boolean' },
			mealType: {
				type: ['string', 'null'],
				enum: [...MEAL_TYPES, null]
			},
			items: {
				type: 'array',
				minItems: 1,
				maxItems: MEAL_LIMITS.maxItems,
				items: {
					type: 'object',
					additionalProperties: false,
					properties: {
						name: { type: 'string', minLength: 1, maxLength: MEAL_LIMITS.maxNameLength },
						amountText: amountProperty,
						ingredients: {
							type: 'array',
							maxItems: MEAL_LIMITS.maxIngredientsPerItem,
							items: {
								type: 'object',
								additionalProperties: false,
								properties: {
									name: {
										type: 'string',
										minLength: 1,
										maxLength: MEAL_LIMITS.maxNameLength
									},
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
				type: 'object',
				additionalProperties: false,
				properties: {
					date: { type: ['string', 'null'], format: 'date' },
					time: {
						anyOf: [
							{ type: 'null' },
							{
								type: 'object',
								additionalProperties: false,
								properties: {
									kind: { type: 'string', enum: ['exact'] },
									localTime: { type: 'string', pattern: LOCAL_TIME_PATTERN.source }
								},
								required: ['kind', 'localTime']
							},
							{
								type: 'object',
								additionalProperties: false,
								properties: {
									kind: { type: 'string', enum: ['approximate'] },
									localTime: { type: 'string', pattern: LOCAL_TIME_PATTERN.source }
								},
								required: ['kind', 'localTime']
							},
							{
								type: 'object',
								additionalProperties: false,
								properties: {
									kind: { type: 'string', enum: ['period'] },
									value: {
										type: 'string',
										enum: [...MEAL_TIME_PERIODS]
									}
								},
								required: ['kind', 'value']
							}
						]
					}
				},
				required: ['date', 'time']
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
			occurred: occurrenceFromExtraction(
				input.occurred as MealOccurrenceExtraction,
				context.timezone
			)
		};
		const result = await createMealFromChat(context.client, {
			userId: context.userId,
			turnId: context.turnId,
			leaseExpiresAt: context.leaseExpiresAt,
			operationIndex: context.operationIndex,
			meal: mealInput
		});

		if (result.status === 'confirmation_required') {
			const confirmationRef = `pending_meal_${context.interactionBindings.length + context.operationIndex + 1}`;
			const obligationRef = `response_${context.operationIndex + 1}`;
			return {
				output: {
					status: 'confirmation_required',
					confirmationRef,
					mealCreated: false,
					requiredAction: 'ask_for_confirmation',
					obligationRef,
					proposedMeal: result.interaction.payload.proposedMeal,
					existingMeal: result.interaction.payload.existingMealSnapshot,
					match: result.interaction.payload.matchDetails
				},
				effects: {
					requiresAgentContinuation: input.responseRequired,
					canonicalParts: [],
					responseObligations: [
						{
							ref: obligationRef,
							kind: 'ask_meal_duplicate_confirmation' as const,
							schemaVersion: 1 as const,
							confirmationRef,
							proposedMeal: result.interaction.payload.proposedMeal,
							existingMeal: result.interaction.payload.existingMealSnapshot,
							match: result.interaction.payload.matchDetails
						}
					]
				}
			};
		}

		const record = {
			kind: 'meal' as const,
			reference: {
				type: 'meal' as const,
				recordId: result.meal.id,
				committedRevision: result.meal.revision
			},
			value: result.meal
		};
		return {
			output: { status: 'created', meal: result.meal },
			effects: {
				requiresAgentContinuation: input.responseRequired,
				canonicalParts: [
					{ kind: 'text' as const, text: 'Registrerat' },
					{ kind: 'journal_record' as const, record }
				],
				responseObligations: []
			}
		};
	}
} satisfies RegisteredTool;
