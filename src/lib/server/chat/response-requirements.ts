import type { MealDuplicateMatchDetails, MealSummary } from '$lib/features/meals/contracts';

export type MealDuplicateConfirmationRequirementV1 = {
	ref: string;
	kind: 'ask_meal_duplicate_confirmation';
	schemaVersion: 1;
	interactionRef: string;
	proposedMeal: MealSummary;
	existingMeal: MealSummary;
	match: MealDuplicateMatchDetails;
};

export type InteractionDiscardAcknowledgementRequirementV1 = {
	ref: string;
	kind: 'acknowledge_interaction_discard';
	schemaVersion: 1;
	interactionRef: string;
	reason: 'user_declined' | 'conversation_moved_on' | 'corrected_input';
};

export type ResponseRequirement =
	MealDuplicateConfirmationRequirementV1 | InteractionDiscardAcknowledgementRequirementV1;
