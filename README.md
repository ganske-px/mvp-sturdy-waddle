# mvp-sturdy-waddle

Internal background check app for PX Center — operators run judicial process searches against the Predictus API by CPF, CNPJ or name, individually or in batches via CSV upload.

> **For Claude Code:** project conventions, invariants and recipes live in [`CLAUDE.md`](./CLAUDE.md). Read that first.
>
> **Migration note:** this repository was rewritten from a Streamlit + Python MVP to a Supabase + Next.js + Vercel stack. The original Python implementation is preserved under [`legacy-streamlit/`](./legacy-streamlit) for reference only — never imported by the new app.

## Stack

- **App:** Next.js 16 (App Router) + React 19 + TypeScript strict
- **UI:** Tailwind 4 + shadcn/ui + Biome
- **Backend:** Supabase (Postgres 16 + Auth + Edge Functions + Realtime + Vault + pg_cron)
- **Deploy:** Vercel (Next.js) + Supabase (database, auth, edge functions)
- **Tests:** Vitest with TDD discipline — **157 passing** across 13 suites

## Scope

What it does:

- Single search by CPF, CNPJ or name (Predictus)
- Bulk search from CSV upload, capped at **250 documents per job**, processed asynchronously by a Supabase Edge Function
- Per-operator search history and audit log (private via RLS)
- Shared, encrypted Predictus result cache with 30-day TTL
- Email + password auth with manual operator allowlist

What it does **not** do:

- Gemini-powered risk scoring (referenced in the legacy README but never shipped)
- PostHog instrumentation
- Multi-tenant organisations or per-customer billing
- Cancellation of in-flight bulk jobs

## Routes

| Path | Type | Purpose |
| --- | --- | --- |
| `/` | static | Nav cards (Search / Bulk / History) + audit link + sign out |
| `/login` | static | Email + password sign-in |
| `/access-denied` | static | Authenticated but not on the operator allowlist |
| `/search` | static (client) | Single document lookup with cache-or-fresh badge |
| `/bulk` | static (client) | CSV paste/upload to create a bulk job |
| `/bulk/[jobId]` | dynamic | Realtime progress page (Supabase channels) |
| `/history` | dynamic | Operator's last 100 searches |
| `/audit` | dynamic | Operator's last 200 audit events |
| `proxy.ts` | edge | Session refresh + allowlist enforcement |

## Auth model

Operators are created manually by the admin via Supabase Studio (Auth → Add user). Signup is disabled in `supabase/config.toml`. The `on_auth_user_created` trigger mirrors each new `auth.users` row into `public.users`, and `proxy.ts` redirects any authenticated user without a `public.users` row to `/access-denied`. Revoke access by deleting the `public.users` row — the `auth.users` row can stay dormant.

Password requirements: 12+ chars, mixed case, digits, symbols.

## LGPD posture

- CPF, CNPJ and personal names **never** appear in cleartext in `public.searches` or `public.audit_log`. Both store a SHA-256 `document_hash` and a masked `term_preview` (e.g. `123.***.***-10`).
- `predictus_cache.encrypted_payload` and `bulk_job_items.document_encrypted` are `bytea`, encrypted via `pgp_sym_encrypt` with a key stored in Supabase Vault (`predictus_cache_key`).
- Plaintext CPF/CNPJ exists only on the call stack of `processBulkItem` during the Predictus call — never persisted.
- `pg_cron` runs daily at 03:00 UTC:
  - `audit_log` and expired `predictus_cache` rows purged after **30 days**
  - Completed/failed `bulk_jobs` purged after **7 days** (they hold encrypted documents)
- Audit log captures `user_id`, `action`, `document_hash`, `ip`, `user_agent` and `metadata` (jsonb). Operators read their own audit history; writes happen only via the secret key (`SUPABASE_SECRET_KEY`, formerly `SUPABASE_SERVICE_ROLE_KEY`).

## Local setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Boot Supabase locally

Requires Docker.

```bash
pnpm exec supabase start
```

The first run downloads container images and applies the migrations under `supabase/migrations/`. It prints `API URL`, `publishable key` and `secret key` — copy those into `.env.local`:

```bash
cp .env.local.example .env.local
# fill in the printed values
```

### 3. Initialize the Vault key for encrypted storage

```bash
psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" \
  -f scripts/bootstrap-vault.sql
```

