# mvp-sturdy-waddle

Internal background check app for PX Center — operators run judicial process searches against the Predictus API by CPF, CNPJ or name, individually or in batches via CSV upload.

> **Migration note:** this repository was rewritten from a Streamlit + Python MVP to a Supabase + Next.js + Vercel stack. The original Python implementation is preserved under [`legacy-streamlit/`](./legacy-streamlit) for reference and is not deployed.

## Stack

- **Frontend:** Next.js 16 (App Router) + React 19 + TypeScript strict
- **UI:** Tailwind 4 + shadcn/ui + Biome
- **Backend:** Supabase (Postgres 16 + Auth + Edge Functions + Realtime + Vault + pg_cron)
- **Deploy:** Vercel
- **Tests:** Vitest (TDD)

## Scope (paridade pura)

- Single search by CPF, CNPJ or name (Predictus)
- Bulk search by CSV upload, capped at **250 documents per job**
- Per-operator search history (private, RLS)
- Shared Predictus cache with **30-day TTL** (encrypted at rest)
- Append-only audit log retained for **30 days**, purged daily by `pg_cron`
- Magic-link auth was rejected; **email + password only**, with signup disabled

## What is intentionally out of scope

- Gemini-powered risk assessment (mentioned in the original README but never shipped)
- PostHog instrumentation
- Multi-tenant organisations
- Cancellation of in-flight bulk jobs

## Auth model

Operators are created **manually** by the admin via Supabase Studio (Auth → Add user). Signup is disabled in `supabase/config.toml`. The `on_auth_user_created` trigger mirrors each new `auth.users` row into `public.users`, and `proxy.ts` (the Next.js 16 file convention, previously `middleware.ts`) enforces that any authenticated user without a `public.users` row is redirected to `/access-denied`. This means revoking access = deleting the `public.users` row (keeping the auth row dormant).

Password requirements: 12+ chars, mixed case, digits, symbols.

## LGPD posture

- CPF, CNPJ and personal names **never** appear in plaintext in `public.searches` or `public.audit_log`. Both tables store a SHA-256 `document_hash` and a partially-masked `term_preview` (e.g. `123.***.***-10`).
- The full Predictus payload is cached in `public.predictus_cache.encrypted_payload`, encrypted with `pgp_sym_encrypt` using a key stored in Supabase Vault under `predictus_cache_key`.
- `pg_cron` runs daily at 03:00 UTC to purge `audit_log`, expired `predictus_cache` rows, and completed `bulk_jobs` older than 30 days.
- Audit log captures `user_id`, `action`, `document_hash`, `ip`, `user_agent` and `metadata` (jsonb). Operators can read their own audit history; writes happen only via the service-role key.

## Project layout

```
app/                        Next.js App Router pages
components/ui/              shadcn/ui primitives
lib/
├── validators/{cpf,cnpj}   Check-digit validation, normalize, format, mask
├── csv/parser              CSV → de-duped CPF/CNPJ lists with 250-row cap
├── predictus/              Predictus API client (auth refresh + retries)
└── supabase/               Browser/server/admin clients + proxy session refresh
supabase/
├── migrations/             SQL schema, RLS, crypto helpers, pg_cron jobs
└── functions/
    └── process-bulk-job/   Edge Function for async bulk processing
tests/                      Vitest suites
legacy-streamlit/           Original Python MVP (not deployed)
```

## Local setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Boot Supabase locally

You need Docker running.

```bash
pnpm exec supabase start
```

The first run downloads container images and applies the migrations under `supabase/migrations/`. The output prints `API URL`, `anon key` and `service_role key` — copy those into `.env.local`:

```bash
cp .env.local.example .env.local
# fill in the printed values
```

### 3. Initialize the Vault key for encrypted storage

After `supabase start`, run the bootstrap script once per environment:

```bash
psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" \
  -f scripts/bootstrap-vault.sql
```

This is idempotent — re-runs are no-ops. Without the secret, the `encrypt_payload` / `decrypt_payload` Vault RPCs throw a clear error, and the search/bulk paths surface that to the operator.

### 4. Create an operator

In Supabase Studio → Authentication → Add user. Set email + a password meeting the requirements. The trigger mirrors the user into `public.users` automatically.

### 5. Configure Predictus credentials

Fill `PREDICTUS_USERNAME` and `PREDICTUS_PASSWORD` in `.env.local`. These are shared between all operators.

### 6. Run the app

```bash
pnpm dev
```

