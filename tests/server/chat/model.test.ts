import { createModelStream, createModelToolConfiguration } from '$lib/server/chat/model';
import { createToolCatalog } from '$lib/server/chat/tools/registry';
import { describe, expect, it, vi } from 'vitest';

describe('model tool configuration', () => {
	it('makes a forced pending-interaction processor directly callable', () => {
		const configuration = createModelToolConfiguration(
			createToolCatalog({ hasPendingInteraction: true }),
			'process_interaction_response'
		);

		expect(configuration.tool_choice).toEqual({
			type: 'function',
			name: 'process_interaction_response'
		});
		expect(configuration.tools).toContainEqual(
			expect.objectContaining({ type: 'function', name: 'process_interaction_response' })
		);
	});

	it('rejects a forced tool that is only deferred behind tool search', () => {
		expect(() =>
			createModelToolConfiguration(
				createToolCatalog({ hasPendingInteraction: false }),
				'process_interaction_response'
			)
		).toThrow('inte direkt tillgängligt');
	});

	it('puts a forced tool in the final Responses API request', async () => {
		const create = vi.fn(async () => ({}));
		const signal = new AbortController().signal;
		await createModelStream(
			[{ role: 'user', content: 'Ja' }],
			'user-id',
			signal,
			{
				toolCatalog: createToolCatalog({ hasPendingInteraction: true }),
				requiredToolName: 'process_interaction_response'
			},
			{ responses: { create } } as never,
			'test-safety-id'
		);

		const [request, requestOptions] = create.mock.calls[0] as unknown as [
			Record<string, unknown>,
			Record<string, unknown>
		];
		expect(request).toMatchObject({
			model: 'gpt-5.6-luna',
			tool_choice: { type: 'function', name: 'process_interaction_response' },
			parallel_tool_calls: true,
			stream: true,
			store: false,
			safety_identifier: 'test-safety-id'
		});
		expect(request.tools).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'function',
					name: 'process_interaction_response',
					strict: true,
					parameters: expect.objectContaining({
						type: 'object',
						additionalProperties: false,
						required: ['interactionRef', 'responseMeaning']
					})
				}),
				expect.objectContaining({ type: 'namespace', name: 'food_log' }),
				{ type: 'tool_search' }
			])
		);
		const forcedToolName = (request.tool_choice as { name: string }).name;
		expect(
			(request.tools as Array<{ type: string; name?: string }>).some(
				(tool) => tool.type === 'function' && tool.name === forcedToolName
			)
		).toBe(true);
		expect(requestOptions).toEqual({ signal });
	});
});
