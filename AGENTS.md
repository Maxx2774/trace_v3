# Trace v3 agent guidelines

- Keep this project smaller than the behavior it replaces. Migrate only one verified capability at a time.
- Prefer direct code and explicit contracts over speculative abstractions.
- Keep reusable UI in `lib/components/ui`, feature behavior in `lib/features`, and secrets or authority on the server.
- Validate authenticated identity with Supabase `getClaims()` on the server. Never authorize from client state.
- Preserve unrelated work and verify every changed behavior before claiming completion.
- Use icons only from [fluenticon.com](https://fluenticon.com/). Do not introduce icons from other libraries or sources.
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
- Use the smallest verification scope that matches the change. For presentation-only CSS,
  spacing, color, or typography changes, run `pnpm check` and visually inspect when layout
  matters; do not run the full test suite by default.
- For component behavior, run `pnpm check` plus the relevant focused tests. Run the full
  test suite for cross-cutting behavior, server or data-contract changes, or when focused
  coverage is unavailable and regression risk justifies it.
- In the handoff, distinguish compilation, automated behavior tests, and visual inspection.
  Never imply that the general test suite verified CSS, positioning, or animation unless a
  test actually exercises that behavior.

### Delivery evidence for stateful and provider-backed behavior

- Verification belongs to the exact code state that was tested. Any later production-code
  change invalidates the affected results; rerun the required checks after the final change
  before claiming completion. A test from an earlier implementation state is not evidence.
- For stateful chat, domain, provider, or data-contract work, use the repository's single
  delivery-verification command when one exists. Until then, run the complete applicable
  gate explicitly: tests, provider-request contracts, SQL contracts, critical journeys,
  `pnpm check`, `pnpm lint`, and `pnpm build`. Report any unavailable or failing part rather
  than silently substituting a smaller check.
- Maintain a cumulative automated suite for Trace's critical user journeys. New capabilities
  add coverage without removing existing core journeys. Every persistent interaction journey
  must finish with a new unrelated user message that completes normally, proving that no stale
  protocol state still controls the conversation.
- The meal-duplicate decline journey is a permanent core regression: register a meal, submit
  the duplicate, decline it, verify that no second meal exists and the interaction is
  discarded, then verify that a new unrelated message completes normally.
- Provider-contract tests must inspect the final request object used by the real network path,
  including tools, forced tool choice, tool search, structured output, and model settings.
  Mocked orchestration alone does not prove that a provider request is valid.
- When provider code, tool choice, tool search, deferred loading, namespaces, the OpenAI SDK,
  or model configuration changes, also run a minimal live-provider canary through the
  production request builder. It must prove that OpenAI accepts every affected request shape;
  it does not need to perform domain mutations.
- Manual testing is useful for diagnosis and product feel, but is not acceptance evidence by
  itself. A unit test is not E2E, a scripted provider does not prove live-provider acceptance,
  and skipped or todo critical tests do not count as passing.
- For a production bug, add a regression that fails for the broken behavior for the intended
  reason, then passes after the fix, and finally rerun the applicable delivery gate.
- Handoffs for these changes must report the exact commands, pass/fail/skip counts, and which
  critical journeys and live canaries ran. In CI, only a green result on the exact commit being
  delivered is authoritative; local work must not be committed merely to manufacture a SHA.

## Execute approved plans completely

- When the user explicitly asks to implement or execute an existing plan, treat that
  request as authorization for every in-scope step the plan already specifies. This
  includes creating and applying database migrations, updating configured development
  services, running verification, and synchronizing documentation. Do not ask for
  redundant confirmation for individual planned steps.
- The Supabase project configured by this repository's git-ignored `.env.local` is the
  Trace v3 development environment, not production, unless the user explicitly says
  otherwise. It is in scope for migrations required by an approved implementation plan.
- Ask for new direction only when the target is ambiguous, the action would affect a
  production or otherwise unscoped system, or it would destroy user data in a way the
  approved plan did not already make explicit.
- Sequence schema and dependent application changes as one complete operation. If a
  platform permission boundary still blocks a planned external action, surface it before
  switching dependent app code; never hand off or claim success with incompatible app
  and database contracts.
- A plan is not complete until its stated end-to-end checks have run against the same
  development environment that received the change.

## Authenticated browser testing

- Use the dedicated Supabase E2E account for authenticated local browser tests.
- Its credentials are stored in the git-ignored `.env.local` variables
  `E2E_USER_EMAIL` and `E2E_USER_PASSWORD`.
- Never print, copy into source files, or commit the credential values. Do not use a
  personal account when the E2E account is sufficient.
