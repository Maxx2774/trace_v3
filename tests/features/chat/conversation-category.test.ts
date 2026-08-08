import {
	CONVERSATION_CATEGORY_PRESENTATION,
	getConversationCategoryPresentation
} from '$lib/features/chat/conversation-category';
import { describe, expect, it } from 'vitest';

describe('conversation category presentation', () => {
	it('keeps the canonical labels and theme-aware color tokens in one mapping', () => {
		expect(CONVERSATION_CATEGORY_PRESENTATION).toEqual({
			meal: { label: 'Måltid', color: 'var(--domain-meal)' },
			symptom: { label: 'Symtom', color: 'var(--domain-symptom)' },
			sleep: { label: 'Sömn', color: 'var(--domain-sleep)' },
			weight: { label: 'Vikt', color: 'var(--domain-weight)' },
			general: { label: 'Allmänt', color: 'var(--domain-general)' }
		});
	});

	it('uses the general presentation while metadata is unavailable', () => {
		expect(getConversationCategoryPresentation()).toEqual({
			label: 'Allmänt',
			color: 'var(--domain-general)'
		});
	});
});
