import type { MealSummary } from '$lib/features/meals/contracts';
import type OpenAI from 'openai';
import { CHAT_MODEL, createSafetyIdentifier, getOpenAIClient } from './model';
import { ProviderStepError } from './provider';
import { createFinalizerTextConfig, parseFinalizerOutput } from './response-contract';
import type { ResponseRequirement } from './response-requirements';
import type { VerifiedResponsePart } from './tools/contracts';

export type ResponseFinalizerContext = {
	referenceInstant: string;
	timezone: string;
	currentUserMessage: string;
	verifiedResponseParts: VerifiedResponsePart[];
	responseRequirements: ResponseRequirement[];
};

const FINALIZER_INSTRUCTIONS = `Du är Trace response-finalizer. Skriv ett enda kort och naturligt svar på samma språk som användarens senaste meddelande.

Regler:
- Uppfyll samtliga responseRequirements tydligt i texten.
- Använd endast verifierade fakta i responseContext. Hitta inte på, ändra eller utför något.
- verifiedResponseParts är redan genomförda resultat; beskriv aldrig en väntande proposal som registrerad.
- Formulera naturligt utan servermallar. Lägg inte till råd, följdfrågor eller nya ämnen som inte krävs.
- Returnera exakt det strukturerade slutkontraktet.`;

export async function runResponseFinalizer(
	context: ResponseFinalizerContext,
	userId: string,
	signal: AbortSignal,
	client: Pick<OpenAI, 'responses'> = getOpenAIClient(),
	safetyIdentifier = createSafetyIdentifier(userId)
): Promise<{ text: string; fulfilledRequirementRefs: string[] }> {
	const requirementRefs = context.responseRequirements.map((requirement) => requirement.ref);
	if (requirementRefs.length === 0) {
		throw new Error('Finalizern kräver minst ett svarskrav.');
	}

	let response;
	try {
		response = await client.responses.create(
			{
				model: CHAT_MODEL,
				instructions: FINALIZER_INSTRUCTIONS,
				input: [
					{
						role: 'developer',
						content: JSON.stringify({
							referenceInstant: context.referenceInstant,
							timezone: context.timezone,
							verifiedResponseParts: context.verifiedResponseParts.map(projectVerifiedResponsePart),
							responseRequirements: context.responseRequirements
						})
					},
					{ role: 'user', content: context.currentUserMessage }
				],
				reasoning: { effort: 'low', context: 'current_turn' },
				text: createFinalizerTextConfig(requirementRefs),
				max_output_tokens: 512,
				truncation: 'disabled',
				store: false,
				safety_identifier: safetyIdentifier
			},
			{ signal }
		);
	} catch {
		throw new ProviderStepError('upstream_error', 'Svaret kunde inte formuleras.', true);
	}

	if (response.status === 'incomplete') {
		throw new ProviderStepError('incomplete_response', 'Svaret blev inte färdigt.', true);
	}
	try {
		return parseFinalizerOutput(response.output_text.trim(), requirementRefs);
	} catch {
		throw new ProviderStepError('protocol_error', 'Svaret följde inte slutkontraktet.', true);
	}
}

function projectVerifiedResponsePart(part: VerifiedResponsePart): unknown {
	if (part.kind === 'text') return part;
	const meal = part.record.value;
	const summary: MealSummary = {
		mealType: meal.mealType,
		occurrence: meal.occurrence,
		items: meal.items.map((item) => ({
			name: item.name,
			amountText: item.amountText,
			ingredients: item.ingredients.map((ingredient) => ({
				name: ingredient.name,
				amountText: ingredient.amountText
			}))
		}))
	};
	return { kind: 'journal_record', recordKind: part.record.kind, value: summary };
}
