import { resolveMealDuplicateInteraction } from '$lib/server/meals/meals';
import type { RegisteredTool } from './registry';
import * as v from 'valibot';

const discardReasonSchema = v.picklist([
	'user_declined',
	'conversation_moved_on',
	'corrected_proposal'
]);
const pendingReasonSchema = v.picklist(['interaction_followup', 'ambiguous_response']);
const decisionReasonSchema = v.union([discardReasonSchema, pendingReasonSchema]);

export const foodLogResolveRegistrationSchema = v.pipe(
	v.strictObject({
		confirmationRef: v.string(),
		decision: v.picklist(['register', 'discard', 'leave_pending']),
		reason: v.nullable(decisionReasonSchema),
		responseRequired: v.boolean()
	}),
	v.check(
		(input) =>
			(input.decision === 'register' && input.reason === null) ||
			(input.decision === 'discard' && isDiscardReason(input.reason)) ||
			(input.decision === 'leave_pending' &&
				input.responseRequired &&
				isPendingReason(input.reason)),
		'Beslut och anledning matchar inte.'
	)
);

const foodLogResolveRegistrationDefinition = {
	type: 'function',
	name: 'resolve_registration',
	description:
		'Hantera ett verifierat väntande måltidsbeslut innan du svarar. Använd register med reason null endast när användaren uttryckligen bekräftar just förslaget. Använd discard med user_declined vid ett tydligt nej, corrected_proposal när användaren korrigerar uppgiften och conversation_moved_on när användaren tydligt byter till ett orelaterat ämne. Använd leave_pending endast när användaren ställer en faktisk följdfråga om förslaget (interaction_followup) eller svaret är genuint otydligt (ambiguous_response); en hälsning eller orelaterad fråga är inte leave_pending. Sätt responseRequired till true endast när användarens meddelande dessutom behöver ett naturligt svar efter beslutet; ett rent ja eller nej ska vara false, medan leave_pending alltid ska vara true.',
	defer_loading: true,
	strict: true,
	parameters: {
		type: 'object',
		additionalProperties: false,
		properties: {
			confirmationRef: { type: 'string', minLength: 1 },
			decision: { type: 'string', enum: ['register', 'discard', 'leave_pending'] },
			reason: {
				type: ['string', 'null'],
				enum: [
					'user_declined',
					'conversation_moved_on',
					'corrected_proposal',
					'interaction_followup',
					'ambiguous_response',
					null
				]
			},
			responseRequired: { type: 'boolean' }
		},
		required: ['confirmationRef', 'decision', 'reason', 'responseRequired']
	}
} as const;

export const foodLogResolveRegistrationTool = {
	key: 'food_log.resolve_registration',
	definition: foodLogResolveRegistrationDefinition,
	schema: foodLogResolveRegistrationSchema,
	policy: { effect: 'write', parallelSafe: false },
	async execute(context, args) {
		const input = args as v.InferOutput<typeof foodLogResolveRegistrationSchema>;
		const binding = context.interactionBindings.find(
			(candidate) =>
				candidate.handle === input.confirmationRef && candidate.kind === 'meal_duplicate'
		);
		if (!binding) {
			return {
				output: { status: 'error', code: 'unknown_confirmation_ref' },
				effects: {
					requiresAgentContinuation: true,
					canonicalParts: [],
					responseObligations: []
				}
			};
		}
		if (input.decision === 'leave_pending') {
			return {
				output: { status: 'pending', reason: input.reason },
				effects: {
					requiresAgentContinuation: true,
					canonicalParts: [],
					responseObligations: []
				}
			};
		}

		const result = await resolveMealDuplicateInteraction(context.client, {
			userId: context.userId,
			turnId: context.turnId,
			leaseExpiresAt: context.leaseExpiresAt,
			operationIndex: context.operationIndex,
			interactionId: binding.interactionId,
			decision: input.decision,
			reason:
				input.decision === 'discard' && isDiscardReason(input.reason) ? input.reason : undefined
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
				output: { status: 'registered', meal: result.meal },
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

		if (result.status === 'discarded') {
			const obligationRef = `response_${context.operationIndex + 1}`;
			return {
				output: { status: 'discarded', reason: result.reason, obligationRef },
				effects: {
					requiresAgentContinuation: input.responseRequired,
					canonicalParts: [],
					responseObligations: [
						{
							ref: obligationRef,
							kind: 'acknowledge_interaction_discard' as const,
							schemaVersion: 1 as const,
							confirmationRef: input.confirmationRef,
							reason: result.reason
						}
					]
				}
			};
		}

		return {
			output: { status: 'error', code: result.status },
			effects: {
				requiresAgentContinuation: true,
				canonicalParts: [],
				responseObligations: []
			}
		};
	}
} satisfies RegisteredTool;

function isDiscardReason(value: unknown): value is v.InferOutput<typeof discardReasonSchema> {
	return v.safeParse(discardReasonSchema, value).success;
}

function isPendingReason(value: unknown): value is v.InferOutput<typeof pendingReasonSchema> {
	return v.safeParse(pendingReasonSchema, value).success;
}
