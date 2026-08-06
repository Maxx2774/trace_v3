export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';

export type MealOccurrence =
	| {
			precision: 'exact';
			occurredAt: string;
			occurredOn: string;
			timezone: string;
			timeExpression: string | null;
	  }
	| {
			precision: 'approximate';
			occurredAt: string | null;
			occurredOn: string;
			timezone: string;
			timeExpression: string;
	  }
	| {
			precision: 'date';
			occurredAt: null;
			occurredOn: string;
			timezone: string;
			timeExpression: string | null;
	  }
	| {
			precision: 'unknown';
			occurredAt: null;
			occurredOn: null;
			timezone: null;
			timeExpression: null;
	  };

export type MealOccurrenceInput =
	| {
			precision: 'exact';
			occurredAt: string;
			timezone: string;
			timeExpression: string | null;
	  }
	| {
			precision: 'approximate';
			occurredAt: string;
			timezone: string;
			timeExpression: string;
	  }
	| {
			precision: 'approximate';
			occurredAt: null;
			occurredOn: string;
			timezone: string;
			timeExpression: string;
	  }
	| {
			precision: 'date';
			occurredAt: null;
			occurredOn: string;
			timezone: string;
			timeExpression: string | null;
	  }
	| {
			precision: 'unknown';
			occurredAt: null;
			occurredOn: null;
			timezone: null;
			timeExpression: null;
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

export const MEAL_TYPE_OPTIONS: ReadonlyArray<{ value: MealType; label: string }> = [
	{ value: 'breakfast', label: 'Frukost' },
	{ value: 'lunch', label: 'Lunch' },
	{ value: 'dinner', label: 'Middag' },
	{ value: 'snack', label: 'Mellanmål' },
	{ value: 'other', label: 'Annat' }
];

export function mealTypeLabel(mealType: MealType | null): string {
	return MEAL_TYPE_OPTIONS.find((option) => option.value === mealType)?.label ?? 'Välj måltidstyp';
}

export function mealItemsForMutation(items: MealItem[]): MealItemMutationInput[] {
	return items.map((item) => ({
		id: item.id,
		name: item.name,
		amountText: item.amountText,
		ingredients: item.ingredients.map((ingredient) => ({
			id: ingredient.id,
			name: ingredient.name,
			amountText: ingredient.amountText
		}))
	}));
}
