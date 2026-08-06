import { ProviderStepError, runModelStep } from '$lib/server/chat/provider';
import { describe, expect, it, vi } from 'vitest';

describe('runModelStep', () => {
	it('streams ordinary assistant text and returns canonical output', async () => {
		const onDelta = vi.fn();
		const response = {
			output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hej!' }] }]
		};

		const step = await runModelStep(
			[{ role: 'user', content: 'Hej' }],
			'user',
			new AbortController().signal,
			onDelta,
			fakeStream([
				{ type: 'response.output_item.added', item: { type: 'message' } },
				{ type: 'response.output_text.delta', delta: 'Hej!' },
				{ type: 'response.completed', response }
			]) as never
		);

		expect(step.mode).toBe('text');
		expect(step.text).toBe('Hej!');
		expect(onDelta).toHaveBeenCalledWith('Hej!');
	});

	it('preserves hosted tool-search items and function call ids', async () => {
		const output = [
			{ type: 'reasoning', encrypted_content: 'encrypted' },
			{ type: 'tool_search_call', execution: 'server', call_id: null },
			{ type: 'tool_search_output', execution: 'server', call_id: null, tools: [] },
			{
				type: 'function_call',
				namespace: 'food_log',
				name: 'record',
				call_id: 'call_meal',
				arguments: '{}'
			}
		];

		const step = await runModelStep(
			[{ role: 'user', content: 'Jag åt lunch' }],
			'user',
			new AbortController().signal,
			vi.fn(),
			fakeStream([
				{ type: 'response.output_item.added', item: { type: 'reasoning' } },
				{ type: 'response.output_item.added', item: { type: 'tool_search_call' } },
				{ type: 'response.completed', response: { output } }
			]) as never
		);

		expect(step.mode).toBe('tool');
		expect(step.output).toEqual(output);
		expect(step.functionCalls[0].call_id).toBe('call_meal');
	});

	it('rejects message-first output that later switches to a tool', async () => {
		await expect(
			runModelStep(
				[{ role: 'user', content: 'Test' }],
				'user',
				new AbortController().signal,
				vi.fn(),
				fakeStream([
					{ type: 'response.output_item.added', item: { type: 'message' } },
					{ type: 'response.output_text.delta', delta: 'Tillfälligt' },
					{ type: 'response.output_item.added', item: { type: 'function_call' } }
				]) as never
			)
		).rejects.toMatchObject({ code: 'protocol_error' } satisfies Partial<ProviderStepError>);
	});
});

function fakeStream(events: unknown[]) {
	return async () =>
		(async function* () {
			for (const event of events) yield event;
		})();
}