Idempotent. Without the secret, `encrypt_payload` / `decrypt_payload` throw a clear error and the search/bulk paths surface it.

### 4. Create an operator

Supabase Studio → Authentication → Add user. The trigger mirrors the user into `public.users` automatically.

### 5. Configure Predictus credentials

Fill `PREDICTUS_USERNAME` and `PREDICTUS_PASSWORD` in `.env.local`. These credentials are shared across all operators (one upstream account).

### 6. Run the app

```bash
pnpm dev
```

Open <http://localhost:3000>.

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build |
| `pnpm typecheck` | TypeScript strict check (no emit) |
| `pnpm test` | Vitest run, once |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm test:coverage` | Coverage report under `coverage/` |
| `pnpm lint` | Biome check |
| `pnpm lint:fix` | Biome check + autofix |
| `pnpm format` | Biome format |

## Project layout

```
app/                Next.js App Router pages + Server Actions (thin wiring)
components/ui/      shadcn/ui primitives
lib/                Pure-ish modules covered by Vitest — the logic lives here
  ├── validators/   CPF, CNPJ, name (check digits, masking)
  ├── csv/          CSV parser with 250-doc cap
  ├── hash.ts       SHA-256 document hashing with type prefix
  ├── audit.ts      audit_log writer + request context extractor
  ├── crypto/       Vault encrypt/decrypt wrappers
  ├── predictus/    HTTP client, token store, cache, item-processor
  ├── bulk/         Job store + orchestration loop
  └── supabase/     Browser/server/admin clients + proxy session refresh
proxy.ts            Next.js 16 file convention (the artifact formerly known as middleware.ts)
supabase/
  ├── migrations/   SQL — schema, RLS, crypto helpers, pg_cron retention
  └── functions/
      └── process-bulk-job/  Edge Function (Deno) — reuses lib/ via relative imports
scripts/
  └── bootstrap-vault.sql    Idempotent Vault key creation
legacy-streamlit/             Original Python MVP, kept for reference only
```

## Deployment

- **Hosting:** Vercel. Connect this repo, set the env vars from `.env.local` in Vercel Project Settings.
- **Database:** managed Supabase project. `pnpm exec supabase db push` applies pending migrations.
- **Vault key:** run `scripts/bootstrap-vault.sql` once per environment (Studio → SQL editor works too).
- **Edge Function:** `pnpm exec supabase functions deploy process-bulk-job`.
- **Vercel function timeout:** the bulk-job Server Action only enqueues; the heavy lifting runs in the Supabase Edge Function via `EdgeRuntime.waitUntil`, so the Vercel route returns 202 immediately.

## Limits and assumptions

- Bulk CSV ≤ 250 documents per job (enforced server-side in `parseCsv` and via a CHECK constraint on `bulk_jobs.total_items`).
- Predictus rate limit assumed at **1000 requests/hour**, so the Edge Function paces requests at **1 every 3.6 s**.
- The Predictus token persists in `public.predictus_token` (singleton row), so it survives Edge Function cold starts.
- Cache TTL = 30 days. Audit retention = 30 days. Completed bulk jobs purged after 7 days.

## Status

Everything in the scope above is implemented and covered. Test counts at the time of writing:

| Module | Tests |
| --- | --- |
| `lib/validators/cpf` | 20 |
| `lib/validators/cnpj` | 20 |
| `lib/validators/name` | 5 |
| `lib/csv/parser` | 14 |
| `lib/hash` | 16 |
| `lib/audit` | 10 |
| `lib/crypto/vault` | 6 |
| `lib/predictus/client` | 19 |
| `lib/predictus/token-store` | 7 |
| `lib/predictus/cache` | 9 |
| `lib/bulk/job-store` | 16 |
| `lib/bulk/processor` | 8 |
| `lib/bulk/item-processor` | 10 |
| **Total** | **157** |

The `app/**` and `supabase/functions/**` layers are exercised by `pnpm build` (Next.js compiler) and the test suites of the libraries they wire together.

## Contributing

Read [`CLAUDE.md`](./CLAUDE.md) before editing. Highlights:

- TDD is the default in `lib/**`.
- Keep CPF/CNPJ out of any persisted artifact unless it's `bulk_job_items.document_encrypted` (encrypted) or hashed via `hashDocument`.
- Use `createServerPredictusClient()` — never `new PredictusClient(...)` directly.
- Run `pnpm typecheck && pnpm test && pnpm lint` before committing.
