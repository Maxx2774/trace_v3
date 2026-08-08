import { resolveMealDuplicateInteraction } from '$lib/server/meals/meals';
import type { RegisteredTool } from './contracts';
import * as v from 'valibot';

export const interactionResponseMeaningSchema = v.picklist([
	'confirmed',
	'confirmed_with_additional_intent',
	'rejected',
	'rejected_with_additional_intent',
	'conversation_moved_on',
	'corrected_input',
	'interaction_followup',
	'ambiguous_response'
]);

export const processInteractionResponseSchema = v.strictObject({
	interactionRef: v.string(),
	responseMeaning: interactionResponseMeaningSchema
});

export type InteractionResponseMeaning = v.InferOutput<typeof interactionResponseMeaningSchema>;

export type ProcessInteractionResponseArgs = v.InferOutput<typeof processInteractionResponseSchema>;

const processInteractionResponseDefinition = {
	type: 'function',
	name: 'process_interaction_response',
	description:
		'Processa användarens senaste svar på en verifierad väntande interaction innan du svarar. Använd confirmed för en ren uttrycklig bekräftelse och confirmed_with_additional_intent när samma meddelande även innehåller något mer som ska hanteras. Använd rejected för ett rent tydligt nej och rejected_with_additional_intent för ett tydligt nej plus något mer. Använd conversation_moved_on när användaren utan att bekräfta eller avvisa tydligt går vidare till ett orelaterat ämne, corrected_input när användaren korrigerar förslaget, interaction_followup för en faktisk följdfråga om förslaget och ambiguous_response endast när svaret genuint inte går att tolka. Använd endast en interactionRef från det verifierade kontextunderlaget.',
	strict: true,
	parameters: {
		type: 'object',
		additionalProperties: false,
		properties: {
			interactionRef: { type: 'string' },
			responseMeaning: {
				type: 'string',
				enum: [
					'confirmed',
					'confirmed_with_additional_intent',
					'rejected',
					'rejected_with_additional_intent',
					'conversation_moved_on',
					'corrected_input',
					'interaction_followup',
					'ambiguous_response'
				]
			}
		},
		required: ['interactionRef', 'responseMeaning']
	}
} as const;

export const processInteractionResponseTool = {
	key: 'process_interaction_response',
	exposure: 'direct',
	definition: processInteractionResponseDefinition,
	schema: processInteractionResponseSchema,
	operation: 'command',
	concurrency: 'serial',
	async execute(context, args) {
		const input = args as ProcessInteractionResponseArgs;
		const binding = context.pendingInteractionBindings.find(
			(candidate) => candidate.interactionRef === input.interactionRef
		);
		if (!binding) {
			return {
				modelOutput: { status: 'error', code: 'unknown_interaction_ref' },
				orchestration: {
					requiresAgentContinuation: true,
					verifiedResponseParts: [],
					responseRequirements: []
				}
			};
		}

		const action = deriveInteractionResponseAction(input.responseMeaning);
		if (action.kind === 'keep_pending') {
			return {
				modelOutput: { status: 'pending', reason: input.responseMeaning },
				orchestration: {
					requiresAgentContinuation: true,
					verifiedResponseParts: [],
					responseRequirements: []
				}
			};
		}

		switch (binding.kind) {
			case 'meal_duplicate': {
				const result = await resolveMealDuplicateInteraction(context.client, {
					userId: context.userId,
					turnId: context.turnId,
					turnLeaseExpiresAt: context.turnLeaseExpiresAt,
					toolCallIndex: context.toolCallIndex,
					interactionId: binding.interactionId,
					decision: action.decision,
					reason: action.reason
				});

				if (result.status === 'registered') {
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
						modelOutput: { status: 'registered', meal: result.meal },
						orchestration: {
							requiresAgentContinuation: action.requiresAgentContinuation,
							verifiedResponseParts: [
								{ kind: 'text' as const, text: 'Registrerat' },
								{ kind: 'journal_record' as const, record }
							],
							responseRequirements: []
						}
					};
				}

				if (result.status === 'discarded') {
					const requirementRef = `response_${context.toolCallIndex + 1}`;
					return {
						modelOutput: { status: 'discarded', reason: result.reason, requirementRef },
						orchestration: {
							requiresAgentContinuation: action.requiresAgentContinuation,
							verifiedResponseParts: [],
							responseRequirements: [
								{
									ref: requirementRef,
									kind: 'acknowledge_interaction_discard' as const,
									schemaVersion: 1 as const,
									interactionRef: input.interactionRef,
									reason: result.reason
								}
							]
						}
					};
				}

				return {
					modelOutput: { status: 'error', code: result.status },
					orchestration: {
						requiresAgentContinuation: true,
						verifiedResponseParts: [],
						responseRequirements: []
					}
				};
			}
		}
	}
} satisfies RegisteredTool;

type InteractionResponseAction =
	| { kind: 'keep_pending' }
	| {
			kind: 'resolve';
			decision: 'register';
			reason?: undefined;
			requiresAgentContinuation: boolean;
	  }
	| {
			kind: 'resolve';
			decision: 'discard';
			reason: 'user_declined' | 'conversation_moved_on' | 'corrected_input';
			requiresAgentContinuation: boolean;
	  };

function deriveInteractionResponseAction(
	responseMeaning: InteractionResponseMeaning
): InteractionResponseAction {
	switch (responseMeaning) {
		case 'confirmed':
			return {
				kind: 'resolve',
				decision: 'register',
				requiresAgentContinuation: false
			};
		case 'confirmed_with_additional_intent':
			return {
				kind: 'resolve',
				decision: 'register',
				requiresAgentContinuation: true
			};
		case 'rejected':
			return {
				kind: 'resolve',
				decision: 'discard',
				reason: 'user_declined',
				requiresAgentContinuation: false
			};
		case 'rejected_with_additional_intent':
			return {
				kind: 'resolve',
				decision: 'discard',
				reason: 'user_declined',
				requiresAgentContinuation: true
			};
		case 'conversation_moved_on':
			return {
				kind: 'resolve',
				decision: 'discard',
				reason: 'conversation_moved_on',
				requiresAgentContinuation: true
			};
		case 'corrected_input':
			return {
				kind: 'resolve',
				decision: 'discard',
				reason: 'corrected_input',
				requiresAgentContinuation: true
			};
		case 'interaction_followup':
		case 'ambiguous_response':
			return { kind: 'keep_pending' };
	}
}
