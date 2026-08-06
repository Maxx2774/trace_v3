# Trace v3 agent guidelines

- Keep this project smaller than the behavior it replaces. Migrate only one verified capability at a time.
- Prefer direct code and explicit contracts over speculative abstractions.
- Keep reusable UI in `lib/components/ui`, feature behavior in `lib/features`, and secrets or authority on the server.
- Validate authenticated identity with Supabase `getClaims()` on the server. Never authorize from client state.
- Preserve unrelated work and verify every changed behavior before claiming completion.
- Keep `docs/capabilities.md` synchronized with verified user-visible functionality and
  limitations. Update it in the same change when a capability is added, removed, or
  meaningfully changed; do not put planned functionality there.

## Think before coding

- Inspect the relevant code, contracts, and current state first.
- Surface material assumptions, contradictions, uncertainty, and tradeoffs. Ask only
  when choosing silently could change the result.

## Simplicity first

- Implement the smallest complete solution to the current requirement.
- Add no speculative features, configurability, compatibility layers, or single-use
  abstractions. Prefer explicit types and direct control flow.

## Change surgically

- Change only what the requested outcome requires; preserve unrelated work and match
  the local style.
- Clean up artifacts created by your change. Report unrelated cleanup instead of
  performing it.

## Verify the outcome

- Define concrete success criteria, then loop until they are met or a genuine blocker
  is identified.
- Reproduce bugs when practical, run checks proportional to risk, and never claim
  unverified behavior.

## Authenticated browser testing

- Use the dedicated Supabase E2E account for authenticated local browser tests.
- Its credentials are stored in the git-ignored `.env.local` variables
  `E2E_USER_EMAIL` and `E2E_USER_PASSWORD`.
- Never print, copy into source files, or commit the credential values. Do not use a
  personal account when the E2E account is sufficient.
