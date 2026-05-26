# mvp-sturdy-waddle

Internal background check app for PX Center — operators run judicial process searches against the Predictus API by CPF, CNPJ or name, individually or in batches via CSV upload, with automatic antifraude enrichment via the Netrin `consulta-composta` API (3-hop: CPF → CNPJs vinculados → CPFs sócios).

> **For Claude Code:** project conventions, invariants and recipes live in [`CLAUDE.md`](./CLAUDE.md). Read that first.
>
> **Migration note:** this repository was rewritten from a Streamlit + Python MVP to a Supabase + Next.js + Vercel stack. The original Python implementation is preserved under [`legacy-streamlit/`](./legacy-streamlit) for reference only — never imported by the new app.

## Stack

- **App:** Next.js 16 (App Router) + React 19 + TypeScript strict
- **UI:** Tailwind 4 + shadcn/ui + Biome
- **Backend:** Supabase (Postgres 16 + Auth + Edge Functions + Realtime + Vault + pg_cron)
- **Deploy:** Vercel (Next.js) + Supabase (database, auth, edge functions)
- **Tests:** Vitest with TDD discipline — **270 passing** across 31 suites

## Scope

What it does:

- Single search by CPF, CNPJ or name (Predictus)
- Bulk search from CSV upload, capped at **250 documents per job**, processed asynchronously by a Supabase Edge Function
- Automatic antifraude enrichment via Netrin `consulta-composta` on every CPF and CNPJ search (Hops 1+2+3) — identity, PEP/sanções, mídia negativa, processos, empresas relacionadas e sócios, fired-and-forgotten to a dedicated Edge Function
- Per-operator search history and audit log (private via RLS) — Netrin call audit logs every external lookup
- Shared, encrypted Predictus + Netrin caches with 30-day TTL (separate vault keys for defense in depth)
- Unified network graph (`/network/[hash]`) blending processual (Predictus) and societário (Netrin) relationships
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
| `/search/person` | static (client) | Single CPF / nome lookup |
| `/search/company` | static (client) | Single CNPJ lookup |
| `/search/result/[hash]` | dynamic | Predictus processes + Antifraude cards (Realtime via `enrichment:<jobId>`) |
| `/network/[hash]` | dynamic | Unified network graph — processual + societário, with kind filters |
| `/bulk` | static (client) | CSV paste/upload to create a bulk job |
| `/bulk/[jobId]` | dynamic | Realtime progress page (Supabase channels) |
| `/history` | dynamic | Operator's last 100 searches |
| `/audit` | dynamic | Operator's last 200 audit events |
| `proxy.ts` | edge | Session refresh + allowlist enforcement |

## Auth model

Operators are created by an admin through the in-app UI at `/admin/users/new` (Supabase Studio is no longer used for routine user creation — see "Bootstrap do primeiro admin" below for the one-time exception). Signup is disabled in `supabase/config.toml`. The `on_auth_user_created` trigger mirrors each new `auth.users` row into `public.users`, and `proxy.ts` redirects any authenticated user without a `public.users` row to `/access-denied`. Admins can also disable a `public.users` row (`is_active=false`) to revoke access without deleting the underlying `auth.users` row.

Password requirements: 12+ chars, mixed case, digits, symbols.

## Papéis e permissões

A app tem dois papéis: **admin** e **operator**.

- **Operator** acessa apenas os serviços que um admin habilitou para ele:
  - Buscar pessoa (CPF e nome)
  - Buscar empresa (CNPJ)
  - Buscar em lote (CSV)
- **Admin** tem todas as permissões automaticamente, além de:
  - Criar operadores e definir senha temporária
  - Ativar/desativar contas
  - Promover/rebaixar entre admin e operator
  - Mudar permissões de qualquer operador
  - Ver o audit log de todos os operadores em `/admin/audit`

Operadores são criados pela UI em `/admin/users/new`. A senha temporária é exibida uma única vez para o admin repassar pelo canal seguro. Sem dependência de SMTP.

## Bootstrap do primeiro admin

Depois de aplicar as migrations (`pnpm exec supabase db push`), promova um usuário existente a admin via SQL no Supabase Studio:

```sql
update public.users
set role = 'admin'
where email = 'seu-email@px.center';
```

Todos os operadores que já existiam quando a migration entrou ficam como `role='operator'`, `is_active=true`, **sem permissões**. Use a tela `/admin/users` para liberar acesso individualmente.

## LGPD posture

