# CLAUDE.md

Project context for Claude Code working on this repository. The README is for human onboarding; this file is for the AI agent's conventions, invariants and recipes.

## What this is

Internal background check app for PX Center. Operators authenticate, then query the Predictus API by CPF, CNPJ or name — individually (single search) or via CSV upload (bulk). Results are cached, audited and rate-limited.

Originally a Streamlit + Python MVP, now a Supabase + Next.js + Vercel rewrite. Python code is preserved under `legacy-streamlit/` for reference only — **never** import from it.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript **strict** (`noUncheckedIndexedAccess`, `noImplicitOverride`)
- Tailwind 4 + shadcn/ui + Biome (replaces ESLint+Prettier)
- Supabase: Postgres 16 + Auth (email+password, signup disabled) + Edge Functions (Deno) + Realtime + Vault + pg_cron
- Vercel for the Next.js app; Supabase for everything backend
- Vitest for unit tests — **TDD is the default**

## Architectural layers (read this before changing code)

The codebase is split so that the **interesting logic is pure functions tested under Node**, and the **runtime wiring is thin enough to be obviously correct**. When in doubt, push logic down into `lib/` and keep `app/` and `supabase/functions/` as adapters.

```
app/                Next.js routes — UI + Server Actions (thin wiring)
  ├── login/         email+password sign in
  ├── search/        single document search
  ├── bulk/          CSV upload + async job page (Realtime)
  ├── history/       operator's own searches
  ├── audit/         operator's own audit log
  ├── access-denied/ allowlist failure
  └── sign-out/      logout Server Action

components/
  ├── ui/            shadcn primitives (button, card, input, etc.)
  └── sign-out-button.tsx

lib/                Pure-ish modules with Vitest coverage
  ├── validators/    cpf, cnpj (check digits), name (masking)
  ├── hash.ts        SHA-256 document hashing with type prefix
  ├── audit.ts       audit_log writer + request context extractor
  ├── csv/parser.ts  CSV → de-duped CPF/CNPJ lists with 250-doc cap
  ├── crypto/vault.ts encryptText / decryptText via Vault RPC
  ├── predictus/
  │   ├── client.ts        HTTP client w/ token refresh + 3 retries
  │   ├── token-store.ts   Persistence in public.predictus_token
  │   ├── server-client.ts Factory that wires token-store into client
  │   ├── cache.ts         get/set predictus_cache (encrypted, 30d TTL)
  │   └── item-processor.ts Per-item cache+Predictus+audit orchestration
  ├── bulk/
  │   ├── job-store.ts      CRUD over bulk_jobs/bulk_job_items
  │   ├── processor.ts      Loop with rate-limited sleep + per-item error isolation
  │   └── item-processor.ts (re-exported from predictus dir)
  └── supabase/
      ├── client.ts   Browser client
      ├── server.ts   Server client (reads cookies)
      ├── admin.ts    Service-role client (Server Actions + Edge only)
      ├── proxy.ts    Session refresh + allowlist check for proxy.ts
      ├── env.ts      Env var helpers
      └── types.ts    Hand-rolled Database type

proxy.ts            Next.js 16 file convention (was middleware.ts)
supabase/
  ├── migrations/    SQL — schema, RLS, crypto helpers, pg_cron jobs
  ├── functions/
  │   └── process-bulk-job/ Edge Function (Deno) — reuses lib/ via relative imports
  └── config.toml    Local Supabase config (signup disabled, 12-char passwords)
scripts/
  └── bootstrap-vault.sql Idempotent Vault key creation

legacy-streamlit/   DO NOT TOUCH. Old Python MVP, kept for reference only.
```

## Invariants

### TDD is the default for `lib/**`

- Write tests first. The current count is **157 passing**; growing the codebase means growing this number.
- Run `pnpm test:watch` while editing a `lib/**` module.
- A new public function in `lib/` without a `.test.ts` is a code smell.
- The `app/**` and `supabase/functions/**` layers are thin wiring on top of `lib/`. They are exercised by build + manual smoke; unit tests are optional there.

### LGPD — these are non-negotiable

