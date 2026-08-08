import { requireUserId } from '$lib/server/auth';
import { describe, expect, it } from 'vitest';

type AuthEvent = Parameters<typeof requireUserId>[0];

describe('requireUserId', () => {
	it('does not make authenticated loads depend on the current URL', () => {
		const event = {
			locals: { claims: { sub: 'user-id' } },
			get url(): URL {
				throw new Error('Authenticated loads must not access the URL.');
			}
		} as unknown as AuthEvent;

		expect(requireUserId(event)).toBe('user-id');
	});

	it('preserves the requested URL when redirecting an unauthenticated user', () => {
		let urlWasRead = false;
		const event = {
			locals: { claims: null },
			get url(): URL {
				urlWasRead = true;
				return new URL('https://trace.test/journal?tab=meals');
			}
		} as unknown as AuthEvent;

		expect(() => requireUserId(event)).toThrow(
			expect.objectContaining({
				status: 303,
				location: '/auth/email?next=%2Fjournal%3Ftab%3Dmeals'
			})
		);
		expect(urlWasRead).toBe(true);
	});
});