Open <http://localhost:3000>.

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Run Next.js dev server |
| `pnpm build` | Production build |
| `pnpm typecheck` | TypeScript strict check (no emit) |
| `pnpm test` | Run all Vitest suites once |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm test:coverage` | Coverage report under `coverage/` |
| `pnpm lint` | Biome check |
| `pnpm lint:fix` | Biome check + autofix |
| `pnpm format` | Biome format |

## Deployment

- **Hosting:** Vercel. Connect this repo, set the same env vars from `.env.local` in Vercel Project Settings.
- **Database:** managed Supabase project. Run `pnpm exec supabase db push` against the linked project to apply migrations.
- **Edge Function:** `pnpm exec supabase functions deploy process-bulk-job` after the function is implemented.
- **Vercel function timeout:** the bulk-job Server Action only enqueues; the heavy lifting runs in the Supabase Edge Function (no Vercel timeout pressure).

## Limits and assumptions

- Bulk CSV ≤ 250 documents per job (enforced server-side in `parseCsv` and via a CHECK constraint on `bulk_jobs.total_items`).
- Predictus rate limit assumed at **1000 requests/hour**, so the Edge Function paces requests at **1 every 3.6 s**.
- Cache TTL = 30 days. Audit retention = 30 days. Completed bulk jobs purged after **7 days**.
- The Predictus token persists in `public.predictus_token` (singleton row), so it survives Edge Function cold starts.

### Bulk item document storage

`bulk_job_items.document_encrypted` holds the CPF/CNPJ as `bytea`, encrypted with the same Vault key (`predictus_cache_key`) used by `predictus_cache.encrypted_payload`. The Server Action encrypts via `encryptText` before insert; the Edge Function decrypts inline (`decryptText`) immediately before each Predictus call. Combined with:

- **7-day purge** of completed/failed jobs via `purge-old-bulk-jobs-daily`
- **Service-role only writes** (RLS denies INSERT/UPDATE for authenticated users)
- **Vault-backed key** rotatable independently from application secrets

…the cleartext window is reduced to the Edge Function call stack.

## Status

What is implemented and tested in this commit:

- [x] Branch `feature/nextjs-rewrite` off `main`, legacy Python preserved under `legacy-streamlit/`
- [x] Next.js + TS strict + Tailwind 4 + shadcn/ui + Biome + Vitest scaffold
- [x] Supabase schema with RLS, crypto helpers and pg_cron retention (migrations 1–4)
- [x] CPF/CNPJ validators with check digits — 40 tests
- [x] CSV parser with 250-doc cap and CNPJ-before-CPF disambiguation — 14 tests
- [x] Predictus client with token refresh and 3-retry backoff — 15 tests
- [x] Supabase browser/server/admin clients + proxy allowlist (Next.js 16 `proxy.ts`)
- [x] `lib/hash.ts` — SHA-256 document hashing with cross-type separation — 16 tests
- [x] `lib/audit.ts` — audit_log writer + request context extractor — 10 tests
- [x] `lib/validators/name.ts` — name masking for the UI — 5 tests
- [x] `/login` page + `signIn` Server Action + `/access-denied`
- [x] `/search` page + `searchByDoc` Server Action (audit-before-Predictus)
- [x] `/history` page (operator's last 100 searches via RLS)
- [x] Home `/` with navigation cards (Search / History)
- [x] `PredictusClient` exposes `initialToken` + `onTokenChange` hooks — 19 tests
- [x] `SupabaseTokenStore` persists access token in `public.predictus_token` — 7 tests
- [x] `createServerPredictusClient()` wires the store into the client so the
      token survives cold starts
- [x] `lib/predictus/cache.ts` round-trips encrypted payloads via the
      `encrypt_payload`/`decrypt_payload` Vault RPCs — 9 tests
- [x] `searchByDoc` is cache-first: cache hit returns immediately, miss
      hits Predictus then UPSERTs the cache. UI shows a "Cached — fetched X
      ago" or "Fresh" badge.
- [x] `lib/bulk/job-store.ts` — CRUD over `bulk_jobs`/`bulk_job_items` —
      15 tests
- [x] `lib/bulk/processor.ts` — orchestration loop with per-item error
      isolation, rate-limited sleep between items, completion logic —
      8 tests
- [x] `lib/bulk/item-processor.ts` — cache + Predictus + audit per item —
      10 tests
- [x] `/bulk` upload UI + `createBulkJobAction` Server Action that parses
      the CSV, persists job+items, and triggers the Edge Function
- [x] `/bulk/[jobId]` page subscribed to Realtime updates on `bulk_jobs`
      and `bulk_job_items` — progress bar + per-item status table
- [x] `supabase/functions/process-bulk-job/` Edge Function (Deno) that
      reuses the TS modules under Node — same tested code path
- [x] `signOut` Server Action + `<SignOutButton>` on the home (audit log of logout)
- [x] `/audit` page — operator reads their own `audit_log` via RLS,
      with action labels, masked hashes and per-event metadata
- [x] `scripts/bootstrap-vault.sql` — idempotent script that creates
      the `predictus_cache_key` Vault secret
- [x] `lib/crypto/vault.ts` — `encryptText`/`decryptText` extracted from
      `lib/predictus/cache.ts` for reuse (6 tests). Cache refactored
      to use it.
- [x] `bulk_job_items.document_value` (plaintext) replaced by
      `document_encrypted bytea`. `createBulkJob` now accepts an
      injected `encryptDocument` and the Edge Function decrypts via
      `decryptText` immediately before each Predictus call. The
      plaintext CPF/CNPJ never persists past the in-memory stack of
      `processBulkItem`.

What is **not** implemented yet:

_(Nothing critical for the scoped MVP. Future candidates listed under
"Known limitations" for visibility.)_