- **No CPF, CNPJ or personal name in cleartext** in `searches`, `audit_log` or any logged output.
- `document_hash` is always SHA-256 with a type prefix (`cpf:`, `cnpj:`, `name:`) via `hashDocument` in `lib/hash.ts`. The prefix prevents cross-type collisions.
- `term_preview` (UI-safe mask, e.g. `123.***.***-10`) comes from `lib/validators/{cpf,cnpj,name}.ts:mask`. Use it instead of formatting the raw document in UI strings.
- `predictus_cache.encrypted_payload` and `bulk_job_items.document_encrypted` are `bytea` columns encrypted via `lib/crypto/vault.ts`. They use the same Vault key, `predictus_cache_key`.
- Plaintext CPF/CNPJ may live in **one place**: the stack frame of `processBulkItem` during the Predictus call. It must not be persisted, logged or returned.
- Retention: 30 days for `searches`, `audit_log`, `predictus_cache`; 7 days for completed/failed `bulk_jobs` (because they hold encrypted documents). All purged daily by pg_cron jobs scheduled in `migrations/0004` and `0005`.

### Auth + RLS

- Signup is disabled (`supabase/config.toml`). Operators are created manually via Supabase Studio → Auth → Add user. A Postgres trigger mirrors them into `public.users`.
- `proxy.ts` enforces both: (1) authenticated session and (2) row in `public.users`. Removing a row from `public.users` revokes access without touching `auth.users`.
- Tables are RLS-protected:
  - `searches`, `bulk_jobs`, `audit_log` — operator reads/writes own rows.
  - `bulk_job_items` — visible only when the parent job belongs to the operator.
  - `predictus_cache` — any authenticated operator can read; **writes via service-role only**.
  - `predictus_token`, `crypto` helpers — **service-role only** (no policies → RLS denies everyone else).
- Anything that writes `audit_log` or `predictus_cache` must use `createAdminClient()` (service role). Anything that reads operator-private data uses `createClient()` (server, cookie-aware).

### Predictus client

- Never `new PredictusClient(...)` directly inside `app/` or `supabase/functions/`. Use `createServerPredictusClient()` from `lib/predictus/server-client.ts`. It wires the `SupabaseTokenStore` so the access token survives cold starts.
- The client retries 5xx and network errors with exponential backoff (1s, 2s, 4s, then throws). It refreshes on 401 exactly once.
- Predictus credentials are shared (one upstream account for all operators). Never expose them client-side.

### Bulk processing

- Bulk jobs cap at **250 documents** (enforced by `parseCsv` and a CHECK constraint on `bulk_jobs.total_items`).
- Rate limit: **1 request per 3.6 s** (1000/h contract). Configured in the Edge Function call to `processBulkJob`.
- The Edge Function returns 202 immediately and continues via `EdgeRuntime.waitUntil`. The HTTP caller (Server Action) does not await it — it redirects to `/bulk/[jobId]` and the Realtime channel takes over.
- Per-item errors must not stop the loop. The processor catches them and records `{ kind: 'error', message }` against the item.

## Conventions

