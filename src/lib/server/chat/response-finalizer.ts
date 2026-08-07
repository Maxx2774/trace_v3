import type { MealSummary } from '$lib/features/meals/contracts';
import type OpenAI from 'openai';
import { CHAT_MODEL, createSafetyIdentifier, getOpenAIClient } from './model';
import { ProviderStepError } from './provider';
import { createFinalizerTextConfig, parseFinalizerOutput } from './response-contract';
import type { CanonicalResponsePart, ResponseObligation } from './tools/registry';

export type ResponseFinalizerContext = {
	referenceInstant: string;
	timezone: string;
	currentUserMessage: string;
	canonicalParts: CanonicalResponsePart[];
	responseObligations: ResponseObligation[];
};

const FINALIZER_INSTRUCTIONS = `Du är Trace response-finalizer. Skriv ett enda kort och naturligt svar på samma språk som användarens senaste meddelande.

Regler:
- Uppfyll samtliga responseObligations tydligt i texten.
- Använd endast verifierade fakta i responseContext. Hitta inte på, ändra eller utför något.
- canonicalParts är redan genomförda resultat; beskriv aldrig en väntande proposal som registrerad.
- Formulera naturligt utan servermallar. Lägg inte till råd, följdfrågor eller nya ämnen som inte krävs.
- Returnera exakt det strukturerade slutkontraktet.`;

export async function runResponseFinalizer(
	context: ResponseFinalizerContext,
	userId: string,
	signal: AbortSignal,
	client: Pick<OpenAI, 'responses'> = getOpenAIClient(),
	safetyIdentifier = createSafetyIdentifier(userId)
): Promise<{ text: string; fulfilledObligationRefs: string[] }> {
	const obligationRefs = context.responseObligations.map((obligation) => obligation.ref);
	if (obligationRefs.length === 0) {
		throw new Error('Finalizern kräver minst en svarsplikt.');
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
							canonicalParts: context.canonicalParts.map(projectCanonicalPart),
							responseObligations: context.responseObligations
						})
					},
					{ role: 'user', content: context.currentUserMessage }
				],
				reasoning: { effort: 'low', context: 'current_turn' },
				text: createFinalizerTextConfig(obligationRefs),
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
		return parseFinalizerOutput(response.output_text.trim(), obligationRefs);
	} catch {
		throw new ProviderStepError('protocol_error', 'Svaret följde inte slutkontraktet.', true);
	}
}

function projectCanonicalPart(part: CanonicalResponsePart): unknown {
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
