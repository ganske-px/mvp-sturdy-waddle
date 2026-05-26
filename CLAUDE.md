# CLAUDE.md

Project context for Claude Code working on this repository. The README is for human onboarding; this file is for the AI agent's conventions, invariants and recipes.

## What this is

Internal background check app for PX Center. Operators authenticate, then query the Predictus API by CPF, CNPJ or name — individually (single search) or via CSV upload (bulk). Every single CPF/CNPJ search also fires a fire-and-forget enrichment job to Netrin `consulta-composta` (3-hop antifraude). Results are cached, audited, and rate-limited.

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
  ├── network-cta.tsx "Ver rede" link, hidden by canSeeNetwork gate
  └── sign-out-button.tsx

lib/                Pure-ish modules with Vitest coverage
  ├── validators/    cpf, cnpj (check digits), name (masking)
  ├── hash.ts        SHA-256 document hashing with type prefix (cpf, cnpj, name, lawyer)
  ├── audit.ts       audit_log writer + request context extractor
  ├── csv/parser.ts  CSV → de-duped CPF/CNPJ lists with 250-doc cap
  ├── crypto/vault.ts encryptText / decryptText via Vault RPC
  ├── predictus/
  │   ├── client.ts        HTTP client w/ token refresh + 3 retries
  │   ├── token-store.ts   Persistence in public.predictus_token
  │   ├── server-client.ts Factory that wires token-store into client
  │   ├── cache.ts         get/set predictus_cache (encrypted, 30d TTL) — also feeds the graph
  │   └── item-processor.ts Per-item cache+Predictus+audit orchestration
  ├── netrin/
  │   ├── client.ts        HTTP GET client for consulta-composta, multi-`s=`, token via query, retries 5xx
  │   ├── server-client.ts Factory reading NETRIN_BASE_URL / NETRIN_TOKEN / NETRIN_PEP_ACURACIA
  │   ├── cache.ts         get/set netrin_cache (encrypted via netrin_cache_key, 30d TTL, per-documento)
  │   ├── types.ts         HOP1_SLUGS / HOP2_SLUGS / HOP3_SLUGS, NetrinError, NetrinCompositePayload
  │   ├── parsers/
  │   │   ├── pivot-cnpjs.ts  Extrai CNPJs de empresas-relacionadas-cpf.negociosRelacionados[]
  │   │   └── pivot-cpfs.ts   Extrai sócios CPF de pessoas-relacionadas-cnpj.entidadesRelacionadas[]
  │   ├── hops/
  │   │   ├── hop1.ts      CPF root: 7 slugs + extract CNPJ pivots
  │   │   ├── hop2.ts      Por CNPJ: 11 slugs + extract CPF sócio pivots
  │   │   └── hop3.ts      Por CPF sócio: 5 slugs (terminal)
  │   ├── job-store.ts     CRUD enrichment_jobs/calls + race-aware findOrCreateJob (23505 fallback)
  │   ├── processor.ts     Loop hop1→hop2 por CNPJ→hop3 por CPF com error isolation por item
  │   ├── graph-bridge.ts  Netrin payload → ExtractedGraph (nodes cpf/cnpj + edges corporate_relation)
  │   └── result-loader.ts Server-only: lê job+calls+decifra netrin_cache em hop1/byCnpj/byCpf
  ├── graph/
  │   ├── types.ts          Shared types (NodeType, EdgeKind, ExtractedGraph, ...)
  │   ├── label-crypto.ts   encrypt/decryptLabel via graph_label_key Vault RPCs
  │   ├── extractor.ts      Pure: Predictus payload → nodes + edges (co_party, client_lawyer, lawyer_lawyer)
  │   └── writer.ts         Encrypts labels and calls upsert_graph RPC atomically
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
  │   ├── process-bulk-job/         Edge Function (Deno) — bulk CSV worker
  │   └── process-enrichment-job/   Edge Function (Deno) — Netrin Hops 1+2+3 worker
  └── config.toml    Local Supabase config (signup disabled, 12-char passwords)
scripts/
  └── bootstrap-vault.sql Idempotent Vault key creation (predictus_cache_key + netrin_cache_key + graph_label_key)

