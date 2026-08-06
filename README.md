# Trace v3

A deliberately small SvelteKit foundation for rebuilding Trace one verified feature at a time.

## Run locally

```sh
pnpm install
pnpm dev
```

The local environment uses the same Supabase project as `trace_v2`. Secrets live in
`.env.local`, which is ignored by Git. `.env.example` documents the required keys.

## Current scope

The verified implementation and its current limitations are documented in
[`docs/capabilities.md`](docs/capabilities.md). Product intent and planned capabilities remain
separate in [`product.md`](product.md).

Live chat additionally requires `SUPABASE_SECRET_KEY` and
`TRACE_SAFETY_HMAC_KEY` in `.env.local`. Generate the HMAC key independently;
do not reuse the OpenAI or Supabase secret.

## Structure

```text
src/lib/components/ui   reusable UI primitives
src/lib/features       feature-owned UI
src/lib/server         server-only helpers
src/routes             pages, layouts, and auth endpoints
```

## Verification

```sh
pnpm check
pnpm test
pnpm lint
pnpm build
```

Database migrations live in `supabase/migrations`, and the rollback-safe SQL
contract test lives in `supabase/tests/chat.sql`.
