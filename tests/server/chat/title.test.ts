import { describe, expect, it } from 'vitest';
import { normalizeGeneratedTitle } from '$lib/server/chat/title';

describe('normalizeGeneratedTitle', () => {
	it('normalizes harmless formatting from a generated title', () => {
		expect(normalizeGeneratedTitle('  “Magbesvär efter lunch.”  ')).toBe('Magbesvär efter lunch');
	});

	it('rejects missing and oversized titles', () => {
		expect(normalizeGeneratedTitle(null)).toBeNull();
		expect(normalizeGeneratedTitle('   ')).toBeNull();
		expect(normalizeGeneratedTitle('x'.repeat(61))).toBeNull();
	});
});