legacy-streamlit/   DO NOT TOUCH. Old Python MVP, kept for reference only.
```

## Invariants

### TDD is the default for `lib/**`

- Write tests first. The current count is **270 passing**; growing the codebase means growing this number.
- Run `pnpm test:watch` while editing a `lib/**` module.
- A new public function in `lib/` without a `.test.ts` is a code smell.
- The `app/**` and `supabase/functions/**` layers are thin wiring on top of `lib/`. They are exercised by build + manual smoke; unit tests are optional there.

### LGPD — these are non-negotiable

- **No CPF, CNPJ or personal name in cleartext** in `searches`, `audit_log`, `enrichment_jobs`, `enrichment_job_calls` or any logged output.
- `document_hash` is always SHA-256 with a type prefix (`cpf:`, `cnpj:`, `name:`, `lawyer:`) via `hashDocument` in `lib/hash.ts`. The prefix prevents cross-type collisions.
- `term_preview` (UI-safe mask, e.g. `123.***.***-10`) comes from `lib/validators/{cpf,cnpj,name}.ts:mask`. Use it instead of formatting the raw document in UI strings.
- `predictus_cache.encrypted_payload` and `bulk_job_items.document_encrypted` are `bytea` columns encrypted via Vault key `predictus_cache_key` (RPCs `encrypt_payload` / `decrypt_payload`, helpers `encryptText` / `decryptText` em `lib/crypto/vault.ts`).
- `netrin_cache.encrypted_payload` é `bytea` encriptado via uma chave **separada** `netrin_cache_key` (defesa em profundidade — vazamento de uma chave não compromete a outra). RPCs `encrypt_netrin` / `decrypt_netrin`, helpers `encryptNetrinText` / `decryptNetrinText`.
- `graph_nodes.encrypted_label` é `bytea` encriptado via uma terceira chave `graph_label_key`, através de `encrypt_graph_label`/`decrypt_graph_label` em `lib/graph/label-crypto.ts`. O label JSON (`{name?, document?, oab?}`) só é plaintext no servidor dentro de Server Actions — nunca em `audit_log` ou retornado ao cliente. `graph_nodes.masked_preview` é a renderização LGPD-safe para fallback client-side.
- Plaintext CPF/CNPJ pode viver em **dois lugares**: (1) stack frame de `processBulkItem` durante a chamada Predictus, (2) stack frame do Edge Function `process-enrichment-job` durante chamadas Netrin (incluindo CPFs sócios descobertos em Hop 2). Em ambos os casos: não persistir, não logar, não retornar.
- `NETRIN_TOKEN` é secret server-only: nunca em log, audit, error message ou resposta de Server Action/cliente. Lido apenas em `lib/netrin/server-client.ts` e na Edge Function.
- Retention: 30 days for `searches`, `audit_log`, `predictus_cache`, `netrin_cache`, `enrichment_jobs` (incluindo `enrichment_job_calls` via cascade); 7 days for completed/failed `bulk_jobs` (because they hold encrypted documents). All purged daily by pg_cron jobs em `20260520180300_retention_cron.sql` e `20260526100400_enrichment_retention.sql`. Jobs órfãos (`pending`/`running` > 15 min) são marcados como `failed` a cada 5 min. **`graph_nodes`/`graph_edges` are not purged** — o grafo é intencionalmente append-only e compartilhado entre operadores.

### Auth + RLS

- Signup is disabled (`supabase/config.toml`). Operators are created manually via Supabase Studio → Auth → Add user. A Postgres trigger mirrors them into `public.users`.
- `proxy.ts` enforces both: (1) authenticated session and (2) row in `public.users`. Removing a row from `public.users` revokes access without touching `auth.users`.
- Tables are RLS-protected:
  - `searches`, `bulk_jobs`, `audit_log` — operator reads/writes own rows.
  - `bulk_job_items` — visible only when the parent job belongs to the operator.
  - `predictus_cache`, `netrin_cache` — any authenticated operator can read; **writes via service-role only**.
  - `graph_nodes`, `graph_edges` — any authenticated operator can read; **writes via service-role only** (via `upsert_graph` RPC).
  - `enrichment_jobs`, `enrichment_job_calls` — operator reads próprias rows (parent gate em calls); **writes via service-role only**. Ambas tabelas estão em `supabase_realtime` publication para o canal `enrichment:<jobId>`.
  - `predictus_token`, `crypto` helpers — **service-role only** (no policies → RLS denies everyone else).
- Anything that writes `audit_log` or `predictus_cache` must use `createAdminClient()` (service role). Anything that reads operator-private data uses `createClient()` (server, cookie-aware).

### Papéis e permissões

- Dois papéis: `admin` e `operator`. Coluna `role` em `public.users`, default `operator`.
- `is_active` em `public.users` é a flag de soft-delete; o proxy bloqueia operadores com `is_active=false`.
- Permissões por serviço vivem em `public.user_service_permissions` (linha presente = permissão concedida). Vocabulário fechado por CHECK: `search_person`, `search_company`, `search_bulk`.
- Admin **sempre** tem todas as permissões — `has_service_permission` retorna true para admins independentemente de linhas em `user_service_permissions`. Não popular permissões para admins.
- Helper SQL `public.is_admin(uuid)` e `public.has_service_permission(uuid, text)` são fonte única de verdade. Use-os em RLS, no proxy e via RPC em `lib/auth/permissions.ts`.
- Server Actions e páginas chamam `requireAuth() / requireAdmin() / requirePermission(svc)` no topo — defesa em profundidade contra navegação direta.
- Mutações sobre `public.users` (toggle is_active, mudar role) e `user_service_permissions` rodam sempre via `createAdminClient()` em Server Actions.
- Guards `assertNotSelf` e `assertNotLastActiveAdmin` em `lib/auth/admin-guards.ts` impedem self-lockout.

### Predictus client

- Never `new PredictusClient(...)` directly inside `app/` or `supabase/functions/`. Use `createServerPredictusClient()` from `lib/predictus/server-client.ts`. It wires the `SupabaseTokenStore` so the access token survives cold starts.
- The client retries 5xx and network errors with exponential backoff (1s, 2s, 4s, then throws). It refreshes on 401 exactly once.
- Predictus credentials are shared (one upstream account for all operators). Never expose them client-side.

### Netrin client

- Never `new NetrinClient(...)` directly inside `app/` ou `supabase/functions/`. Use `createServerNetrinClient()` from `lib/netrin/server-client.ts`. Reads `NETRIN_BASE_URL`, `NETRIN_TOKEN`, `NETRIN_PEP_ACURACIA` (default 95).
- Token estático em query string `?token=...`. Sem `authenticate()`, sem refresh, sem token-store — bem mais simples que Predictus.
- O método único é `fetchComposta(docType, documentRaw, slugs)`. Slugs vêm dos arrays const exportados (`HOP1_SLUGS`, `HOP2_SLUGS`, `HOP3_SLUGS`) em `lib/netrin/types.ts` — nunca componha slugs ad-hoc na call site.
- Retries: 5xx e network com exp backoff (1s, 2s, 4s). 401/403 → throw imediato (token estático, sem refresh).
- O `NETRIN_TOKEN` nunca aparece em mensagem de erro (`NetrinError` carrega apenas status + slugs, não a URL).

### Enrichment orchestration

- Toda busca por CPF (`searchPerson`) ou CNPJ (`searchByCnpj`) chama `findOrCreateJob` passando `documentEncrypted` (CPF/CNPJ cifrado via `encryptText` / `predictus_cache_key`). Re-pesquisar o mesmo documento enquanto há job ativo reusa o job (índice parcial único em `enrichment_jobs.root_hash WHERE status IN ('pending','running')`). **Não há fetch fire-and-forget** — o trigger AFTER INSERT em `enrichment_jobs` chama o Edge Function via `pg_net.http_post` lendo URL e token de `vault.decrypted_secrets` (`enrichment_dispatch_url`, `enrichment_dispatch_token`).
- O Edge Function recebe só `{ jobId }`, lê a row de `enrichment_jobs` (com `document_encrypted`), decifra via `decryptText` e usa o plaintext como `rootRaw`. Plaintext nunca persiste fora do stack frame.
- O Edge Function chama `processEnrichmentJob` com `runHop1` / `runHop2` / `runHop3` injetados — todos compartilhados de `lib/netrin/hops/`. Erro em Hop 1 = `failed`; erro em Hop 2/3 isolado por item = `partial`. Crash do Edge ou trigger falhando (vault sem segredos, pg_net off) = órfão → `failed` em até 15 min via pg_cron.
- Após todos os hops, `buildNetrinGraph(...)` produz `ExtractedGraph` (nodes cpf/cnpj, edges `corporate_relation`) e `upsertGraph` persiste no grafo compartilhado.
- A página `/search/result/[hash]` chama `loadEnrichmentForRoot` (server-only) que decifra `netrin_cache` por hash e renderiza as cards via componentes em `components/antifraude/`. `EnrichmentRealtime` (client) assina `postgres_changes` em `enrichment_jobs` e `enrichment_job_calls` e chama `router.refresh()` em mudanças.

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
                                       searches             ◄── single search history
                                       bulk_jobs             ◄── async batch metadata
                                            │
                                            ▼ (RLS via parent)
                                       bulk_job_items       ◄── encrypted documents
                                                              ◄── 7-day purge
                                       audit_log            ◄── append-only, 30-day purge
                                       enrichment_jobs      ◄── Netrin antifraude job (unique pending|running per root_hash)
                                            │
                                            ▼ (RLS via parent)
                                       enrichment_job_calls ◄── 1 row por chamada HTTP, sem payload
                                                              ◄── 30-day purge (cascade); órfão > 15min = failed
graph_nodes   ◄── shared, append-only (encrypted_label via graph_label_key)
graph_edges   ◄── kinds: co_party | client_lawyer | lawyer_lawyer | corporate_relation

(service-role only)
predictus_cache    — shared encrypted cache (predictus_cache_key), 30-day TTL
netrin_cache       — shared encrypted Netrin composta payload (netrin_cache_key), 30-day TTL
predictus_token    — singleton row holding the Predictus access token
encrypt_payload    — Vault RPC for predictus_cache_key (pgp_sym_encrypt)
decrypt_payload    — Vault RPC for predictus_cache_key (pgp_sym_decrypt)
encrypt_netrin     — Vault RPC for netrin_cache_key
decrypt_netrin     — Vault RPC for netrin_cache_key
encrypt_graph_label/ decrypt_graph_label — Vault RPCs for graph_label_key
upsert_graph       — polymorphic RPC: process kinds merge processNumbers; corporate_relation overwrites evidence
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
5. Popular os segredos de dispatch (env-específicos) via `scripts/bootstrap-dispatch-secrets.sql`:
   ```bash
   psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" \
     -v dispatch_url="'http://host.docker.internal:54321/functions/v1/process-enrichment-job'" \
     -v dispatch_token="'<SUPABASE_SECRET_KEY local>'" \
     -f scripts/bootstrap-dispatch-secrets.sql
   ```
   No prod, rode o mesmo script pelo Studio SQL editor substituindo `:dispatch_url` (`https://<project>.supabase.co/functions/v1/process-enrichment-job`) e `:dispatch_token` (service-role key). É idempotente — re-rodar atualiza o valor. Se algum segredo estiver ausente o trigger emite warning e o sweep de órfãos (15min) marca o job como failed.
6. Create an operator via Studio (Auth → Add user)
7. Fill `PREDICTUS_USERNAME` / `PREDICTUS_PASSWORD` e `NETRIN_TOKEN` in `.env.local`
8. `pnpm dev`

### Adicionar um novo slug Netrin a um Hop existente

1. Adicionar o nome do slug ao array const apropriado em `lib/netrin/types.ts` (`HOP1_SLUGS`, `HOP2_SLUGS` ou `HOP3_SLUGS`). O union type `NetrinSlug` é derivado, não precisa ser editado manualmente.
2. Se o slug carrega um pivot novo (algo análogo a `negociosRelacionados[]`), crie um parser em `lib/netrin/parsers/*.ts` com `.test.ts` (TDD).
3. Se o parser produz nós/arestas no grafo, estender `lib/netrin/graph-bridge.ts` para emitir o `ExtractedEdge` correto (provavelmente `corporate_relation` com um `source` novo).
4. Adicionar a renderização na card relevante em `components/antifraude/` — ou criar uma card nova e plugar em `app/(app)/search/result/[hash]/page.tsx`.
5. Re-rodar `pnpm test`. O cache em `netrin_cache.slugs_fetched` registra quais slugs foram fetchados — payloads cacheados antes do novo slug terão miss parcial; aceita-se a re-busca (a chave é o documento_hash, não o set de slugs).
6. Cobrar separadamente é responsabilidade da Netrin — atenção ao custo se o slug for caro.

### Adicionar uma nova permissão de serviço

1. Migration nova: `alter table public.user_service_permissions drop constraint user_service_permissions_service_check; alter table public.user_service_permissions add constraint user_service_permissions_service_check check (service in ('search_person','search_company','search_bulk','<novo>'));`
2. Adicionar o literal em `Service` em `lib/auth/permissions.ts` e em `ALL_SERVICES`.
3. Adicionar a label em `SERVICE_LABEL` em `components/app-header.tsx`, `app/admin/users/user-form.tsx` e `app/(app)/home-modules.tsx` (todas em pt-BR).
4. Adicionar item de navegação em `NAV_ITEMS` no header, com gate apontando para o novo Service.
5. Gatear o entrypoint do serviço com `await requirePermission('<novo>')` no Server Action correspondente.
6. Atualizar stories que enumeram `ALL_SERVICES` (UserForm, HomeModules).
7. Documentar o serviço no README.

## Bootstrap do primeiro admin

Operadores existentes quando a migration de roles entrou ficam `role='operator', is_active=true, sem permissões`. Para criar o primeiro admin, rode no Studio:

```sql
update public.users set role='admin' where email='seu-email@px.center';
```

Depois, o admin cria os demais operadores via `/admin/users/new`.

## Things to never do

- **Never** put a CPF/CNPJ in `console.log`, `console.error`, an error message, or any persisted artifact. Hash or mask first.
- **Never** put `NETRIN_TOKEN` em log, audit, error message, ou qualquer resposta que chegue ao cliente. O token é server-only.
- **Never** import from `legacy-streamlit/`.
- **Never** `new PredictusClient(...)` ou `new NetrinClient(...)` inside `app/` or `supabase/functions/`. Use `createServerPredictusClient()` / `createServerNetrinClient()`.
- **Never** call `supabase.auth.signInWithPassword` outside `app/login/actions.ts`. Sign-in is centralized.
- **Never** add a Server Action that mutates audit/cache state without going through `lib/audit.ts`, `lib/predictus/cache.ts` ou `lib/netrin/cache.ts`. Re-deriving the snake_case mapping by hand creates drift.
- **Never** compor slugs Netrin ad-hoc — use sempre os arrays const `HOP1_SLUGS` / `HOP2_SLUGS` / `HOP3_SLUGS` de `lib/netrin/types.ts`.
- **Never** chamar `fetchComposta` direto de um Server Action ou page. O ciclo audit→cache→fetch→cache.set é responsabilidade dos `runHopN` em `lib/netrin/hops/`.
- **Never** add `as any`. If you need to escape Supabase's `never` inference, use `as never` and explain why in a one-line comment.
- **Never** edit a migration after it has been applied to any environment. Add a new one.
- **Never** disable a Biome rule globally to silence a warning. Add a targeted `biome-ignore` with a justification.
- **Never** skip `pnpm typecheck` and `pnpm test` before committing.
- **Nunca** citar nomes de fornecedores (ex.: Predictus, Netrin) em copy visível ao operador. Use "consulta", "serviço de consulta", "antifraude" ou "fonte de dados".
- **Nunca** misturar copy em inglês na UI. A interface é toda pt-BR.
- **Nunca** criar usuário no Supabase Studio para uso operacional. Use `/admin/users/new`. Studio fica reservado para bootstrap inicial e operações de emergência.
- **Nunca** chamar `requireAdmin` / `requirePermission` apenas no proxy — sempre repetir na Server Action ou Page como defesa em profundidade.

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
pnpm exec supabase functions deploy process-enrichment-job
pnpm exec supabase secrets set NETRIN_BASE_URL=https://api.netrin.com.br NETRIN_TOKEN=<token> NETRIN_PEP_ACURACIA=95
```

## When unsure

Re-read the relevant `lib/**/*.test.ts` — it documents the contract better than prose can.
