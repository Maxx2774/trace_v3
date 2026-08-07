import { createModelToolConfiguration } from '$lib/server/chat/model';
import { createToolCatalog } from '$lib/server/chat/tools/registry';
import { describe, expect, it } from 'vitest';

describe('model tool configuration', () => {
	it('makes a forced pending-interaction resolver directly callable', () => {
		const configuration = createModelToolConfiguration(
			createToolCatalog({ hasPendingMealInteraction: true }),
			'resolve_registration'
		);

		expect(configuration.tool_choice).toEqual({
			type: 'function',
			name: 'resolve_registration'
		});
		expect(configuration.tools).toContainEqual(
			expect.objectContaining({ type: 'function', name: 'resolve_registration' })
		);
	});

	it('rejects a forced tool that is only deferred behind tool search', () => {
		expect(() =>
			createModelToolConfiguration(
				createToolCatalog({ hasPendingMealInteraction: false }),
				'resolve_registration'
			)
		).toThrow('inte direkt tillgängligt');
	});
});
