# Trace v3 agent guidelines

## Core principles

- Implement the smallest complete solution to the current requirement.
- Prefer direct code and explicit contracts over speculative abstractions, compatibility layers, or single-use abstractions.
- Inspect the relevant code, contracts, and current state before changing anything.
- Surface material assumptions or contradictions. Ask only when choosing silently could materially change the result.
- Preserve unrelated work, match the local style, and clean up artifacts created by the change.

## Project boundaries

- Keep reusable UI in `src/lib/components/ui`.
- Keep feature behavior in `src/lib/features`.
- Keep secrets, authorization, and privileged operations on the server.
- Validate authenticated identity with Supabase `getClaims()` on the server. Never authorize from client state.
- Use icons only from [fluenticon.com](https://fluenticon.com/).
- Keep automated TypeScript tests under `tests`, never alongside application files in `src`.
- Keep `docs/capabilities.md` synchronized with verified user-visible functionality and limitations. Do not document planned functionality there.

## Verification

- Define concrete success criteria and verify the final code state before claiming completion.
- For performance work, read `docs/architecture/performance/README.md` and follow its
  cumulative document routing for the change's scope. Do not load unrelated performance
  documents.
- Use verification proportional to the risk:
  - Presentation-only CSS, spacing, color, typography, or icon changes: run `pnpm check` and visually inspect when layout matters.
  - Component behavior: run `pnpm check` and relevant focused tests.
  - Cross-cutting behavior, persistence, schema, RPC, provider, or data-contract changes: run the complete applicable gate, including `pnpm test`, `pnpm check`, `pnpm lint`, `pnpm build`, and relevant contract or end-to-end checks.
- Add a regression test for fixed behavioral bugs when practical.
- Provider-contract tests must inspect the final request object used by the real network path.
- When provider request shape, tools, model configuration, or the OpenAI SDK changes, run a minimal live-provider canary through the production request builder.
- Treat live-provider acceptance and live semantic evaluation as separate gates. Never report a request-shape canary as verification of model behavior.
- When model-facing instructions, tool descriptions, enums, classifications, or decision categories are added or meaningfully changed, run a mutation-free live semantic evaluation through the production context and request builders.
- Cover every added or changed semantic category with at least one explicit expected tool-call and argument assertion. Add boundary cases when categories overlap.
- Report provider-acceptance and semantic-evaluation results separately, including exact case counts and failures.
- For persistent chat-protocol changes, verify that a new unrelated user message still completes normally after the affected journey.
- Manual testing supports product and visual verification but does not replace automated behavioral coverage.
- Report the exact verification performed, including failures, skipped checks, and unavailable tooling. Do not imply that automated tests verified visual behavior unless they actually did.

## Execute approved plans completely

- When the user explicitly asks to implement an existing plan, treat the request as authorization for every in-scope step already specified by that plan.
- This includes migrations, configured development services, verification, and documentation updates. Do not request redundant confirmation for individual planned steps.
- The Supabase project configured through the repository’s git-ignored `.env.local` is the Trace v3 development environment unless the user explicitly says otherwise.
- Ask for new direction only when the target is ambiguous, the action affects an unscoped or production system, or it would destroy data beyond what the approved plan specified.
- Keep schema and dependent application changes compatible throughout the implementation. Do not hand off a partially migrated system.
- A plan is complete only after its stated end-to-end checks have run against the development environment that received the change.

## Authenticated browser testing

- Use the dedicated Supabase E2E account for authenticated local browser tests.
- Credentials are stored in the git-ignored `.env.local` variables `E2E_USER_EMAIL` and `E2E_USER_PASSWORD`.
- Never print, expose, copy into source files, or commit credential values.
- Do not use a personal account when the E2E account is sufficient.