- CPF, CNPJ and personal names **never** appear in cleartext in `public.searches`, `public.audit_log`, `public.enrichment_jobs` or `public.enrichment_job_calls`. All store a SHA-256 `document_hash` (with type prefix `cpf:` / `cnpj:` / `name:` / `lawyer:`) and a masked `term_preview` (e.g. `123.***.***-10`).
- `predictus_cache.encrypted_payload` and `bulk_job_items.document_encrypted` are `bytea`, encrypted via Vault key `predictus_cache_key`.
- `netrin_cache.encrypted_payload` is `bytea`, encrypted via a **separate** Vault key `netrin_cache_key` (defense in depth — vazamento de uma chave não compromete a outra).
- `graph_nodes.encrypted_label` is `bytea`, encrypted via a third Vault key `graph_label_key`. `masked_preview` is the LGPD-safe rendering for client-side fallback.
- Plaintext CPF/CNPJ exists only on the call stack of `processBulkItem` (Predictus) or `processEnrichmentJob` (Netrin) during the upstream HTTP call — never persisted.
- `NETRIN_TOKEN` is server-only — never logged, never returned in error messages, never reaches the client.
- `pg_cron` runs daily at 03:00 UTC:
  - `audit_log`, expired `predictus_cache`, and expired `netrin_cache` rows purged after **30 days**
  - Completed/failed `bulk_jobs` purged after **7 days** (they hold encrypted documents)
  - Completed/failed/partial `enrichment_jobs` purged after **30 days** (only hold hashes; calls cascade-delete)
  - Orphan `enrichment_jobs` (status `pending`/`running` started > 15 min ago) marked as `failed` every 5 minutes
- Audit log captures `user_id`, `action` (including `enrichment_call`), `document_hash`, `ip`, `user_agent` and `metadata` (jsonb with hop number + job id for Netrin calls). Operators read their own audit history; writes happen only via the secret key (`SUPABASE_SECRET_KEY`, formerly `SUPABASE_SERVICE_ROLE_KEY`).

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

### 3. Initialize the Vault keys for encrypted storage

```bash
psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" \
  -f scripts/bootstrap-vault.sql
```

Idempotent. Creates three Vault secrets: `predictus_cache_key` (Predictus cache + bulk items), `netrin_cache_key` (Netrin antifraude cache), and `graph_label_key` (encrypted node labels). Without them, `encrypt_*` / `decrypt_*` RPCs throw a clear error and the search/bulk/enrichment paths surface it.

### 4. Create the first admin, then operators

Routine user creation happens in-app at `/admin/users/new`, but you need an admin to get there. Bootstrap the first admin as follows:

1. Create one user via Supabase Studio (Authentication → Add user) — the `on_auth_user_created` trigger mirrors them into `public.users`.
2. Promote that user to admin in the Studio SQL editor:

   ```sql
   update public.users
   set role = 'admin'
   where email = 'seu-email@px.center';
   ```

3. Sign in as that admin and create the remaining operators from `/admin/users/new`. The temporary password is shown once — share it through a secure channel.

See "Papéis e permissões" and "Bootstrap do primeiro admin" above for the full picture.

### 5. Configure Predictus and Netrin credentials

Fill `PREDICTUS_USERNAME` / `PREDICTUS_PASSWORD` and `NETRIN_TOKEN` in `.env.local`. Both are shared across all operators (one upstream account each). `NETRIN_PEP_ACURACIA` defaults to 95 — lower it only if you need looser PEP name matching.

If `NETRIN_TOKEN` is empty, enrichment jobs will fail at the first Netrin call and the corresponding `enrichment_jobs` row ends in `failed` — Predictus search continues to work normally.

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
components/
  ├── ui/           shadcn/ui primitives
  ├── antifraude/   Cards renderizando Netrin (identity, pep, media, restrictions, related-companies, enrichment-realtime)
  └── network/      Componentes do grafo unificado
lib/                Pure-ish modules covered by Vitest — the logic lives here
  ├── validators/   CPF, CNPJ, name (check digits, masking)
  ├── csv/          CSV parser with 250-doc cap
  ├── hash.ts       SHA-256 document hashing with type prefix (cpf, cnpj, name, lawyer)
  ├── audit.ts      audit_log writer + request context extractor
  ├── crypto/       Vault encrypt/decrypt wrappers (predictus + netrin + graph_label)
  ├── predictus/    HTTP client, token store, cache, item-processor
  ├── netrin/       Antifraude pipeline — client, cache, parsers (pivot CNPJs/CPFs), hops 1/2/3, graph-bridge, job-store, processor, result-loader
  ├── graph/        Shared graph types, label crypto, writer, extractor, path
  ├── bulk/         Job store + orchestration loop
  └── supabase/     Browser/server/admin clients + proxy session refresh