- **Imports**: absolute via `@/` alias. Biome's `organizeImports` sorts them; `pnpm lint:fix` keeps you honest. Type-only imports use `import type`.
- **Server-only modules** (`'use server'` at top): `app/**/actions.ts` files. The admin client lives in `lib/supabase/admin.ts` — only call `createAdminClient()` from server code.
- **Server Actions** that mutate state must `redirect()` at the end so the client navigates to a fresh page. Don't return rendering data from a Server Action that's also redirecting (it'll be discarded).
- **Form state**: use React 19 `useActionState` + `useFormStatus`. Server Actions return `{ ok: true, ... } | { ok: false, error }` or `{ error?: string }`.
- **Supabase JS** infers `never` for inserts when the typed client crosses a module boundary. Cast with `as never` where you've validated the shape (search the codebase for `as never` to see precedent). For SELECT, use `.returns<T>()` to assert the row shape.
- **Comments**: keep them rare and intent-focused. Don't document what the code does; document why a decision was made if it would surprise a future reader.
- **No `as any`**. `as never` is the escape hatch when Supabase generics refuse to cooperate; document why it's safe inline.

## Database schema (mental model)

```
auth.users  ◄── (trigger: on_auth_user_created) ──►  public.users  (allowlist)
                                                          │
                                                          ▼ (RLS by user_id)
                                       searches  ◄── single search history
                                       bulk_jobs  ◄── async batch metadata
                                            │
                                            ▼ (RLS via parent)
                                       bulk_job_items  ◄── encrypted documents
                                                          ◄── 7-day purge
                                       audit_log  ◄── append-only, 30-day purge

(service-role only)
predictus_cache   — shared encrypted cache, 30-day TTL
predictus_token   — singleton row holding the Predictus access token
encrypt_payload   — Vault RPC (pgp_sym_encrypt)
decrypt_payload   — Vault RPC (pgp_sym_decrypt)
```

The full SQL lives under `supabase/migrations/`. Treat migrations as append-only — new changes go in a new file `YYYYMMDDHHMMSS_<slug>.sql`.

## Recipes

### Add a new Server Action that calls Predictus

1. Write `app/<route>/actions.ts` with `'use server'`.
2. Authenticate: `const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser();`
3. Audit BEFORE the external call: `await writeAuditLog({ userId, action, ... }, admin, { allowFailure: true });`
4. Cache lookup first if applicable (see `searchByDoc` in `app/search/actions.ts`).
5. `const client = await createServerPredictusClient();` — never `new PredictusClient(...)`.
6. Cache write best-effort, surrounded by try/catch with `console.warn`.
7. `redirect(...)` at the end if the user navigates somewhere.

### Add a Vitest module

1. Create `lib/<area>/<module>.test.ts` first. Write the failing case.
2. Run `pnpm test -- lib/<area>` to confirm red.
3. Create `lib/<area>/<module>.ts`. Implement until green.
4. `pnpm typecheck` and `pnpm lint:fix` before committing.

### Add a new table or column

1. New migration: `supabase/migrations/<timestamp>_<slug>.sql`.
2. Update `lib/supabase/types.ts` — keep Row, Insert, Update in sync. Insert generally has nullable columns as optional.
3. Touch the corresponding `lib/**` wrapper if any (`job-store.ts`, `cache.ts`, etc.).
4. Update or extend the relevant Vitest suite.

### Bootstrap a fresh environment

1. `pnpm install`
2. `pnpm exec supabase start` (Docker required for local)
3. `cp .env.local.example .env.local` and fill from `supabase status`
4. `psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" -f scripts/bootstrap-vault.sql`
5. Create an operator via Studio (Auth → Add user)
6. Fill `PREDICTUS_USERNAME` / `PREDICTUS_PASSWORD` in `.env.local`
7. `pnpm dev`

## Things to never do

- **Never** put a CPF/CNPJ in `console.log`, `console.error`, an error message, or any persisted artifact. Hash or mask first.
- **Never** import from `legacy-streamlit/`.
- **Never** `new PredictusClient(...)` inside `app/` or `supabase/functions/`. Use `createServerPredictusClient()`.
- **Never** call `supabase.auth.signInWithPassword` outside `app/login/actions.ts`. Sign-in is centralized.
- **Never** add a Server Action that mutates audit/cache state without going through `lib/audit.ts` and `lib/predictus/cache.ts`. Re-deriving the snake_case mapping by hand creates drift.
- **Never** add `as any`. If you need to escape Supabase's `never` inference, use `as never` and explain why in a one-line comment.
- **Never** edit a migration after it has been applied to any environment. Add a new one.
- **Never** disable a Biome rule globally to silence a warning. Add a targeted `biome-ignore` with a justification.
- **Never** skip `pnpm typecheck` and `pnpm test` before committing.

## Commands cheatsheet

```bash
pnpm dev                     # Next.js dev server
pnpm build                   # Production build (also catches proxy.ts / type issues)
pnpm typecheck               # tsc --noEmit, strict
pnpm test                    # vitest run, once
pnpm test:watch              # vitest watch
pnpm test:coverage           # v8 coverage under coverage/
pnpm lint                    # biome check
pnpm lint:fix                # biome check --write (safe fixes)
pnpm format                  # biome format --write

pnpm exec supabase start     # local Postgres + Studio + Auth + Storage
pnpm exec supabase status    # prints publishable key, secret key, db url
pnpm exec supabase db reset  # destroys and re-applies all migrations
pnpm exec supabase db push   # apply pending migrations to the linked project
pnpm exec supabase functions deploy process-bulk-job
```

## When unsure

Re-read the relevant `lib/**/*.test.ts` — it documents the contract better than prose can.
