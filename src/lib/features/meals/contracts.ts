export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'other'] as const;
export const MEAL_TIME_PERIODS = ['morning', 'lunch', 'afternoon', 'evening', 'night'] as const;

export const MEAL_LIMITS = {
	maxNameLength: 160,
	maxAmountLength: 80,
	maxItems: 20,
	maxIngredientsPerItem: 30,
	maxIngredients: 100,
	maxPayloadBytes: 32 * 1024
} as const;

export type MealType = (typeof MEAL_TYPES)[number];
export type MealTimePeriod = (typeof MEAL_TIME_PERIODS)[number];

export type MealOccurrence =
	| {
			precision: 'exact';
			occurredAt: string;
			occurredOn: string;
			timezone: string;
			timePeriod: null;
	  }
	| {
			precision: 'approximate';
			occurredAt: string;
			occurredOn: string;
			timezone: string;
			timePeriod: null;
	  }
	| {
			precision: 'approximate';
			occurredAt: null;
			occurredOn: string;
			timezone: string;
			timePeriod: MealTimePeriod;
	  }
	| {
			precision: 'date';
			occurredAt: null;
			occurredOn: string;
			timezone: string;
			timePeriod: null;
	  }
	| {
			precision: 'unknown';
			occurredAt: null;
			occurredOn: null;
			timezone: null;
			timePeriod: null;
	  };

export type MealOccurrenceInput =
	| {
			precision: 'exact';
			occurredAt: string;
			timezone: string;
			timePeriod: null;
	  }
	| {
			precision: 'approximate';
			occurredAt: string;
			timezone: string;
			timePeriod: null;
	  }
	| {
			precision: 'approximate';
			occurredAt: null;
			occurredOn: string;
			timezone: string;
			timePeriod: MealTimePeriod;
	  }
	| {
			precision: 'date';
			occurredAt: null;
			occurredOn: string;
			timezone: string;
			timePeriod: null;
	  }
	| {
			precision: 'unknown';
			occurredAt: null;
			occurredOn: null;
			timezone: null;
			timePeriod: null;
	  };

export type MealOccurrenceExtraction = {
	date: string | null;
	time:
		| { kind: 'exact'; localTime: string }
		| { kind: 'approximate'; localTime: string }
		| { kind: 'period'; value: MealTimePeriod }
		| null;
};

export type MealIngredient = {
	id: string;
	name: string;
	amountText: string | null;
};

export type MealItem = {
	id: string;
	name: string;
	amountText: string | null;
	ingredients: MealIngredient[];
};

export type MealItemMutationInput = {
	id: string | null;
	name: string;
	amountText: string | null;
	ingredients: Array<{
		id: string | null;
		name: string;
		amountText: string | null;
	}>;
};

export type Meal = {
	id: string;
	revision: number;
	mealType: MealType | null;
	items: MealItem[];
	occurrence: MealOccurrence;
	createdAt: string;
	updatedAt: string;
};

export type UpdateMealInput = {
	id: string;
	expectedRevision: number;
	clientMutationId: string;
	mealType: MealType | null;
	occurrence: MealOccurrenceInput;
	items: MealItemMutationInput[];
};

const MEAL_TYPE_LABELS = {
	breakfast: 'Frukost',
	lunch: 'Lunch',
	dinner: 'Middag',
	snack: 'Mellanmål',
	other: 'Annat'
} satisfies Record<MealType, string>;

const MEAL_TIME_PERIOD_LABELS = {
	morning: 'På morgonen',
	lunch: 'Vid lunch',
	afternoon: 'På eftermiddagen',
	evening: 'På kvällen',
	night: 'På natten'
} satisfies Record<MealTimePeriod, string>;

export const MEAL_TYPE_OPTIONS: ReadonlyArray<{ value: MealType; label: string }> = MEAL_TYPES.map(
	(value) => ({ value, label: MEAL_TYPE_LABELS[value] })
);

export const MEAL_TIME_PERIOD_OPTIONS: ReadonlyArray<{
	value: MealTimePeriod;
	label: string;
}> = MEAL_TIME_PERIODS.map((value) => ({ value, label: MEAL_TIME_PERIOD_LABELS[value] }));

export function mealTypeLabel(mealType: MealType | null): string {
	return MEAL_TYPE_OPTIONS.find((option) => option.value === mealType)?.label ?? 'Välj måltidstyp';
}

export function isMealType(value: unknown): value is MealType {
	return typeof value === 'string' && (MEAL_TYPES as readonly string[]).includes(value);
}

export function isMealTimePeriod(value: unknown): value is MealTimePeriod {
	return typeof value === 'string' && (MEAL_TIME_PERIODS as readonly string[]).includes(value);
}