proxy.ts            Next.js 16 file convention (the artifact formerly known as middleware.ts)
supabase/
  ├── migrations/   SQL — schema, RLS, crypto helpers, pg_cron retention
  └── functions/
      ├── process-bulk-job/         Edge Function (Deno) — bulk CSV worker
      └── process-enrichment-job/   Edge Function (Deno) — Netrin Hops 1+2+3 worker
scripts/
  └── bootstrap-vault.sql    Idempotent Vault key creation (predictus + netrin + graph_label)
legacy-streamlit/             Original Python MVP, kept for reference only
```

## Deployment

- **Hosting:** Vercel. Connect this repo, set the env vars from `.env.local` in Vercel Project Settings (include `NETRIN_BASE_URL` and `NETRIN_TOKEN`).
- **Database:** managed Supabase project. `pnpm exec supabase db push` applies pending migrations.
- **Vault keys:** run `scripts/bootstrap-vault.sql` once per environment (Studio → SQL editor works too).
- **Edge Functions:**
  ```bash
  pnpm exec supabase functions deploy process-bulk-job
  pnpm exec supabase functions deploy process-enrichment-job
  ```
  Also push Netrin secrets to the Edge runtime:
  ```bash
  pnpm exec supabase secrets set NETRIN_BASE_URL=https://api.netrin.com.br NETRIN_TOKEN=<token> NETRIN_PEP_ACURACIA=95
  ```
- **Vercel function timeout:** Server Actions only enqueue; the heavy lifting runs in Supabase Edge Functions via `EdgeRuntime.waitUntil`, so the Vercel route returns 202 immediately.

## Limits and assumptions

- Bulk CSV ≤ 250 documents per job (enforced server-side in `parseCsv` and via a CHECK constraint on `bulk_jobs.total_items`).
- Predictus rate limit assumed at **1000 requests/hour**, so the bulk Edge Function paces requests at **1 every 3.6 s**.
- The Predictus token persists in `public.predictus_token` (singleton row), so it survives Edge Function cold starts. Netrin uses a static token from env — no refresh, no persistence.
- Netrin rate limit is unknown from the doc; the enrichment Edge Function runs serial without defensive pacing. If we hit 429 in production we'll add `RETRY_AFTER`-aware delay.
- Netrin fanout: an enrichment job runs 1 + N + N×M calls (Hop1 root → N CNPJs vinculados → M sócios CPF cada). Cache hits across operators on shared documents amortize cost over 30 days. No fanout cap is enforced.
- Single search may reuse an in-flight enrichment job (unique partial index on `enrichment_jobs.root_hash WHERE status IN ('pending','running')`). Repeated searches of the same CPF/CNPJ while the job is running don't trigger duplicate work.
- Cache TTL = 30 days for both Predictus and Netrin. Audit retention = 30 days. Completed bulk jobs purged after 7 days. Completed/partial/failed enrichment jobs purged after 30 days.

## Status

Everything in the scope above is implemented and covered. Test counts at the time of writing:

| Module | Tests |
| --- | --- |
| `lib/validators/*`, `lib/csv/*`, `lib/hash`, `lib/audit`, `lib/crypto/vault` | baseline |
| `lib/predictus/*`, `lib/bulk/*`, `lib/graph/*` | baseline |
| `lib/netrin/client` | 8 |
| `lib/netrin/cache` | 3 |
| `lib/netrin/parsers/pivot-cnpjs` | 4 |
| `lib/netrin/parsers/pivot-cpfs` | 3 |
| `lib/netrin/graph-bridge` | 3 |
| `lib/netrin/hops/hop1`, `hop2`, `hop3` | 5 |
| `lib/netrin/job-store` | 3 |
| `lib/netrin/processor` | 4 |
| **Total** | **270** |

The `app/**` and `supabase/functions/**` layers are exercised by `pnpm build` (Next.js compiler) and the test suites of the libraries they wire together.

## Contributing

Read [`CLAUDE.md`](./CLAUDE.md) before editing. Highlights:

- TDD is the default in `lib/**`.
- Keep CPF/CNPJ out of any persisted artifact unless it's `bulk_job_items.document_encrypted`, `predictus_cache.encrypted_payload` or `netrin_cache.encrypted_payload` (all encrypted), or hashed via `hashDocument`.
- Use `createServerPredictusClient()` / `createServerNetrinClient()` — never `new PredictusClient(...)` / `new NetrinClient(...)` directly.
- `NETRIN_TOKEN` never appears in logs, audit, or client-side responses. It stays in `lib/netrin/server-client.ts` and the Edge Function.
- Run `pnpm typecheck && pnpm test && pnpm lint` before committing.
