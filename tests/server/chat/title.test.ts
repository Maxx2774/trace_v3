import {
	createConversationTitleRequest,
	generateConversationTitle,
	normalizeGeneratedConversationMetadata,
	normalizeGeneratedTitle
} from '$lib/server/chat/title';
import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';

describe('conversation title generation', () => {
	it('builds the final provider request with a strict title and category schema', () => {
		const request = createConversationTitleRequest('Jag åt gröt igår', 'safety-test');

		expect(request).toMatchObject({
			input: 'Jag åt gröt igår',
			store: false,
			tools: [],
			text: {
				format: {
					type: 'json_schema',
					name: 'conversation_metadata',
					strict: true,
					schema: {
						type: 'object',
						properties: {
							title: { type: 'string', minLength: 1, maxLength: 60 },
							category: {
								type: 'string',
								enum: ['meal', 'symptom', 'sleep', 'weight', 'general']
							}
						},
						required: ['title', 'category'],
						additionalProperties: false
					}
				}
			},
			safety_identifier: 'safety-test'
		});
	});

	it('returns normalized structured metadata from the real request path', async () => {
		const create = vi.fn().mockResolvedValue({
			status: 'completed',
			output_text: '{"title":"Gröt igår.","category":"meal"}'
		});

		await expect(
			generateConversationTitle(
				'Jag åt gröt igår',
				'user-id',
				new AbortController().signal,
				{ responses: { create } } as unknown as Pick<OpenAI, 'responses'>,
				'safety-test'
			)
		).resolves.toEqual({ title: 'Gröt igår', category: 'meal' });

		expect(create).toHaveBeenCalledWith(
			createConversationTitleRequest('Jag åt gröt igår', 'safety-test'),
			expect.objectContaining({ signal: expect.any(AbortSignal) })
		);
	});
});

describe('normalizeGeneratedConversationMetadata', () => {
	it('normalizes harmless title formatting and preserves a valid category', () => {
		expect(
			normalizeGeneratedConversationMetadata(
				'{"title":"  “Magbesvär efter lunch.”  ","category":"symptom"}'
			)
		).toEqual({ title: 'Magbesvär efter lunch', category: 'symptom' });
	});

	it.each(['meal', 'symptom', 'sleep', 'weight', 'general'] as const)(
		'accepts the %s semantic category',
		(category) => {
			expect(
				normalizeGeneratedConversationMetadata(JSON.stringify({ title: 'Giltig titel', category }))
			).toEqual({ title: 'Giltig titel', category });
		}
	);

	it('rejects malformed JSON, unknown categories, and invalid titles', () => {
		expect(normalizeGeneratedConversationMetadata('inte json')).toBeNull();
		expect(
			normalizeGeneratedConversationMetadata('{"title":"Test","category":"unknown"}')
		).toBeNull();
		expect(
			normalizeGeneratedConversationMetadata(
				JSON.stringify({ title: 'x'.repeat(61), category: 'general' })
			)
		).toBeNull();
	});
});

describe('normalizeGeneratedTitle', () => {
	it('rejects missing titles', () => {
		expect(normalizeGeneratedTitle(null)).toBeNull();
		expect(normalizeGeneratedTitle('   ')).toBeNull();
	});
});
