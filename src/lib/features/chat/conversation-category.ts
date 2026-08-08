import type { ConversationCategory } from './contracts';

export const CONVERSATION_CATEGORY_PRESENTATION = {
	meal: { label: 'Måltid', color: 'var(--domain-meal)' },
	symptom: { label: 'Symtom', color: 'var(--domain-symptom)' },
	sleep: { label: 'Sömn', color: 'var(--domain-sleep)' },
	weight: { label: 'Vikt', color: 'var(--domain-weight)' },
	general: { label: 'Allmänt', color: 'var(--domain-general)' }
} as const satisfies Record<
	ConversationCategory,
	{ label: string; color: `var(--domain-${string})` }
>;

export function getConversationCategoryPresentation(category?: ConversationCategory) {
	return CONVERSATION_CATEGORY_PRESENTATION[category ?? 'general'];
}
