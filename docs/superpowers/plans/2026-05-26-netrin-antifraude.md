# Netrin Antifraude (Hops 1+2+3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enriquecer automaticamente toda busca por CPF/CNPJ com dados antifraude da Netrin (`consulta-composta`), expandindo até 3 hops (CPF root → CNPJs vinculados → CPFs sócios), com cache encriptado de 30 dias, job assíncrono modelado em tabelas dedicadas e integração ao grafo de rede existente.

**Architecture:** Server Action cria `enrichment_job` e chama Edge Function `process-enrichment-job` em fire-and-forget. A Edge Function orquestra os hops via `lib/netrin/processor.ts` (loop com error isolation), persistindo cada chamada em `enrichment_job_calls` e o payload em `netrin_cache` (encriptado via `netrin_cache_key`). Cliente assina canal Realtime `enrichment:<jobId>` na página de resultado; cards Antifraude populam progressivamente. Grafo recebe nodes CPF/CNPJ e edges `corporate_relation` via `upsert_graph` RPC estendido.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Vitest, Supabase Postgres + Edge Functions + Realtime + Vault, Tailwind 4 + shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-05-26-netrin-antifraude-design.md](../specs/2026-05-26-netrin-antifraude-design.md)

**Convenções**
- Toda implementação em `lib/**` é TDD: teste primeiro, vermelho, implementar, verde, commit.
- Migrations append-only, formato `YYYYMMDDHHMMSS_<slug>.sql`. Use stems a partir de `20260526100000` neste plano.
- Imports absolutos via `@/`.
- Token Netrin nunca aparece em log/audit. Server-side only.

---

## Fase A — Schema, Vault e tipos

### Task A1: Vault key `netrin_cache_key`

**Files:**
- Create: `supabase/migrations/20260526100000_netrin_cache_key.sql`
- Modify: `scripts/bootstrap-vault.sql`

- [ ] **Step 1: Criar migration**

```sql
-- supabase/migrations/20260526100000_netrin_cache_key.sql
-- ============================================================================
-- netrin_cache_key — Vault key backing encrypt_netrin / decrypt_netrin
-- Mantida separada de predictus_cache_key (defesa em profundidade: vazamento
-- de uma chave não compromete o payload protegido pela outra).
-- ============================================================================

do $netrin_cache_key$
begin
  if not exists (select 1 from vault.secrets where name = 'netrin_cache_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'netrin_cache_key',
      'Encryption key for netrin_cache.encrypted_payload'
    );
    raise notice 'netrin_cache_key created.';
  else
    raise notice 'netrin_cache_key already exists, skipping.';
  end if;
end
$netrin_cache_key$;
```

- [ ] **Step 2: Adicionar bloco idempotente em `scripts/bootstrap-vault.sql`**

Append ao final do arquivo:

```sql

-- netrin_cache_key — mirrors migration 20260526100000_netrin_cache_key.sql
do $netrin_cache_key$
begin
  if not exists (select 1 from vault.secrets where name = 'netrin_cache_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'netrin_cache_key',
      'Encryption key for netrin_cache.encrypted_payload'
    );
    raise notice 'netrin_cache_key created.';
  else
    raise notice 'netrin_cache_key already exists, skipping.';
  end if;
end
$netrin_cache_key$;
```

- [ ] **Step 3: Aplicar a migration localmente**

Run: `pnpm exec supabase db reset`
Expected: prints `netrin_cache_key created.` no log da migration.

- [ ] **Step 4: Verificar a key existe**

Run: `psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" -c "select name from vault.secrets where name='netrin_cache_key';"`
Expected: 1 row retornado.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260526100000_netrin_cache_key.sql scripts/bootstrap-vault.sql
git commit -m "feat(netrin): add netrin_cache_key vault secret"
```

---

### Task A2: Tabela `netrin_cache` + RPCs encrypt/decrypt

**Files:**
- Create: `supabase/migrations/20260526100100_netrin_cache.sql`

- [ ] **Step 1: Criar migration**

```sql
-- supabase/migrations/20260526100100_netrin_cache.sql
-- ============================================================================
-- netrin_cache: shared, 30-day TTL, encrypted via netrin_cache_key
-- ============================================================================

create table public.netrin_cache (
  document_hash     text primary key,
  document_type     text not null check (document_type in ('cpf','cnpj')),
  encrypted_payload bytea not null,
  slugs_fetched     text[] not null,
  fetched_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '30 days')
);

comment on table public.netrin_cache is
  'Shared encrypted Netrin consulta-composta payloads, 30-day TTL. document_hash '
  'reuses hashDocument(cpf|cnpj, value). Encrypted via vault key netrin_cache_key.';

create index netrin_cache_expires_idx on public.netrin_cache (expires_at);

alter table public.netrin_cache enable row level security;

-- Reads: any authenticated operator
create policy netrin_cache_read_authenticated on public.netrin_cache
  for select using (auth.role() = 'authenticated');
-- Writes: service_role only (no insert/update/delete policies = RLS denies all)

-- ----------------------------------------------------------------------------
-- encrypt_netrin / decrypt_netrin RPCs (mirror encrypt_payload / decrypt_payload)
-- ----------------------------------------------------------------------------
create or replace function public.encrypt_netrin(plaintext text)
returns bytea
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  secret_value text;
  secret_bytes bytea;
begin
  select decrypted_secret into secret_value
  from vault.decrypted_secrets
  where name = 'netrin_cache_key';

  if secret_value is null then
    raise exception 'netrin_cache_key not found in vault';
  end if;

  secret_bytes := decode(secret_value, 'base64');
  return extensions.pgp_sym_encrypt(plaintext, encode(secret_bytes, 'hex'));
end;
$$;

create or replace function public.decrypt_netrin(ciphertext bytea)
returns text
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  secret_value text;
  secret_bytes bytea;
begin
  select decrypted_secret into secret_value
  from vault.decrypted_secrets
  where name = 'netrin_cache_key';

  if secret_value is null then
    raise exception 'netrin_cache_key not found in vault';
  end if;

  secret_bytes := decode(secret_value, 'base64');
  return extensions.pgp_sym_decrypt(ciphertext, encode(secret_bytes, 'hex'));
end;
$$;

revoke all on function public.encrypt_netrin(text) from public, anon, authenticated;
revoke all on function public.decrypt_netrin(bytea) from public, anon, authenticated;
grant execute on function public.encrypt_netrin(text) to service_role;
grant execute on function public.decrypt_netrin(bytea) to service_role;
```

- [ ] **Step 2: Aplicar**

Run: `pnpm exec supabase db reset`
Expected: migration aplica sem erro.

- [ ] **Step 3: Smoke-test crypto RPCs**

Run:
```bash
psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" -c \
"select public.decrypt_netrin(public.encrypt_netrin('hello'));"
```
Expected: retorna `hello`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260526100100_netrin_cache.sql
git commit -m "feat(netrin): add netrin_cache table + encrypt/decrypt RPCs"
```

---

### Task A3: Tabelas `enrichment_jobs` + `enrichment_job_calls`

**Files:**
- Create: `supabase/migrations/20260526100200_enrichment_jobs.sql`

- [ ] **Step 1: Criar migration**

```sql
-- supabase/migrations/20260526100200_enrichment_jobs.sql
-- ============================================================================
-- Async enrichment jobs (Netrin Hops 1+2+3)
-- ============================================================================

create table public.enrichment_jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  root_hash   text not null,
  root_type   text not null check (root_type in ('cpf','cnpj')),
  status      text not null check (status in ('pending','running','completed','partial','failed')),
  hop1_status text check (hop1_status in (null,'success','error','cache_hit','skipped')),
  hop2_total  int not null default 0,
  hop2_done   int not null default 0,
  hop3_total  int not null default 0,
  hop3_done   int not null default 0,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  error       text
);

-- Apenas 1 job ativo por root_hash: busca repetida reusa o existente.
create unique index enrichment_jobs_one_active_per_root
  on public.enrichment_jobs (root_hash)
  where status in ('pending','running');

create index enrichment_jobs_user_idx on public.enrichment_jobs (user_id, started_at desc);
create index enrichment_jobs_status_started_idx on public.enrichment_jobs (status, started_at);

create table public.enrichment_job_calls (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.enrichment_jobs(id) on delete cascade,
  hop            int not null check (hop in (1,2,3)),
  document_hash  text not null,
  document_type  text not null check (document_type in ('cpf','cnpj')),
  slugs          text[] not null,
  status         text not null check (status in ('pending','running','success','error','cache_hit')),
  cached         boolean not null default false,
  fetched_at     timestamptz,
  error          text,
  created_at     timestamptz not null default now()
);

create index enrichment_job_calls_job_idx on public.enrichment_job_calls (job_id);
create index enrichment_job_calls_doc_idx on public.enrichment_job_calls (document_hash);

alter table public.enrichment_jobs      enable row level security;
alter table public.enrichment_job_calls enable row level security;

create policy enrichment_jobs_own_select on public.enrichment_jobs
  for select using (user_id = auth.uid());

create policy enrichment_job_calls_via_parent on public.enrichment_job_calls
  for select using (
    exists (
      select 1 from public.enrichment_jobs j
      where j.id = job_id and j.user_id = auth.uid()
    )
  );
-- Writes service_role only.

-- Realtime: opt-in nas publicações
alter publication supabase_realtime add table public.enrichment_jobs;
alter publication supabase_realtime add table public.enrichment_job_calls;
```

- [ ] **Step 2: Aplicar**

Run: `pnpm exec supabase db reset`
Expected: aplica sem erro.

- [ ] **Step 3: Verificar índice parcial**

Run:
```bash
psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" -c \
"\d enrichment_jobs"
```
Expected: lista `enrichment_jobs_one_active_per_root` com predicate `status in ('pending','running')`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260526100200_enrichment_jobs.sql
git commit -m "feat(netrin): add enrichment_jobs + enrichment_job_calls tables"
```

---

### Task A4: Estender `audit_log.action` + `graph_edges.kind` + `upsert_graph` RPC

**Files:**
- Create: `supabase/migrations/20260526100300_enrichment_audit_and_graph.sql`

- [ ] **Step 1: Criar migration**

```sql
-- supabase/migrations/20260526100300_enrichment_audit_and_graph.sql
-- ============================================================================
-- Extends audit_log.action and graph_edges.kind vocabularies; updates
-- upsert_graph RPC to accept polymorphic edge evidence (jsonb).
-- ============================================================================

-- ----- audit_log.action -----------------------------------------------------
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in (
    'login','logout','search_single','search_bulk_item',
    'bulk_job_created','export_csv',
    'admin_user_created','admin_user_set_active',
    'admin_user_set_role','admin_user_permission_changed',
    'view_network','expand_network_node',
    'enrichment_call'
  ));

-- ----- graph_edges.kind -----------------------------------------------------
alter table public.graph_edges drop constraint graph_edges_kind_check;
alter table public.graph_edges add constraint graph_edges_kind_check
  check (kind in ('co_party','client_lawyer','lawyer_lawyer','corporate_relation'));

-- ----- upsert_graph: polymorphic evidence -----------------------------------
-- Replace the existing function. For process-derived kinds the merge keeps
-- set-union of processNumbers + samePolo + occurrences (unchanged). For
-- corporate_relation the evidence comes pre-shaped from the caller (TS) and
-- the SQL just overwrites it; corporate vínculos are stable enough that
-- merging adds no signal.

create or replace function public.upsert_graph(
  nodes_in jsonb,
  edges_in jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  n jsonb;
  e jsonb;
  k text;
  existing_evidence jsonb;
  process_numbers jsonb;
  same_polo_val jsonb;
  occurrences int;
  corp_evidence jsonb;
begin
  -- Nodes
  if jsonb_typeof(nodes_in) = 'array' then
    for n in select * from jsonb_array_elements(nodes_in) loop
      insert into public.graph_nodes (
        node_hash, node_type, encrypted_label, masked_preview
      )
      values (
        n->>'node_hash',
        n->>'node_type',
        decode(n->>'encrypted_label_b64', 'base64'),
        n->>'masked_preview'
      )
      on conflict (node_hash) do update
        set last_seen_at = now();
    end loop;
  end if;

  -- Edges
  if jsonb_typeof(edges_in) = 'array' then
    for e in select * from jsonb_array_elements(edges_in) loop
      k := e->>'kind';

      if k = 'corporate_relation' then
        corp_evidence := coalesce(e->'evidence', '{}'::jsonb);
        insert into public.graph_edges (source_hash, target_hash, kind, evidence)
        values (e->>'source_hash', e->>'target_hash', k, corp_evidence)
        on conflict (source_hash, target_hash, kind) do update
          set evidence = excluded.evidence,
              last_seen_at = now();
      else
        select evidence into existing_evidence
        from public.graph_edges
        where source_hash = e->>'source_hash'
          and target_hash = e->>'target_hash'
          and kind        = k;

        if existing_evidence is null then
          process_numbers := jsonb_build_array(e->>'process_number');
          occurrences := 1;
        else
          process_numbers := coalesce(existing_evidence->'processNumbers', '[]'::jsonb);
          if not (process_numbers @> jsonb_build_array(e->>'process_number')) then
            process_numbers := process_numbers || jsonb_build_array(e->>'process_number');
          end if;
          occurrences := jsonb_array_length(process_numbers);
        end if;

        same_polo_val := case
          when e ? 'same_polo' and (e->'same_polo') is not null then e->'same_polo'
          else 'null'::jsonb
        end;

        insert into public.graph_edges (source_hash, target_hash, kind, evidence)
        values (
          e->>'source_hash',
          e->>'target_hash',
          k,
          jsonb_build_object(
            'processNumbers', process_numbers,
            'samePolo', same_polo_val,
            'occurrences', occurrences
          )
        )
        on conflict (source_hash, target_hash, kind) do update
          set evidence = jsonb_build_object(
                'processNumbers', process_numbers,
                'samePolo', same_polo_val,
                'occurrences', occurrences
              ),
              last_seen_at = now();
      end if;
    end loop;
  end if;
end;
$$;

revoke all on function public.upsert_graph(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_graph(jsonb, jsonb) to service_role;
```

- [ ] **Step 2: Aplicar**

Run: `pnpm exec supabase db reset`

- [ ] **Step 3: Smoke test do RPC com corporate edge**

Run:
```bash
psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" -c \
"select public.upsert_graph(
  '[]'::jsonb,
  '[{\"source_hash\":\"x\",\"target_hash\":\"y\",\"kind\":\"corporate_relation\",\"evidence\":{\"vinculo\":\"SOCIO\"}}]'::jsonb
);"
```
Expected: erro de FK (graph_edges depende de graph_nodes). Esperado. Significa que o ramo `corporate_relation` foi atingido.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260526100300_enrichment_audit_and_graph.sql
git commit -m "feat(graph): extend kind vocab to corporate_relation + polymorphic evidence"
```

---

### Task A5: Retention pg_cron (cache + jobs + órfãos)

**Files:**
- Create: `supabase/migrations/20260526100400_enrichment_retention.sql`

- [ ] **Step 1: Criar migration**

```sql
-- supabase/migrations/20260526100400_enrichment_retention.sql
-- ============================================================================
-- Retention: 30d para netrin_cache + enrichment_jobs/calls; mark orphan
-- running jobs as failed after 15 minutes.
-- ============================================================================

create or replace function public.purge_netrin_cache()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.netrin_cache where expires_at < now();
end;
$$;

create or replace function public.purge_old_enrichment_jobs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.enrichment_jobs
  where status in ('completed','failed','partial')
    and finished_at < now() - interval '30 days';
end;
$$;

create or replace function public.fail_orphan_enrichment_jobs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.enrichment_jobs
  set status = 'failed',
      finished_at = now(),
      error = coalesce(error, 'orphaned: edge function did not finish within 15m')
  where status in ('pending','running')
    and started_at < now() - interval '15 minutes';
end;
$$;

select cron.schedule(
  'purge-netrin-cache-daily',
  '15 3 * * *',
  $$select public.purge_netrin_cache();$$
);

select cron.schedule(
  'purge-old-enrichment-jobs-daily',
  '20 3 * * *',
  $$select public.purge_old_enrichment_jobs();$$
);

select cron.schedule(
  'fail-orphan-enrichment-jobs',
  '*/5 * * * *',
  $$select public.fail_orphan_enrichment_jobs();$$
);
```

- [ ] **Step 2: Aplicar + verificar cron**

Run: `pnpm exec supabase db reset`
Run: `psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" -c "select jobname from cron.job where jobname like '%enrichment%' or jobname like '%netrin%';"`
Expected: 3 jobs listados.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260526100400_enrichment_retention.sql
git commit -m "feat(netrin): pg_cron retention + orphan job recovery"
```

---

### Task A6: Estender `lib/supabase/types.ts`

**Files:**
- Modify: `lib/supabase/types.ts`

- [ ] **Step 1: Adicionar tipos das novas tabelas**

Adicione, dentro de `Tables: { ... }`, ao final (antes do fechamento do bloco):

```ts
      netrin_cache: {
        Row: {
          document_hash: string;
          document_type: 'cpf' | 'cnpj';
          encrypted_payload: string;
          slugs_fetched: string[];
          fetched_at: string;
          expires_at: string;
        };
        Insert: {
          document_hash: string;
          document_type: 'cpf' | 'cnpj';
          encrypted_payload: string;
          slugs_fetched: string[];
          fetched_at?: string;
          expires_at?: string;
        };
        Update: {
          document_hash?: string;
          document_type?: 'cpf' | 'cnpj';
          encrypted_payload?: string;
          slugs_fetched?: string[];
          fetched_at?: string;
          expires_at?: string;
        };
      };
      enrichment_jobs: {
        Row: {
          id: string;
          user_id: string;
          root_hash: string;
          root_type: 'cpf' | 'cnpj';
          status: 'pending' | 'running' | 'completed' | 'partial' | 'failed';
          hop1_status: 'success' | 'error' | 'cache_hit' | 'skipped' | null;
          hop2_total: number;
          hop2_done: number;
          hop3_total: number;
          hop3_done: number;
          started_at: string;
          finished_at: string | null;
          error: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          root_hash: string;
          root_type: 'cpf' | 'cnpj';
          status: 'pending' | 'running' | 'completed' | 'partial' | 'failed';
          hop1_status?: 'success' | 'error' | 'cache_hit' | 'skipped' | null;
          hop2_total?: number;
          hop2_done?: number;
          hop3_total?: number;
          hop3_done?: number;
          started_at?: string;
          finished_at?: string | null;
          error?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          root_hash?: string;
          root_type?: 'cpf' | 'cnpj';
          status?: 'pending' | 'running' | 'completed' | 'partial' | 'failed';
          hop1_status?: 'success' | 'error' | 'cache_hit' | 'skipped' | null;
          hop2_total?: number;
          hop2_done?: number;
          hop3_total?: number;
          hop3_done?: number;
          started_at?: string;
          finished_at?: string | null;
          error?: string | null;
        };
      };
      enrichment_job_calls: {
        Row: {
          id: string;
          job_id: string;
          hop: 1 | 2 | 3;
          document_hash: string;
          document_type: 'cpf' | 'cnpj';
          slugs: string[];
          status: 'pending' | 'running' | 'success' | 'error' | 'cache_hit';
          cached: boolean;
          fetched_at: string | null;
          error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          job_id: string;
          hop: 1 | 2 | 3;
          document_hash: string;
          document_type: 'cpf' | 'cnpj';
          slugs: string[];
          status: 'pending' | 'running' | 'success' | 'error' | 'cache_hit';
          cached?: boolean;
          fetched_at?: string | null;
          error?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          job_id?: string;
          hop?: 1 | 2 | 3;
          document_hash?: string;
          document_type?: 'cpf' | 'cnpj';
          slugs?: string[];
          status?: 'pending' | 'running' | 'success' | 'error' | 'cache_hit';
          cached?: boolean;
          fetched_at?: string | null;
          error?: string | null;
          created_at?: string;
        };
      };
```

Ajuste também `audit_log` (`Row.action` e `Insert.action` e `Update.action`) adicionando `'enrichment_call'` ao union string. Ex.:

```ts
action: 'login' | 'logout' | 'search_single' | 'search_bulk_item'
      | 'bulk_job_created' | 'export_csv' | 'admin_user_created'
      | 'admin_user_set_active' | 'admin_user_set_role'
      | 'admin_user_permission_changed' | 'view_network'
      | 'expand_network_node' | 'enrichment_call';
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: 0 erros.

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/types.ts
git commit -m "feat(netrin): extend Database types for cache + jobs + audit action"
```

---

### Task A7: Variáveis de ambiente

**Files:**
- Modify: `.env.local.example`
- Modify: `.env.local` (local only — não commitar)

- [ ] **Step 1: Adicionar bloco Netrin em `.env.local.example`**

Append ao final:

```bash

# =====================================================
# Netrin API (consulta-composta)
# =====================================================
NETRIN_BASE_URL=https://api.netrin.com.br
NETRIN_TOKEN=your_static_token_here
NETRIN_PEP_ACURACIA=95
```

- [ ] **Step 2: Atualizar `.env.local` do dev local com o token real**

Manual: editar `.env.local` adicionando as 3 variáveis. **Não commitar.**

- [ ] **Step 3: Commit do exemplo**

```bash
git add .env.local.example
git commit -m "chore(env): document Netrin env vars in .env.local.example"
```

---

## Fase B — Cliente Netrin (lib/netrin)

### Task B1: `lib/netrin/types.ts`

**Files:**
- Create: `lib/netrin/types.ts`

- [ ] **Step 1: Criar arquivo de tipos**

```ts
// lib/netrin/types.ts

export type NetrinDocumentType = 'cpf' | 'cnpj';

// Vocabulary fechado dos slugs que efetivamente usamos no antifraude.
export const HOP1_SLUGS = [
  'esp-cpf',
  'receita-federal-cpf',
  'pep-kyc-cpf',
  'midias-consolidado',
  'processos-cpf',
  'empresas-relacionadas-cpf',
  'pessoas-impedidas-apostar',
] as const;

export const HOP2_SLUGS = [
  'esp-cnpj-completo',
  'receita-federal-cnpj',
  'receita-federal-cnpj-qsa',
  'informacoes-socios-pj',
  'pessoas-relacionadas-cnpj',
  'pep-kyc-cnpj',
  'midias-consolidado',
  'processos-cnpj',
  'portal-transparencia-ceis',
  'portal-transparencia-cnep',
  'trabalho-escravo',
] as const;

export const HOP3_SLUGS = [
  'esp-cpf',
  'pep-kyc-cpf',
  'midias-consolidado',
  'processos-cpf',
  'empresas-relacionadas-cpf',
] as const;

export type NetrinSlug =
  | (typeof HOP1_SLUGS)[number]
  | (typeof HOP2_SLUGS)[number]
  | (typeof HOP3_SLUGS)[number];

// Shape do payload da consulta-composta: 1 chave por slug consultado, com
// o conteúdo bruto. Tratamos como `unknown` aqui — parsers em lib/netrin/parsers
// fazem extração tipada por slug.
export type NetrinCompositePayload = Partial<Record<NetrinSlug, unknown>>;

export class NetrinError extends Error {
  readonly status: number | undefined;
  readonly slugs: readonly NetrinSlug[];
  constructor(message: string, opts: { status?: number; slugs: readonly NetrinSlug[] }) {
    super(message);
    this.name = 'NetrinError';
    this.status = opts.status;
    this.slugs = opts.slugs;
  }
}

export type NetrinClientConfig = {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  initialBackoffMs?: number;
  /** Default 95. Aplicado ao slug pep-kyc-* via `&acuracia=`. */
  pepAcuracia?: number;
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: 0 erros.

- [ ] **Step 3: Commit**

```bash
git add lib/netrin/types.ts
git commit -m "feat(netrin): add shared types + slug vocab"
```

---

### Task B2: `lib/netrin/client.ts` (TDD)

**Files:**
- Create: `lib/netrin/client.test.ts`
- Create: `lib/netrin/client.ts`

- [ ] **Step 1: Escrever o teste falho**

```ts
// lib/netrin/client.test.ts
import { describe, expect, it, vi } from 'vitest';
import { NetrinClient } from './client';
import { HOP1_SLUGS, NetrinError } from './types';

function makeFetch(handler: (url: string) => Promise<Response> | Response) {
  return vi.fn(async (url: string | URL) => handler(url.toString()));
}

describe('NetrinClient.fetchComposta', () => {
  it('builds the URL with token, document and multiple s= params', async () => {
    let capturedUrl = '';
    const fetchImpl = makeFetch((url) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ 'esp-cpf': { ok: true } }), { status: 200 });
    });
    const client = new NetrinClient({
      baseUrl: 'https://api.netrin.com.br',
      token: 'TKN',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await client.fetchComposta('cpf', '12345678909', ['esp-cpf', 'pep-kyc-cpf']);

    expect(capturedUrl).toContain('https://api.netrin.com.br/v1/consulta-composta?');
    expect(capturedUrl).toContain('token=TKN');
    expect(capturedUrl).toContain('cpf=12345678909');
    expect(capturedUrl).toMatch(/s=esp-cpf/);
    expect(capturedUrl).toMatch(/s=pep-kyc-cpf/);
  });

  it('routes cnpj documents with cnpj= query param', async () => {
    let capturedUrl = '';
    const fetchImpl = makeFetch((url) => {
      capturedUrl = url;
      return new Response('{}', { status: 200 });
    });
    const client = new NetrinClient({
      baseUrl: 'https://api.netrin.com.br',
      token: 'TKN',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await client.fetchComposta('cnpj', '12345678000199', ['esp-cnpj-completo']);

    expect(capturedUrl).toContain('cnpj=12345678000199');
    expect(capturedUrl).not.toContain('cpf=');
  });

  it('appends acuracia when pep-kyc-* is in the slug set', async () => {
    let capturedUrl = '';
    const fetchImpl = makeFetch((url) => {
      capturedUrl = url;
      return new Response('{}', { status: 200 });
    });
    const client = new NetrinClient({
      baseUrl: 'https://api.netrin.com.br',
      token: 'TKN',
      pepAcuracia: 90,
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await client.fetchComposta('cpf', '12345678909', ['pep-kyc-cpf']);

    expect(capturedUrl).toContain('acuracia=90');
  });

  it('retries 5xx with exponential backoff and surfaces success', async () => {
    let attempt = 0;
    const fetchImpl = makeFetch(() => {
      attempt++;
      if (attempt < 3) return new Response('upstream', { status: 502 });
      return new Response(JSON.stringify({ 'esp-cpf': { ok: true } }), { status: 200 });
    });
    const sleepCalls: number[] = [];
    const client = new NetrinClient({
      baseUrl: 'https://api.netrin.com.br',
      token: 'TKN',
      fetch: fetchImpl as unknown as typeof fetch,
      sleep: async (ms) => { sleepCalls.push(ms); },
      initialBackoffMs: 10,
    });

    const result = await client.fetchComposta('cpf', '12345678909', ['esp-cpf']);

    expect(attempt).toBe(3);
    expect(sleepCalls).toEqual([10, 20]);
    expect(result['esp-cpf']).toEqual({ ok: true });
  });

  it('throws NetrinError after maxRetries 5xx failures', async () => {
    const fetchImpl = makeFetch(() => new Response('boom', { status: 503 }));
    const client = new NetrinClient({
      baseUrl: 'https://api.netrin.com.br',
      token: 'TKN',
      fetch: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      maxRetries: 2,
      initialBackoffMs: 1,
    });

    await expect(
      client.fetchComposta('cpf', '12345678909', ['esp-cpf']),
    ).rejects.toBeInstanceOf(NetrinError);
  });

  it('throws immediately on 401', async () => {
    const fetchImpl = makeFetch(() => new Response('nope', { status: 401 }));
    const client = new NetrinClient({
      baseUrl: 'https://api.netrin.com.br',
      token: 'TKN',
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      client.fetchComposta('cpf', '12345678909', ['esp-cpf']),
    ).rejects.toMatchObject({ name: 'NetrinError', status: 401 });
  });

  it('never leaks the token in error messages', async () => {
    const fetchImpl = makeFetch(() => new Response('nope', { status: 401 }));
    const client = new NetrinClient({
      baseUrl: 'https://api.netrin.com.br',
      token: 'SUPER-SECRET-TKN',
      fetch: fetchImpl as unknown as typeof fetch,
    });
    let err: Error | undefined;
    try {
      await client.fetchComposta('cpf', '12345678909', ['esp-cpf']);
    } catch (e) { err = e as Error; }
    expect(err?.message ?? '').not.toContain('SUPER-SECRET-TKN');
  });

  it('typechecks against the full HOP1 slug list', async () => {
    const fetchImpl = makeFetch(() => new Response('{}', { status: 200 }));
    const client = new NetrinClient({
      baseUrl: 'https://api.netrin.com.br',
      token: 'TKN',
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.fetchComposta('cpf', '12345678909', [...HOP1_SLUGS])).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Rodar para confirmar vermelho**

Run: `pnpm test -- lib/netrin/client`
Expected: `Cannot find module './client'`.

- [ ] **Step 3: Implementar `lib/netrin/client.ts`**

```ts
// lib/netrin/client.ts
import {
  type NetrinClientConfig,
  type NetrinCompositePayload,
  type NetrinDocumentType,
  NetrinError,
  type NetrinSlug,
} from './types';

const COMPOSITE_PATH = '/v1/consulta-composta';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 1000;
const DEFAULT_PEP_ACURACIA = 95;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export class NetrinClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly pepAcuracia: number;

  constructor(config: NetrinClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.token = config.token;
    this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = config.sleep ?? defaultSleep;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.initialBackoffMs = config.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.pepAcuracia = config.pepAcuracia ?? DEFAULT_PEP_ACURACIA;
  }

  async fetchComposta(
    docType: NetrinDocumentType,
    documentRaw: string,
    slugs: readonly NetrinSlug[],
  ): Promise<NetrinCompositePayload> {
    if (slugs.length === 0) {
      throw new NetrinError('fetchComposta requires at least 1 slug', { slugs });
    }

    const url = this.buildUrl(docType, documentRaw, slugs);
    let attempt = 0;
    while (true) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, { method: 'GET' });
      } catch (cause) {
        if (attempt >= this.maxRetries) {
          throw new NetrinError(
            `network error after ${attempt} retries: ${(cause as Error).message}`,
            { slugs },
          );
        }
        await this.sleep(this.backoffFor(attempt));
        attempt += 1;
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw new NetrinError(`netrin auth failed (${response.status})`, {
          status: response.status,
          slugs,
        });
      }

      if (response.ok) {
        const body = await safeReadJson(response);
        return (body ?? {}) as NetrinCompositePayload;
      }

      if (response.status >= 500) {
        if (attempt >= this.maxRetries) {
          throw new NetrinError(
            `netrin upstream ${response.status} after ${this.maxRetries} retries`,
            { status: response.status, slugs },
          );
        }
        await this.sleep(this.backoffFor(attempt));
        attempt += 1;
        continue;
      }

      throw new NetrinError(`netrin client error ${response.status}`, {
        status: response.status,
        slugs,
      });
    }
  }

  private buildUrl(
    docType: NetrinDocumentType,
    documentRaw: string,
    slugs: readonly NetrinSlug[],
  ): string {
    const params = new URLSearchParams();
    params.set('token', this.token);
    params.set(docType, documentRaw);
    for (const slug of slugs) params.append('s', slug);
    if (slugs.some((s) => s.startsWith('pep-kyc-'))) {
      params.set('acuracia', String(this.pepAcuracia));
    }
    return `${this.baseUrl}${COMPOSITE_PATH}?${params.toString()}`;
  }

  private backoffFor(attempt: number): number {
    return this.initialBackoffMs * 2 ** attempt;
  }
}

async function safeReadJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
```

- [ ] **Step 4: Rodar testes — verde**

Run: `pnpm test -- lib/netrin/client`
Expected: all pass.

- [ ] **Step 5: Lint + typecheck**

Run: `pnpm lint:fix && pnpm typecheck`
Expected: 0 erros.

- [ ] **Step 6: Commit**

```bash
git add lib/netrin/client.ts lib/netrin/client.test.ts
git commit -m "feat(netrin): consulta-composta client with retries + token isolation"
```

---

### Task B3: `lib/netrin/cache.ts` (TDD)

**Files:**
- Create: `lib/netrin/cache.test.ts`
- Create: `lib/netrin/cache.ts`
- Modify: `lib/crypto/vault.ts` (adicionar helper `encryptNetrinText` / `decryptNetrinText`)

- [ ] **Step 1: Adicionar helpers em `lib/crypto/vault.ts`**

Read the current file and append two new exported functions:

```ts
// Append to lib/crypto/vault.ts

export async function encryptNetrinText(
  client: SupabaseClient<Database>,
  plaintext: string,
): Promise<string> {
  const { data, error } = await client.rpc('encrypt_netrin' as never, { plaintext } as never);
  if (error) throw new Error(`encrypt_netrin RPC failed: ${error.message}`);
  if (typeof data !== 'string') throw new Error('encrypt_netrin returned non-string');
  return data;
}

export async function decryptNetrinText(
  client: SupabaseClient<Database>,
  ciphertext: string,
): Promise<string> {
  const { data, error } = await client.rpc('decrypt_netrin' as never, { ciphertext } as never);
  if (error) throw new Error(`decrypt_netrin RPC failed: ${error.message}`);
  if (typeof data !== 'string') throw new Error('decrypt_netrin returned non-string');
  return data;
}
```

- [ ] **Step 2: Escrever testes de cache**

```ts
// lib/netrin/cache.test.ts
import { describe, expect, it, vi } from 'vitest';
import { getNetrinCache, setNetrinCache, NETRIN_CACHE_TTL_DAYS } from './cache';
import type { NetrinCompositePayload } from './types';

function fakeClient(opts: {
  selectRow?: { encrypted_payload: string; slugs_fetched: string[]; fetched_at: string } | null;
  encryptReturns?: string;
  upsertSpy?: (row: unknown) => void;
}) {
  return {
    from(table: string) {
      if (table !== 'netrin_cache') throw new Error(`unexpected from(${table})`);
      return {
        select() {
          return {
            eq() {
              return {
                gt() {
                  return {
                    maybeSingle() {
                      return {
                        returns<T>() {
                          return Promise.resolve({ data: opts.selectRow as T | null, error: null });
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
        upsert(row: unknown) {
          opts.upsertSpy?.(row);
          return Promise.resolve({ error: null });
        },
      };
    },
    rpc(name: string, args: { plaintext?: string; ciphertext?: string }) {
      if (name === 'encrypt_netrin') return Promise.resolve({ data: opts.encryptReturns ?? `enc(${args.plaintext})`, error: null });
      if (name === 'decrypt_netrin') return Promise.resolve({ data: (args.ciphertext ?? '').replace(/^enc\(/, '').replace(/\)$/, ''), error: null });
      throw new Error(`unexpected rpc ${name}`);
    },
  } as never;
}

describe('netrin cache', () => {
  it('returns null on cache miss', async () => {
    const client = fakeClient({ selectRow: null });
    const result = await getNetrinCache(client, 'cpf:abc');
    expect(result).toBeNull();
  });

  it('decrypts payload on hit', async () => {
    const payload: NetrinCompositePayload = { 'esp-cpf': { ok: true } };
    const client = fakeClient({
      selectRow: {
        encrypted_payload: `enc(${JSON.stringify(payload)})`,
        slugs_fetched: ['esp-cpf'],
        fetched_at: '2026-05-26T00:00:00Z',
      },
    });
    const result = await getNetrinCache(client, 'cpf:abc');
    expect(result).not.toBeNull();
    expect(result?.payload).toEqual(payload);
    expect(result?.slugsFetched).toEqual(['esp-cpf']);
    expect(result?.fetchedAt).toBe('2026-05-26T00:00:00Z');
  });

  it('encrypts and upserts on set', async () => {
    let captured: { document_hash?: string; encrypted_payload?: string; slugs_fetched?: string[]; expires_at?: string } = {};
    const client = fakeClient({ upsertSpy: (row) => { captured = row as typeof captured; } });
    const payload: NetrinCompositePayload = { 'esp-cpf': { ok: true } };

    await setNetrinCache(client, 'cpf:abc', 'cpf', ['esp-cpf'], payload);

    expect(captured.document_hash).toBe('cpf:abc');
    expect(captured.encrypted_payload).toContain('esp-cpf');
    expect(captured.slugs_fetched).toEqual(['esp-cpf']);
    expect(new Date(captured.expires_at as string).getTime())
      .toBeGreaterThan(Date.now() + (NETRIN_CACHE_TTL_DAYS - 1) * 86400000);
  });
});
```

- [ ] **Step 3: Rodar — vermelho**

Run: `pnpm test -- lib/netrin/cache`
Expected: `Cannot find module './cache'`.

- [ ] **Step 4: Implementar**

```ts
// lib/netrin/cache.ts
import { decryptNetrinText, encryptNetrinText } from '@/lib/crypto/vault';
import type { Database } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NetrinCompositePayload, NetrinDocumentType } from './types';

export const NETRIN_CACHE_TTL_DAYS = 30;

export type NetrinCacheHit = {
  payload: NetrinCompositePayload;
  slugsFetched: string[];
  fetchedAt: string;
};

type SelectRow = {
  encrypted_payload: string;
  slugs_fetched: string[];
  fetched_at: string;
};

export async function getNetrinCache(
  client: SupabaseClient<Database>,
  documentHash: string,
): Promise<NetrinCacheHit | null> {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from('netrin_cache')
    .select('encrypted_payload, slugs_fetched, fetched_at')
    .eq('document_hash', documentHash)
    .gt('expires_at', now)
    .maybeSingle()
    .returns<SelectRow>();
  if (error) throw new Error(`getNetrinCache failed: ${error.message}`);
  if (!data) return null;

  const plaintext = await decryptNetrinText(client, data.encrypted_payload);
  return {
    payload: JSON.parse(plaintext) as NetrinCompositePayload,
    slugsFetched: data.slugs_fetched,
    fetchedAt: data.fetched_at,
  };
}

export async function setNetrinCache(
  client: SupabaseClient<Database>,
  documentHash: string,
  documentType: NetrinDocumentType,
  slugsFetched: string[],
  payload: NetrinCompositePayload,
): Promise<void> {
  const ciphertext = await encryptNetrinText(client, JSON.stringify(payload));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + NETRIN_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const { error } = await client.from('netrin_cache').upsert({
    document_hash: documentHash,
    document_type: documentType,
    encrypted_payload: ciphertext,
    slugs_fetched: slugsFetched,
    fetched_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  } as never);
  if (error) throw new Error(`setNetrinCache failed: ${error.message}`);
}
```

- [ ] **Step 5: Rodar — verde**

Run: `pnpm test -- lib/netrin/cache`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/netrin/cache.ts lib/netrin/cache.test.ts lib/crypto/vault.ts
git commit -m "feat(netrin): encrypted cache helpers (netrin_cache_key)"
```

---

### Task B4: `lib/netrin/server-client.ts`

**Files:**
- Create: `lib/netrin/server-client.ts`

- [ ] **Step 1: Implementar factory (sem teste — wiring)**

```ts
// lib/netrin/server-client.ts
import { NetrinClient } from './client';

const REQUIRED_ENV = ['NETRIN_BASE_URL', 'NETRIN_TOKEN'] as const;

function readEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) throw new Error(`missing env: ${name}`);
  return v;
}

export function createServerNetrinClient(): NetrinClient {
  for (const k of REQUIRED_ENV) readEnv(k);
  const acuraciaRaw = process.env.NETRIN_PEP_ACURACIA;
  const pepAcuracia = acuraciaRaw ? Number.parseInt(acuraciaRaw, 10) : undefined;
  return new NetrinClient({
    baseUrl: readEnv('NETRIN_BASE_URL'),
    token: readEnv('NETRIN_TOKEN'),
    pepAcuracia: Number.isFinite(pepAcuracia) ? pepAcuracia : undefined,
  });
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint:fix`

- [ ] **Step 3: Commit**

```bash
git add lib/netrin/server-client.ts
git commit -m "feat(netrin): server-side client factory (reads env)"
```

---

## Fase C — Pivot parsers

Os parsers focados extraem só os pivots necessários para expandir os hops (CNPJs do Hop 1, CPFs do Hop 2). O conteúdo bruto de cada slug fica em `NetrinCompositePayload` e os componentes da UI consomem com tipagem inline.

### Task C1: `lib/netrin/parsers/pivot-cnpjs.ts` (TDD)

**Files:**
- Create: `lib/netrin/parsers/pivot-cnpjs.test.ts`
- Create: `lib/netrin/parsers/pivot-cnpjs.ts`

- [ ] **Step 1: Escrever teste**

```ts
// lib/netrin/parsers/pivot-cnpjs.test.ts
import { describe, expect, it } from 'vitest';
import { extractPivotCnpjs } from './pivot-cnpjs';

describe('extractPivotCnpjs', () => {
  it('returns empty when slug missing', () => {
    expect(extractPivotCnpjs({})).toEqual([]);
  });

  it('returns digits-only CNPJs from negociosRelacionados[]', () => {
    const payload = {
      'empresas-relacionadas-cpf': {
        negociosRelacionados: [
          { cnpj: '12.345.678/0001-90', tipoVinculo: 'OWNERSHIP' },
          { cnpj: '98765432000110', tipoVinculo: 'DIRECT' },
          { cnpj: 'lixo', tipoVinculo: 'DIRECT' },
        ],
      },
    };
    expect(extractPivotCnpjs(payload)).toEqual(['12345678000190', '98765432000110']);
  });

  it('deduplicates CNPJs', () => {
    const payload = {
      'empresas-relacionadas-cpf': {
        negociosRelacionados: [
          { cnpj: '12345678000190' },
          { cnpj: '12.345.678/0001-90' },
        ],
      },
    };
    expect(extractPivotCnpjs(payload)).toEqual(['12345678000190']);
  });

  it('handles missing or non-array shape gracefully', () => {
    expect(extractPivotCnpjs({ 'empresas-relacionadas-cpf': null })).toEqual([]);
    expect(extractPivotCnpjs({ 'empresas-relacionadas-cpf': { negociosRelacionados: 'nope' } })).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar — vermelho**

Run: `pnpm test -- lib/netrin/parsers/pivot-cnpjs`
Expected: `Cannot find module`.

- [ ] **Step 3: Implementar**

```ts
// lib/netrin/parsers/pivot-cnpjs.ts
import type { NetrinCompositePayload } from '@/lib/netrin/types';

type Negocio = { cnpj?: unknown };

export function extractPivotCnpjs(payload: NetrinCompositePayload): string[] {
  const slug = payload['empresas-relacionadas-cpf'] as
    | { negociosRelacionados?: unknown }
    | null
    | undefined;
  const list = slug?.negociosRelacionados;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list as Negocio[]) {
    const raw = typeof item?.cnpj === 'string' ? item.cnpj.replace(/\D/g, '') : '';
    if (raw.length !== 14) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}
```

- [ ] **Step 4: Verde + commit**

Run: `pnpm test -- lib/netrin/parsers/pivot-cnpjs`
Then:
```bash
git add lib/netrin/parsers/pivot-cnpjs.ts lib/netrin/parsers/pivot-cnpjs.test.ts
git commit -m "feat(netrin): pivot CNPJ extractor from empresas-relacionadas-cpf"
```

---

### Task C2: `lib/netrin/parsers/pivot-cpfs.ts` (TDD)

**Files:**
- Create: `lib/netrin/parsers/pivot-cpfs.test.ts`
- Create: `lib/netrin/parsers/pivot-cpfs.ts`

- [ ] **Step 1: Teste**

```ts
// lib/netrin/parsers/pivot-cpfs.test.ts
import { describe, expect, it } from 'vitest';
import { extractPivotCpfs } from './pivot-cpfs';

describe('extractPivotCpfs', () => {
  it('returns empty when slug missing', () => {
    expect(extractPivotCpfs({})).toEqual([]);
  });

  it('extracts CPFs from entidadesRelacionadas[] keeping vinculo', () => {
    const payload = {
      'pessoas-relacionadas-cnpj': {
        entidadesRelacionadas: [
          {
            cpf: '123.456.789-09',
            vinculoDoRelacionamento: 'SOCIO-ADMINISTRADOR',
            dataInicioRelacionamento: '2020-01-01',
            dataFimRelacionamento: '9999-12-31',
            percentualParticipacaoSociedade: 50,
          },
          {
            cpf: '98765432100',
            vinculoDoRelacionamento: 'SOCIO',
            dataInicioRelacionamento: '2018-06-01',
            dataFimRelacionamento: '2021-09-01',
          },
        ],
      },
    };
    const result = extractPivotCpfs(payload);
    expect(result).toEqual([
      {
        cpf: '12345678909',
        vinculo: 'SOCIO-ADMINISTRADOR',
        dataInicio: '2020-01-01',
        dataFim: '9999-12-31',
        percentualParticipacao: 50,
        ativo: true,
      },
      {
        cpf: '98765432100',
        vinculo: 'SOCIO',
        dataInicio: '2018-06-01',
        dataFim: '2021-09-01',
        percentualParticipacao: undefined,
        ativo: false,
      },
    ]);
  });

  it('dedupes by CPF, keeping first occurrence', () => {
    const payload = {
      'pessoas-relacionadas-cnpj': {
        entidadesRelacionadas: [
          { cpf: '12345678909', vinculoDoRelacionamento: 'SOCIO' },
          { cpf: '123.456.789-09', vinculoDoRelacionamento: 'OUTRO' },
        ],
      },
    };
    expect(extractPivotCpfs(payload).map((r) => r.vinculo)).toEqual(['SOCIO']);
  });
});
```

- [ ] **Step 2: Verde após implementação**

```ts
// lib/netrin/parsers/pivot-cpfs.ts
import type { NetrinCompositePayload } from '@/lib/netrin/types';

export type PivotCpf = {
  cpf: string;
  vinculo: string;
  dataInicio?: string;
  dataFim?: string;
  percentualParticipacao?: number;
  ativo: boolean;
};

type Entidade = {
  cpf?: unknown;
  vinculoDoRelacionamento?: unknown;
  dataInicioRelacionamento?: unknown;
  dataFimRelacionamento?: unknown;
  percentualParticipacaoSociedade?: unknown;
};

export function extractPivotCpfs(payload: NetrinCompositePayload): PivotCpf[] {
  const slug = payload['pessoas-relacionadas-cnpj'] as
    | { entidadesRelacionadas?: unknown }
    | null
    | undefined;
  const list = slug?.entidadesRelacionadas;
  if (!Array.isArray(list)) return [];

  const seen = new Set<string>();
  const out: PivotCpf[] = [];
  for (const itemUnknown of list as Entidade[]) {
    const item = itemUnknown;
    const cpfRaw = typeof item?.cpf === 'string' ? item.cpf.replace(/\D/g, '') : '';
    if (cpfRaw.length !== 11) continue;
    if (seen.has(cpfRaw)) continue;
    seen.add(cpfRaw);

    const vinculo = typeof item.vinculoDoRelacionamento === 'string'
      ? item.vinculoDoRelacionamento
      : 'INDEFINIDO';
    const dataInicio = typeof item.dataInicioRelacionamento === 'string'
      ? item.dataInicioRelacionamento : undefined;
    const dataFim = typeof item.dataFimRelacionamento === 'string'
      ? item.dataFimRelacionamento : undefined;
    const pct = typeof item.percentualParticipacaoSociedade === 'number'
      ? item.percentualParticipacaoSociedade : undefined;
    const ativo = !dataFim || dataFim === '9999-12-31';

    out.push({ cpf: cpfRaw, vinculo, dataInicio, dataFim, percentualParticipacao: pct, ativo });
  }
  return out;
}
```

- [ ] **Step 3: Commit**

```bash
pnpm test -- lib/netrin/parsers/pivot-cpfs
git add lib/netrin/parsers/pivot-cpfs.ts lib/netrin/parsers/pivot-cpfs.test.ts
git commit -m "feat(netrin): pivot CPF extractor from pessoas-relacionadas-cnpj"
```

---

## Fase D — Hops & Graph bridge

### Task D1: Estender `lib/graph/types.ts` com `corporate_relation`

**Files:**
- Modify: `lib/graph/types.ts`

- [ ] **Step 1: Editar tipos**

Substituir a definição de `EdgeKind`, `ExtractedEdge`, `StoredEdgeEvidence`:

```ts
// lib/graph/types.ts (overwrite)

import type { PredictusProcess } from '@/lib/predictus/types';

export type NodeType = 'cpf' | 'cnpj' | 'lawyer';

export type EdgeKind = 'co_party' | 'client_lawyer' | 'lawyer_lawyer' | 'corporate_relation';

export type GraphNodeLabel = {
  name?: string;
  document?: string;
  oab?: { uf: string; numero: string };
};

export type ExtractedNode = {
  nodeHash: string;
  nodeType: NodeType;
  label: GraphNodeLabel;
  maskedPreview: string;
};

export type ProcessEdgeEvidence = {
  processNumber: string;
  samePolo: boolean | null;
};

export type CorporateEdgeEvidence = {
  vinculo: string;
  percentualParticipacao?: number;
  dataInicioRelacionamento?: string;
  dataFimRelacionamento?: string;
  source: 'empresas-relacionadas-cpf' | 'pessoas-relacionadas-cnpj';
};

export type ExtractedEdge =
  | {
      sourceHash: string;
      targetHash: string;
      kind: 'co_party' | 'client_lawyer' | 'lawyer_lawyer';
      evidence: ProcessEdgeEvidence;
    }
  | {
      sourceHash: string;
      targetHash: string;
      kind: 'corporate_relation';
      evidence: CorporateEdgeEvidence;
    };

export type ExtractedGraph = {
  nodes: ExtractedNode[];
  edges: ExtractedEdge[];
};

export type StoredEdgeEvidence =
  | { processNumbers: string[]; samePolo: boolean | null; occurrences: number }
  | CorporateEdgeEvidence;

export type ExtractGraphInput = {
  payload: PredictusProcess[];
  searchedHash: string;
};
```

- [ ] **Step 2: Atualizar `lib/graph/writer.ts` pra serializar evidence corporate**

Substitua o bloco `edges_in = edges.map(...)`:

```ts
  const edges_in = edges.map((e) => {
    if (e.kind === 'corporate_relation') {
      return {
        source_hash: e.sourceHash,
        target_hash: e.targetHash,
        kind: e.kind,
        evidence: e.evidence,
      };
    }
    return {
      source_hash: e.sourceHash,
      target_hash: e.targetHash,
      kind: e.kind,
      process_number: e.evidence.processNumber,
      same_polo: e.evidence.samePolo,
    };
  });
```

- [ ] **Step 3: Atualizar `lib/graph/writer.test.ts` se necessário e rodar a suíte**

Run: `pnpm test -- lib/graph`
Expected: tudo verde. Se algum teste quebrar pelo tipo de union, ajustar fixtures pra incluir `evidence: { processNumber, samePolo }` explicitamente.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: 0 erros.

- [ ] **Step 5: Commit**

```bash
git add lib/graph/types.ts lib/graph/writer.ts lib/graph/extractor.ts lib/graph/extractor.test.ts lib/graph/writer.test.ts
git commit -m "feat(graph): add corporate_relation edge kind + polymorphic evidence"
```

(Se `extractor.ts` ou seus testes não tiveram mudança, omita-os do `git add`.)

---

### Task D2: `lib/netrin/graph-bridge.ts` (TDD)

**Files:**
- Create: `lib/netrin/graph-bridge.test.ts`
- Create: `lib/netrin/graph-bridge.ts`

Função: dado o conjunto de calls do job (root CPF + N CNPJs + M CPFs), construir um `ExtractedGraph` com:
- Nó CPF root (já existe via Predictus, mas reconfirma).
- Para cada negócio em `empresas-relacionadas-cpf.negociosRelacionados[]`: nó CNPJ + edge `corporate_relation`.
- Para cada entidade em `pessoas-relacionadas-cnpj.entidadesRelacionadas[]`: nó CPF sócio + edge `corporate_relation`.

- [ ] **Step 1: Escrever testes**

```ts
// lib/netrin/graph-bridge.test.ts
import { describe, expect, it } from 'vitest';
import { buildNetrinGraph } from './graph-bridge';

describe('buildNetrinGraph', () => {
  it('emits corporate edges from CPF root → CNPJs', () => {
    const result = buildNetrinGraph({
      rootDocument: { type: 'cpf', raw: '12345678909', name: 'JOAO' },
      hop1Payload: {
        'esp-cpf': { nome: 'JOAO' },
        'empresas-relacionadas-cpf': {
          negociosRelacionados: [
            { cnpj: '12345678000190', razaoSocial: 'ACME LTDA', tipoVinculo: 'OWNERSHIP',
              dataInicioRelacionamento: '2020-01-01', dataFimRelacionamento: '9999-12-31',
              percentualParticipacao: 100 },
          ],
        },
      },
      hop2Payloads: {},
    });

    const cnpjNode = result.nodes.find((n) => n.nodeType === 'cnpj');
    expect(cnpjNode).toBeTruthy();
    expect(cnpjNode?.label.document).toBe('12345678000190');

    const corp = result.edges.filter((e) => e.kind === 'corporate_relation');
    expect(corp).toHaveLength(1);
    expect(corp[0]?.evidence).toMatchObject({
      vinculo: 'OWNERSHIP',
      source: 'empresas-relacionadas-cpf',
      percentualParticipacao: 100,
    });
  });

  it('emits CNPJ → CPF socio edges from Hop 2 payloads', () => {
    const result = buildNetrinGraph({
      rootDocument: { type: 'cpf', raw: '12345678909', name: 'JOAO' },
      hop1Payload: {
        'empresas-relacionadas-cpf': {
          negociosRelacionados: [{ cnpj: '12345678000190', razaoSocial: 'ACME' }],
        },
      },
      hop2Payloads: {
        '12345678000190': {
          'esp-cnpj-completo': { razaoSocial: 'ACME' },
          'pessoas-relacionadas-cnpj': {
            entidadesRelacionadas: [
              { cpf: '98765432100', nome: 'MARIA', vinculoDoRelacionamento: 'SOCIO',
                dataInicioRelacionamento: '2020-01-01', dataFimRelacionamento: '9999-12-31' },
            ],
          },
        },
      },
    });

    const mariaNode = result.nodes.find((n) => n.label.document === '98765432100');
    expect(mariaNode?.nodeType).toBe('cpf');

    const corpEdges = result.edges.filter((e) => e.kind === 'corporate_relation');
    expect(corpEdges).toHaveLength(2);
    const cnpjToCpf = corpEdges.find((e) => e.evidence.source === 'pessoas-relacionadas-cnpj');
    expect(cnpjToCpf?.evidence.vinculo).toBe('SOCIO');
  });

  it('omits malformed cnpj/cpf rows silently', () => {
    const result = buildNetrinGraph({
      rootDocument: { type: 'cpf', raw: '12345678909' },
      hop1Payload: {
        'empresas-relacionadas-cpf': {
          negociosRelacionados: [{ cnpj: 'invalid' }, { cnpj: '12345678000190' }],
        },
      },
      hop2Payloads: {},
    });
    const cnpjNodes = result.nodes.filter((n) => n.nodeType === 'cnpj');
    expect(cnpjNodes).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar — vermelho**

Run: `pnpm test -- lib/netrin/graph-bridge`
Expected: `Cannot find module`.

- [ ] **Step 3: Implementar**

```ts
// lib/netrin/graph-bridge.ts
import { hashDocument } from '@/lib/hash';
import type {
  CorporateEdgeEvidence,
  ExtractedEdge,
  ExtractedGraph,
  ExtractedNode,
} from '@/lib/graph/types';
import { mask as maskCnpj } from '@/lib/validators/cnpj';
import { mask as maskCpf } from '@/lib/validators/cpf';
import type { NetrinCompositePayload, NetrinDocumentType } from './types';

export type GraphBridgeInput = {
  rootDocument: { type: NetrinDocumentType; raw: string; name?: string };
  hop1Payload: NetrinCompositePayload | null;
  hop2Payloads: Record<string, NetrinCompositePayload>; // key: cnpj raw 14 dígitos
};

type Negocio = {
  cnpj?: unknown;
  razaoSocial?: unknown;
  tipoVinculo?: unknown;
  vinculoDoRelacionamento?: unknown;
  dataInicioRelacionamento?: unknown;
  dataFimRelacionamento?: unknown;
  percentualParticipacao?: unknown;
};

type Entidade = {
  cpf?: unknown;
  nome?: unknown;
  vinculoDoRelacionamento?: unknown;
  dataInicioRelacionamento?: unknown;
  dataFimRelacionamento?: unknown;
  percentualParticipacaoSociedade?: unknown;
};

function makeCpfNode(cpfRaw: string, name?: string): ExtractedNode {
  return {
    nodeHash: hashDocument('cpf', cpfRaw),
    nodeType: 'cpf',
    label: { name, document: cpfRaw },
    maskedPreview: `${(name ?? '').slice(0, 24)} — ${maskCpf(cpfRaw)}`,
  };
}

function makeCnpjNode(cnpjRaw: string, name?: string): ExtractedNode {
  return {
    nodeHash: hashDocument('cnpj', cnpjRaw),
    nodeType: 'cnpj',
    label: { name, document: cnpjRaw },
    maskedPreview: `${(name ?? '').slice(0, 24)} — ${maskCnpj(cnpjRaw)}`,
  };
}

function corporateEvidenceFromNegocio(
  n: Negocio,
  source: CorporateEdgeEvidence['source'],
): CorporateEdgeEvidence {
  const vinculo =
    typeof n.tipoVinculo === 'string' ? n.tipoVinculo
    : typeof n.vinculoDoRelacionamento === 'string' ? n.vinculoDoRelacionamento
    : 'INDEFINIDO';
  return {
    vinculo,
    percentualParticipacao: typeof n.percentualParticipacao === 'number' ? n.percentualParticipacao : undefined,
    dataInicioRelacionamento: typeof n.dataInicioRelacionamento === 'string' ? n.dataInicioRelacionamento : undefined,
    dataFimRelacionamento: typeof n.dataFimRelacionamento === 'string' ? n.dataFimRelacionamento : undefined,
    source,
  };
}

function corporateEvidenceFromEntidade(e: Entidade): CorporateEdgeEvidence {
  return {
    vinculo: typeof e.vinculoDoRelacionamento === 'string' ? e.vinculoDoRelacionamento : 'INDEFINIDO',
    percentualParticipacao: typeof e.percentualParticipacaoSociedade === 'number' ? e.percentualParticipacaoSociedade : undefined,
    dataInicioRelacionamento: typeof e.dataInicioRelacionamento === 'string' ? e.dataInicioRelacionamento : undefined,
    dataFimRelacionamento: typeof e.dataFimRelacionamento === 'string' ? e.dataFimRelacionamento : undefined,
    source: 'pessoas-relacionadas-cnpj',
  };
}

export function buildNetrinGraph(input: GraphBridgeInput): ExtractedGraph {
  const nodeMap = new Map<string, ExtractedNode>();
  const edges: ExtractedEdge[] = [];

  // Root node
  if (input.rootDocument.type === 'cpf' && input.rootDocument.raw.length === 11) {
    const node = makeCpfNode(input.rootDocument.raw, input.rootDocument.name);
    nodeMap.set(node.nodeHash, node);
  } else if (input.rootDocument.type === 'cnpj' && input.rootDocument.raw.length === 14) {
    const node = makeCnpjNode(input.rootDocument.raw, input.rootDocument.name);
    nodeMap.set(node.nodeHash, node);
  }

  // CPF → CNPJ (Hop 1)
  if (input.hop1Payload) {
    const slug = input.hop1Payload['empresas-relacionadas-cpf'] as
      | { negociosRelacionados?: unknown } | null | undefined;
    const list = Array.isArray(slug?.negociosRelacionados) ? (slug?.negociosRelacionados as Negocio[]) : [];
    for (const item of list) {
      const cnpjRaw = typeof item.cnpj === 'string' ? item.cnpj.replace(/\D/g, '') : '';
      if (cnpjRaw.length !== 14) continue;
      const node = makeCnpjNode(cnpjRaw, typeof item.razaoSocial === 'string' ? item.razaoSocial : undefined);
      nodeMap.set(node.nodeHash, node);
      if (input.rootDocument.type === 'cpf') {
        edges.push({
          sourceHash: hashDocument('cpf', input.rootDocument.raw),
          targetHash: node.nodeHash,
          kind: 'corporate_relation',
          evidence: corporateEvidenceFromNegocio(item, 'empresas-relacionadas-cpf'),
        });
      }
    }
  }

  // CNPJ → CPF (Hop 2)
  for (const [cnpjRaw, payload] of Object.entries(input.hop2Payloads)) {
    if (cnpjRaw.length !== 14) continue;
    const cnpjHash = hashDocument('cnpj', cnpjRaw);
    if (!nodeMap.has(cnpjHash)) {
      nodeMap.set(cnpjHash, makeCnpjNode(cnpjRaw));
    }
    const slug = payload['pessoas-relacionadas-cnpj'] as
      | { entidadesRelacionadas?: unknown } | null | undefined;
    const list = Array.isArray(slug?.entidadesRelacionadas) ? (slug?.entidadesRelacionadas as Entidade[]) : [];
    for (const item of list) {
      const cpfRaw = typeof item.cpf === 'string' ? item.cpf.replace(/\D/g, '') : '';
      if (cpfRaw.length !== 11) continue;
      const socioNode = makeCpfNode(cpfRaw, typeof item.nome === 'string' ? item.nome : undefined);
      nodeMap.set(socioNode.nodeHash, socioNode);
      edges.push({
        sourceHash: cnpjHash,
        targetHash: socioNode.nodeHash,
        kind: 'corporate_relation',
        evidence: corporateEvidenceFromEntidade(item),
      });
    }
  }

  return { nodes: Array.from(nodeMap.values()), edges };
}
```

- [ ] **Step 4: Verde + lint + commit**

Run: `pnpm test -- lib/netrin/graph-bridge && pnpm lint:fix && pnpm typecheck`
```bash
git add lib/netrin/graph-bridge.ts lib/netrin/graph-bridge.test.ts
git commit -m "feat(netrin): graph-bridge translates Netrin payloads to ExtractedGraph"
```

---

### Task D3: `lib/netrin/hops/hop1.ts`, `hop2.ts`, `hop3.ts` (TDD)

Cada hop é apenas uma função orquestradora — recebe um `NetrinClient` + cache + audit + admin client, retorna `{ payload, pivots, cached }`. Centraliza a regra "audit antes de chamar; cache antes de fetchar".

**Files:**
- Create: `lib/netrin/hops/hop1.test.ts`, `lib/netrin/hops/hop1.ts`
- Create: `lib/netrin/hops/hop2.test.ts`, `lib/netrin/hops/hop2.ts`
- Create: `lib/netrin/hops/hop3.test.ts`, `lib/netrin/hops/hop3.ts`

#### Hop 1

- [ ] **Step 1: Teste**

```ts
// lib/netrin/hops/hop1.test.ts
import { describe, expect, it, vi } from 'vitest';
import { runHop1 } from './hop1';

describe('runHop1', () => {
  it('returns cached payload + extracts CNPJ pivots, no fetch', async () => {
    const auditSpy = vi.fn(async () => {});
    const fetchSpy = vi.fn();
    const result = await runHop1({
      documentRaw: '12345678909',
      documentHash: 'cpf:abc',
      userId: 'u1',
      jobId: 'j1',
      audit: auditSpy,
      getCache: async () => ({
        payload: {
          'empresas-relacionadas-cpf': {
            negociosRelacionados: [{ cnpj: '12345678000190' }],
          },
        },
        slugsFetched: ['esp-cpf', 'empresas-relacionadas-cpf'],
        fetchedAt: '2026-05-26T00:00:00Z',
      }),
      setCache: async () => {},
      fetchComposta: fetchSpy,
    });

    expect(result.cached).toBe(true);
    expect(result.pivotCnpjs).toEqual(['12345678000190']);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'enrichment_call',
      documentHash: 'cpf:abc',
      metadata: expect.objectContaining({ hop: 1, jobId: 'j1' }),
    }));
  });

  it('calls Netrin and writes cache on miss', async () => {
    const fetchSpy = vi.fn(async () => ({
      'esp-cpf': { nome: 'JOAO' },
      'empresas-relacionadas-cpf': { negociosRelacionados: [{ cnpj: '98765432000110' }] },
    }));
    const setSpy = vi.fn(async () => {});
    const result = await runHop1({
      documentRaw: '12345678909',
      documentHash: 'cpf:abc',
      userId: 'u1',
      jobId: 'j1',
      audit: async () => {},
      getCache: async () => null,
      setCache: setSpy,
      fetchComposta: fetchSpy,
    });

    expect(result.cached).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(result.pivotCnpjs).toEqual(['98765432000110']);
  });
});
```

- [ ] **Step 2: Implementar**

```ts
// lib/netrin/hops/hop1.ts
import type { AuditEvent } from '@/lib/audit';
import { extractPivotCnpjs } from '@/lib/netrin/parsers/pivot-cnpjs';
import {
  HOP1_SLUGS,
  type NetrinCompositePayload,
  type NetrinDocumentType,
  type NetrinSlug,
} from '@/lib/netrin/types';

export type RunHop1Deps = {
  documentRaw: string;
  documentHash: string;
  userId: string;
  jobId: string;
  audit: (event: AuditEvent) => Promise<void>;
  getCache: (hash: string) => Promise<{ payload: NetrinCompositePayload; slugsFetched: string[]; fetchedAt: string } | null>;
  setCache: (
    hash: string,
    type: NetrinDocumentType,
    slugs: string[],
    payload: NetrinCompositePayload,
  ) => Promise<void>;
  fetchComposta: (
    type: NetrinDocumentType,
    documentRaw: string,
    slugs: readonly NetrinSlug[],
  ) => Promise<NetrinCompositePayload>;
};

export type RunHop1Result = {
  payload: NetrinCompositePayload;
  pivotCnpjs: string[];
  cached: boolean;
};

export async function runHop1(deps: RunHop1Deps): Promise<RunHop1Result> {
  await deps.audit({
    userId: deps.userId,
    action: 'enrichment_call',
    documentHash: deps.documentHash,
    metadata: { hop: 1, jobId: deps.jobId, slugs: [...HOP1_SLUGS] },
  });

  const cached = await deps.getCache(deps.documentHash);
  if (cached) {
    return { payload: cached.payload, pivotCnpjs: extractPivotCnpjs(cached.payload), cached: true };
  }

  const payload = await deps.fetchComposta('cpf', deps.documentRaw, HOP1_SLUGS);
  await deps.setCache(deps.documentHash, 'cpf', [...HOP1_SLUGS], payload);
  return { payload, pivotCnpjs: extractPivotCnpjs(payload), cached: false };
}
```

- [ ] **Step 3: Verde + commit**

Run: `pnpm test -- lib/netrin/hops/hop1`
```bash
git add lib/netrin/hops/hop1.ts lib/netrin/hops/hop1.test.ts
git commit -m "feat(netrin): runHop1 orchestrator (cache + audit + fetch + pivots)"
```

#### Hop 2

- [ ] **Step 1: Teste**

```ts
// lib/netrin/hops/hop2.test.ts
import { describe, expect, it, vi } from 'vitest';
import { runHop2 } from './hop2';

describe('runHop2', () => {
  it('extracts CPF socios from cache hit', async () => {
    const result = await runHop2({
      cnpjRaw: '12345678000190',
      cnpjHash: 'cnpj:hh',
      userId: 'u1',
      jobId: 'j1',
      audit: async () => {},
      getCache: async () => ({
        payload: {
          'pessoas-relacionadas-cnpj': {
            entidadesRelacionadas: [{ cpf: '12345678909', vinculoDoRelacionamento: 'SOCIO' }],
          },
        },
        slugsFetched: ['pessoas-relacionadas-cnpj'],
        fetchedAt: '2026-05-26T00:00:00Z',
      }),
      setCache: async () => {},
      fetchComposta: vi.fn(),
    });
    expect(result.cached).toBe(true);
    expect(result.pivotCpfs.map((p) => p.cpf)).toEqual(['12345678909']);
  });

  it('fetches on miss', async () => {
    const fetchSpy = vi.fn(async () => ({
      'pessoas-relacionadas-cnpj': { entidadesRelacionadas: [] },
    }));
    await runHop2({
      cnpjRaw: '12345678000190',
      cnpjHash: 'cnpj:hh',
      userId: 'u1',
      jobId: 'j1',
      audit: async () => {},
      getCache: async () => null,
      setCache: async () => {},
      fetchComposta: fetchSpy,
    });
    expect(fetchSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implementar**

```ts
// lib/netrin/hops/hop2.ts
import type { AuditEvent } from '@/lib/audit';
import { extractPivotCpfs, type PivotCpf } from '@/lib/netrin/parsers/pivot-cpfs';
import {
  HOP2_SLUGS,
  type NetrinCompositePayload,
  type NetrinDocumentType,
  type NetrinSlug,
} from '@/lib/netrin/types';

export type RunHop2Deps = {
  cnpjRaw: string;
  cnpjHash: string;
  userId: string;
  jobId: string;
  audit: (event: AuditEvent) => Promise<void>;
  getCache: (hash: string) => Promise<{ payload: NetrinCompositePayload; slugsFetched: string[]; fetchedAt: string } | null>;
  setCache: (
    hash: string,
    type: NetrinDocumentType,
    slugs: string[],
    payload: NetrinCompositePayload,
  ) => Promise<void>;
  fetchComposta: (
    type: NetrinDocumentType,
    documentRaw: string,
    slugs: readonly NetrinSlug[],
  ) => Promise<NetrinCompositePayload>;
};

export type RunHop2Result = {
  payload: NetrinCompositePayload;
  pivotCpfs: PivotCpf[];
  cached: boolean;
};

export async function runHop2(deps: RunHop2Deps): Promise<RunHop2Result> {
  await deps.audit({
    userId: deps.userId,
    action: 'enrichment_call',
    documentHash: deps.cnpjHash,
    metadata: { hop: 2, jobId: deps.jobId, slugs: [...HOP2_SLUGS] },
  });

  const cached = await deps.getCache(deps.cnpjHash);
  if (cached) {
    return { payload: cached.payload, pivotCpfs: extractPivotCpfs(cached.payload), cached: true };
  }

  const payload = await deps.fetchComposta('cnpj', deps.cnpjRaw, HOP2_SLUGS);
  await deps.setCache(deps.cnpjHash, 'cnpj', [...HOP2_SLUGS], payload);
  return { payload, pivotCpfs: extractPivotCpfs(payload), cached: false };
}
```

- [ ] **Step 3: Commit**

```bash
pnpm test -- lib/netrin/hops/hop2
git add lib/netrin/hops/hop2.ts lib/netrin/hops/hop2.test.ts
git commit -m "feat(netrin): runHop2 orchestrator (CNPJ → CPF sócios pivots)"
```

#### Hop 3

- [ ] **Step 1: Teste**

```ts
// lib/netrin/hops/hop3.test.ts
import { describe, expect, it, vi } from 'vitest';
import { runHop3 } from './hop3';

describe('runHop3', () => {
  it('audits and fetches reduced slug set; terminal (no pivots returned)', async () => {
    const auditSpy = vi.fn(async () => {});
    const fetchSpy = vi.fn(async () => ({ 'esp-cpf': {} }));
    const result = await runHop3({
      cpfRaw: '98765432100',
      cpfHash: 'cpf:hh',
      userId: 'u1',
      jobId: 'j1',
      audit: auditSpy,
      getCache: async () => null,
      setCache: async () => {},
      fetchComposta: fetchSpy,
    });
    expect(result.cached).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, , slugs] = fetchSpy.mock.calls[0] as [unknown, unknown, readonly string[]];
    expect(slugs).toContain('esp-cpf');
    expect(slugs).toContain('pep-kyc-cpf');
    expect(slugs).toContain('processos-cpf');
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ hop: 3 }),
    }));
  });
});
```

- [ ] **Step 2: Implementar**

```ts
// lib/netrin/hops/hop3.ts
import type { AuditEvent } from '@/lib/audit';
import {
  HOP3_SLUGS,
  type NetrinCompositePayload,
  type NetrinDocumentType,
  type NetrinSlug,
} from '@/lib/netrin/types';

export type RunHop3Deps = {
  cpfRaw: string;
  cpfHash: string;
  userId: string;
  jobId: string;
  audit: (event: AuditEvent) => Promise<void>;
  getCache: (hash: string) => Promise<{ payload: NetrinCompositePayload; slugsFetched: string[]; fetchedAt: string } | null>;
  setCache: (
    hash: string,
    type: NetrinDocumentType,
    slugs: string[],
    payload: NetrinCompositePayload,
  ) => Promise<void>;
  fetchComposta: (
    type: NetrinDocumentType,
    documentRaw: string,
    slugs: readonly NetrinSlug[],
  ) => Promise<NetrinCompositePayload>;
};

export type RunHop3Result = { payload: NetrinCompositePayload; cached: boolean };

export async function runHop3(deps: RunHop3Deps): Promise<RunHop3Result> {
  await deps.audit({
    userId: deps.userId,
    action: 'enrichment_call',
    documentHash: deps.cpfHash,
    metadata: { hop: 3, jobId: deps.jobId, slugs: [...HOP3_SLUGS] },
  });

  const cached = await deps.getCache(deps.cpfHash);
  if (cached) return { payload: cached.payload, cached: true };

  const payload = await deps.fetchComposta('cpf', deps.cpfRaw, HOP3_SLUGS);
  await deps.setCache(deps.cpfHash, 'cpf', [...HOP3_SLUGS], payload);
  return { payload, cached: false };
}
```

- [ ] **Step 3: Commit**

```bash
pnpm test -- lib/netrin/hops/hop3
git add lib/netrin/hops/hop3.ts lib/netrin/hops/hop3.test.ts
git commit -m "feat(netrin): runHop3 orchestrator (terminal)"
```

---

## Fase E — Job store + Processor

### Task E1: `lib/netrin/job-store.ts` (TDD)

**Files:**
- Create: `lib/netrin/job-store.test.ts`
- Create: `lib/netrin/job-store.ts`

Funções: `findOrCreateJob`, `getJob`, `setJobStatus`, `incrementHop2Done`, `incrementHop3Done`, `setHop1Status`, `setHop2Total`, `setHop3Total`, `recordCall`.

- [ ] **Step 1: Testes (foco no branch lógico, mocks no client)**

```ts
// lib/netrin/job-store.test.ts
import { describe, expect, it, vi } from 'vitest';
import { findOrCreateJob } from './job-store';

function clientWith(
  selectMaybeSingle: { data: unknown; error: { message: string } | null },
  insertResult: { data: unknown; error: { message: string; code?: string } | null },
) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                in() {
                  return {
                    maybeSingle() {
                      return Promise.resolve(selectMaybeSingle);
                    },
                  };
                },
              };
            },
          };
        },
        insert() {
          return {
            select() {
              return { single: () => Promise.resolve(insertResult) };
            },
          };
        },
      };
    },
  } as never;
}

describe('findOrCreateJob', () => {
  it('returns existing job when status pending/running', async () => {
    const client = clientWith(
      { data: { id: 'j-existing', status: 'running' }, error: null },
      { data: null, error: null },
    );
    const result = await findOrCreateJob(client, { userId: 'u1', rootHash: 'cpf:abc', rootType: 'cpf' });
    expect(result).toEqual({ jobId: 'j-existing', created: false });
  });

  it('inserts a new pending job when none active', async () => {
    const client = clientWith(
      { data: null, error: null },
      { data: { id: 'j-new' }, error: null },
    );
    const result = await findOrCreateJob(client, { userId: 'u1', rootHash: 'cpf:abc', rootType: 'cpf' });
    expect(result).toEqual({ jobId: 'j-new', created: true });
  });

  it('returns existing on unique-violation race', async () => {
    // First SELECT returns null, INSERT fails 23505 (unique violation), retry SELECT returns existing.
    let selectCalls = 0;
    const client = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  in() {
                    return {
                      maybeSingle() {
                        selectCalls++;
                        return Promise.resolve(
                          selectCalls === 1
                            ? { data: null, error: null }
                            : { data: { id: 'j-winner', status: 'running' }, error: null },
                        );
                      },
                    };
                  },
                };
              },
            };
          },
          insert() {
            return {
              select() {
                return { single: () => Promise.resolve({ data: null, error: { message: 'duplicate', code: '23505' } }) };
              },
            };
          },
        };
      },
    } as never;

    const result = await findOrCreateJob(client, { userId: 'u1', rootHash: 'cpf:abc', rootType: 'cpf' });
    expect(result).toEqual({ jobId: 'j-winner', created: false });
  });
});
```

- [ ] **Step 2: Implementar**

```ts
// lib/netrin/job-store.ts
import type { Database } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export type EnrichmentJobStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed';
export type EnrichmentCallStatus = 'pending' | 'running' | 'success' | 'error' | 'cache_hit';

export type FindOrCreateJobInput = {
  userId: string;
  rootHash: string;
  rootType: 'cpf' | 'cnpj';
};

export type FindOrCreateJobResult = { jobId: string; created: boolean };

export async function findOrCreateJob(
  client: SupabaseClient<Database>,
  input: FindOrCreateJobInput,
): Promise<FindOrCreateJobResult> {
  const { data: existing, error: selectError } = await client
    .from('enrichment_jobs')
    .select('id, status')
    .eq('root_hash', input.rootHash)
    .in('status', ['pending', 'running'])
    .maybeSingle();
  if (selectError) throw new Error(`findOrCreateJob select failed: ${selectError.message}`);
  if (existing) return { jobId: (existing as { id: string }).id, created: false };

  const { data: inserted, error: insertError } = await client
    .from('enrichment_jobs')
    .insert({
      user_id: input.userId,
      root_hash: input.rootHash,
      root_type: input.rootType,
      status: 'pending',
    } as never)
    .select('id')
    .single<{ id: string }>();

  if (insertError) {
    if ((insertError as { code?: string }).code === '23505') {
      const { data: winner } = await client
        .from('enrichment_jobs')
        .select('id, status')
        .eq('root_hash', input.rootHash)
        .in('status', ['pending', 'running'])
        .maybeSingle();
      if (winner) return { jobId: (winner as { id: string }).id, created: false };
    }
    throw new Error(`findOrCreateJob insert failed: ${insertError.message}`);
  }
  if (!inserted) throw new Error('findOrCreateJob: insert returned no data');
  return { jobId: inserted.id, created: true };
}

export async function setJobStatus(
  client: SupabaseClient<Database>,
  jobId: string,
  status: EnrichmentJobStatus,
  opts: { error?: string; finished?: boolean } = {},
): Promise<void> {
  const update: Record<string, unknown> = { status };
  if (opts.error !== undefined) update.error = opts.error;
  if (opts.finished) update.finished_at = new Date().toISOString();
  const { error } = await client.from('enrichment_jobs').update(update as never).eq('id', jobId);
  if (error) throw new Error(`setJobStatus failed: ${error.message}`);
}

export async function setHop1Status(
  client: SupabaseClient<Database>,
  jobId: string,
  status: 'success' | 'error' | 'cache_hit' | 'skipped',
): Promise<void> {
  const { error } = await client
    .from('enrichment_jobs')
    .update({ hop1_status: status } as never)
    .eq('id', jobId);
  if (error) throw new Error(`setHop1Status failed: ${error.message}`);
}

export async function setHopTotals(
  client: SupabaseClient<Database>,
  jobId: string,
  totals: { hop2_total?: number; hop3_total?: number },
): Promise<void> {
  const { error } = await client
    .from('enrichment_jobs')
    .update(totals as never)
    .eq('id', jobId);
  if (error) throw new Error(`setHopTotals failed: ${error.message}`);
}

export async function bumpHopDone(
  client: SupabaseClient<Database>,
  jobId: string,
  hop: 2 | 3,
): Promise<void> {
  // Postgres-side increment via RPC seria mais seguro contra race, mas
  // como a Edge Function processa serial dentro de um único job, um
  // optimistic update por SELECT+UPDATE é suficiente.
  const column = hop === 2 ? 'hop2_done' : 'hop3_done';
  const { data, error } = await client
    .from('enrichment_jobs')
    .select(column)
    .eq('id', jobId)
    .single<Record<string, number>>();
  if (error || !data) throw new Error(`bumpHopDone select: ${error?.message ?? 'no data'}`);
  const next = (data[column] ?? 0) + 1;
  const upd = { [column]: next } as Record<string, number>;
  const { error: updError } = await client
    .from('enrichment_jobs')
    .update(upd as never)
    .eq('id', jobId);
  if (updError) throw new Error(`bumpHopDone update: ${updError.message}`);
}

export type RecordCallInput = {
  jobId: string;
  hop: 1 | 2 | 3;
  documentHash: string;
  documentType: 'cpf' | 'cnpj';
  slugs: string[];
  status: EnrichmentCallStatus;
  cached: boolean;
  fetchedAt?: string;
  error?: string;
};

export async function recordCall(
  client: SupabaseClient<Database>,
  input: RecordCallInput,
): Promise<void> {
  const row: Record<string, unknown> = {
    job_id: input.jobId,
    hop: input.hop,
    document_hash: input.documentHash,
    document_type: input.documentType,
    slugs: input.slugs,
    status: input.status,
    cached: input.cached,
    fetched_at: input.fetchedAt ?? new Date().toISOString(),
  };
  if (input.error !== undefined) row.error = input.error;
  const { error } = await client.from('enrichment_job_calls').insert(row as never);
  if (error) throw new Error(`recordCall failed: ${error.message}`);
}
```

- [ ] **Step 3: Verde + commit**

```bash
pnpm test -- lib/netrin/job-store
git add lib/netrin/job-store.ts lib/netrin/job-store.test.ts
git commit -m "feat(netrin): job-store CRUD + race-aware findOrCreate"
```

---

### Task E2: `lib/netrin/processor.ts` (TDD)

Loop principal: para um `jobId`, executa Hop1 → coleta CNPJs → para cada CNPJ executa Hop2 → coleta CPFs → para cada CPF executa Hop3. Erro em hop2/3 isola o item (call.status=error) sem parar o loop.

**Files:**
- Create: `lib/netrin/processor.test.ts`
- Create: `lib/netrin/processor.ts`

- [ ] **Step 1: Teste**

```ts
// lib/netrin/processor.test.ts
import { describe, expect, it, vi } from 'vitest';
import { processEnrichmentJob } from './processor';

describe('processEnrichmentJob', () => {
  it('runs hop1 → hop2 (per cnpj) → hop3 (per cpf), updates counters', async () => {
    const calls: string[] = [];
    const result = await processEnrichmentJob('job1', {
      job: { rootType: 'cpf', rootRaw: '12345678909', rootHash: 'cpf:abc', userId: 'u1' },
      setJobStatus: async (_id, status) => { calls.push(`status:${status}`); },
      setHop1Status: async (_id, s) => { calls.push(`hop1:${s}`); },
      setHopTotals: async (_id, t) => { calls.push(`totals:${JSON.stringify(t)}`); },
      bumpHopDone: async (_id, hop) => { calls.push(`bump:${hop}`); },
      recordCall: async (input) => { calls.push(`record:${input.hop}:${input.status}`); },
      runHop1: async () => ({ payload: {}, pivotCnpjs: ['11111111000111', '22222222000222'], cached: false }),
      runHop2: async (cnpjRaw) => ({
        payload: {},
        pivotCpfs: [{ cpf: '33333333333', vinculo: 'SOCIO', ativo: true }],
        cached: cnpjRaw === '22222222000222',
      }),
      runHop3: async () => ({ payload: {}, cached: false }),
      finalize: async () => { calls.push('finalize'); },
    });

    expect(result.status).toBe('completed');
    expect(calls).toContain('status:running');
    expect(calls).toContain('hop1:success');
    expect(calls).toContain('totals:{"hop2_total":2}');
    expect(calls.filter((c) => c === 'bump:2')).toHaveLength(2);
    expect(calls.filter((c) => c === 'bump:3').length).toBeGreaterThanOrEqual(1);
    expect(calls).toContain('finalize');
    expect(calls).toContain('status:completed');
  });

  it('marks partial when a hop2 throws', async () => {
    const result = await processEnrichmentJob('job1', {
      job: { rootType: 'cpf', rootRaw: '12345678909', rootHash: 'cpf:abc', userId: 'u1' },
      setJobStatus: async () => {},
      setHop1Status: async () => {},
      setHopTotals: async () => {},
      bumpHopDone: async () => {},
      recordCall: async () => {},
      runHop1: async () => ({ payload: {}, pivotCnpjs: ['11111111000111'], cached: false }),
      runHop2: async () => { throw new Error('boom'); },
      runHop3: async () => ({ payload: {}, cached: false }),
      finalize: async () => {},
    });
    expect(result.status).toBe('partial');
  });

  it('marks failed when hop1 throws', async () => {
    const result = await processEnrichmentJob('job1', {
      job: { rootType: 'cpf', rootRaw: '12345678909', rootHash: 'cpf:abc', userId: 'u1' },
      setJobStatus: async () => {},
      setHop1Status: async () => {},
      setHopTotals: async () => {},
      bumpHopDone: async () => {},
      recordCall: async () => {},
      runHop1: async () => { throw new Error('upstream'); },
      runHop2: async () => ({ payload: {}, pivotCpfs: [], cached: false }),
      runHop3: async () => ({ payload: {}, cached: false }),
      finalize: async () => {},
    });
    expect(result.status).toBe('failed');
  });

  it('skips hop1 when root_type=cnpj and starts from hop2', async () => {
    const calls: string[] = [];
    const result = await processEnrichmentJob('job1', {
      job: { rootType: 'cnpj', rootRaw: '12345678000190', rootHash: 'cnpj:abc', userId: 'u1' },
      setJobStatus: async () => {},
      setHop1Status: async (_id, s) => { calls.push(`hop1:${s}`); },
      setHopTotals: async () => {},
      bumpHopDone: async () => {},
      recordCall: async () => {},
      runHop1: async () => { throw new Error('should not be called'); },
      runHop2: async () => ({ payload: {}, pivotCpfs: [{ cpf: '11111111111', vinculo: 'SOCIO', ativo: true }], cached: false }),
      runHop3: async () => ({ payload: {}, cached: false }),
      finalize: async () => {},
    });
    expect(calls).toContain('hop1:skipped');
    expect(result.status).toBe('completed');
  });
});
```

- [ ] **Step 2: Implementar**

```ts
// lib/netrin/processor.ts
import { hashDocument } from '@/lib/hash';
import type { RunHop1Result } from './hops/hop1';
import type { RunHop2Result } from './hops/hop2';
import type { RunHop3Result } from './hops/hop3';
import type {
  EnrichmentCallStatus,
  EnrichmentJobStatus,
  RecordCallInput,
} from './job-store';
import type { NetrinCompositePayload } from './types';

export type ProcessorJob = {
  rootType: 'cpf' | 'cnpj';
  rootRaw: string;
  rootHash: string;
  userId: string;
};

export type ProcessorDeps = {
  job: ProcessorJob;
  setJobStatus: (jobId: string, status: EnrichmentJobStatus, opts?: { error?: string; finished?: boolean }) => Promise<void>;
  setHop1Status: (jobId: string, status: 'success' | 'error' | 'cache_hit' | 'skipped') => Promise<void>;
  setHopTotals: (jobId: string, totals: { hop2_total?: number; hop3_total?: number }) => Promise<void>;
  bumpHopDone: (jobId: string, hop: 2 | 3) => Promise<void>;
  recordCall: (input: RecordCallInput) => Promise<void>;
  runHop1: () => Promise<RunHop1Result>;
  runHop2: (cnpjRaw: string) => Promise<RunHop2Result>;
  runHop3: (cpfRaw: string) => Promise<RunHop3Result>;
  finalize: (collected: {
    hop1Payload: NetrinCompositePayload | null;
    hop2Payloads: Record<string, NetrinCompositePayload>;
    hop3Payloads: Record<string, NetrinCompositePayload>;
  }) => Promise<void>;
};

export type ProcessorResult = { status: 'completed' | 'partial' | 'failed' };

function statusFromCache(cached: boolean): EnrichmentCallStatus {
  return cached ? 'cache_hit' : 'success';
}

export async function processEnrichmentJob(
  jobId: string,
  deps: ProcessorDeps,
): Promise<ProcessorResult> {
  let anyError = false;
  let hop1Payload: NetrinCompositePayload | null = null;
  const hop2Payloads: Record<string, NetrinCompositePayload> = {};
  const hop3Payloads: Record<string, NetrinCompositePayload> = {};

  await deps.setJobStatus(jobId, 'running');

  let pivotCnpjs: string[] = [];
  if (deps.job.rootType === 'cpf') {
    try {
      const hop1 = await deps.runHop1();
      hop1Payload = hop1.payload;
      pivotCnpjs = hop1.pivotCnpjs;
      await deps.recordCall({
        jobId, hop: 1, documentHash: deps.job.rootHash, documentType: 'cpf',
        slugs: [], status: statusFromCache(hop1.cached), cached: hop1.cached,
      });
      await deps.setHop1Status(jobId, hop1.cached ? 'cache_hit' : 'success');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await deps.recordCall({
        jobId, hop: 1, documentHash: deps.job.rootHash, documentType: 'cpf',
        slugs: [], status: 'error', cached: false, error: message,
      });
      await deps.setHop1Status(jobId, 'error');
      await deps.setJobStatus(jobId, 'failed', { error: message, finished: true });
      return { status: 'failed' };
    }
  } else {
    pivotCnpjs = [deps.job.rootRaw];
    await deps.setHop1Status(jobId, 'skipped');
  }

  await deps.setHopTotals(jobId, { hop2_total: pivotCnpjs.length });

  const pivotCpfs: { cpf: string }[] = [];

  for (const cnpjRaw of pivotCnpjs) {
    const cnpjHash = hashDocument('cnpj', cnpjRaw);
    try {
      const hop2 = await deps.runHop2(cnpjRaw);
      hop2Payloads[cnpjRaw] = hop2.payload;
      await deps.recordCall({
        jobId, hop: 2, documentHash: cnpjHash, documentType: 'cnpj',
        slugs: [], status: statusFromCache(hop2.cached), cached: hop2.cached,
      });
      await deps.bumpHopDone(jobId, 2);
      for (const p of hop2.pivotCpfs) pivotCpfs.push({ cpf: p.cpf });
    } catch (e) {
      anyError = true;
      const message = e instanceof Error ? e.message : String(e);
      await deps.recordCall({
        jobId, hop: 2, documentHash: cnpjHash, documentType: 'cnpj',
        slugs: [], status: 'error', cached: false, error: message,
      });
      await deps.bumpHopDone(jobId, 2);
    }
  }

  // Dedupe pivot CPFs across all CNPJs and skip root CPF (no re-enrich)
  const uniqueCpfs = Array.from(new Set(pivotCpfs.map((p) => p.cpf))).filter(
    (c) => !(deps.job.rootType === 'cpf' && c === deps.job.rootRaw),
  );
  await deps.setHopTotals(jobId, { hop3_total: uniqueCpfs.length });

  for (const cpfRaw of uniqueCpfs) {
    const cpfHash = hashDocument('cpf', cpfRaw);
    try {
      const hop3 = await deps.runHop3(cpfRaw);
      hop3Payloads[cpfRaw] = hop3.payload;
      await deps.recordCall({
        jobId, hop: 3, documentHash: cpfHash, documentType: 'cpf',
        slugs: [], status: statusFromCache(hop3.cached), cached: hop3.cached,
      });
      await deps.bumpHopDone(jobId, 3);
    } catch (e) {
      anyError = true;
      const message = e instanceof Error ? e.message : String(e);
      await deps.recordCall({
        jobId, hop: 3, documentHash: cpfHash, documentType: 'cpf',
        slugs: [], status: 'error', cached: false, error: message,
      });
      await deps.bumpHopDone(jobId, 3);
    }
  }

  try {
    await deps.finalize({ hop1Payload, hop2Payloads, hop3Payloads });
  } catch (e) {
    anyError = true;
    console.warn('finalize failed:', e);
  }

  const finalStatus: EnrichmentJobStatus = anyError ? 'partial' : 'completed';
  await deps.setJobStatus(jobId, finalStatus, { finished: true });
  return { status: finalStatus };
}
```

- [ ] **Step 3: Verde + commit**

```bash
pnpm test -- lib/netrin/processor
git add lib/netrin/processor.ts lib/netrin/processor.test.ts
git commit -m "feat(netrin): processor loop with hop1→hop2→hop3 + error isolation"
```

---

## Fase F — Edge Function

### Task F1: `supabase/functions/process-enrichment-job/index.ts`

**Files:**
- Create: `supabase/functions/process-enrichment-job/index.ts`

- [ ] **Step 1: Implementar**

```ts
// supabase/functions/process-enrichment-job/index.ts
// Supabase Edge Function — Deno. Triggered fire-and-forget by Server Actions.

import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';
import { writeAuditLog } from '../../../lib/audit.ts';
import { upsertGraph } from '../../../lib/graph/writer.ts';
import { getNetrinCache, setNetrinCache } from '../../../lib/netrin/cache.ts';
import { NetrinClient } from '../../../lib/netrin/client.ts';
import { buildNetrinGraph } from '../../../lib/netrin/graph-bridge.ts';
import { runHop1 } from '../../../lib/netrin/hops/hop1.ts';
import { runHop2 } from '../../../lib/netrin/hops/hop2.ts';
import { runHop3 } from '../../../lib/netrin/hops/hop3.ts';
import {
  bumpHopDone,
  recordCall,
  setHop1Status,
  setHopTotals,
  setJobStatus,
} from '../../../lib/netrin/job-store.ts';
import { processEnrichmentJob } from '../../../lib/netrin/processor.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

type Body = { jobId?: unknown };

const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'NETRIN_BASE_URL',
  'NETRIN_TOKEN',
] as const;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }
  if (typeof body.jobId !== 'string' || !body.jobId) {
    return jsonResponse({ error: 'missing jobId' }, 400);
  }

  const env: Record<string, string> = {};
  for (const k of REQUIRED_ENV) {
    const v = Deno.env.get(k);
    if (!v) return jsonResponse({ error: `missing env: ${k}` }, 500);
    env[k] = v;
  }
  const acuraciaRaw = Deno.env.get('NETRIN_PEP_ACURACIA');
  const pepAcuracia = acuraciaRaw ? Number.parseInt(acuraciaRaw, 10) : undefined;

  const admin = createClient(env.SUPABASE_URL as string, env.SUPABASE_SECRET_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: job, error: jobError } = await admin
    .from('enrichment_jobs')
    .select('id, user_id, root_hash, root_type, status')
    .eq('id', body.jobId)
    .maybeSingle();
  if (jobError) return jsonResponse({ error: jobError.message }, 500);
  if (!job) return jsonResponse({ error: 'job not found' }, 404);
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'partial') {
    return jsonResponse({ jobId: body.jobId, status: job.status, skipped: true }, 200);
  }

  // Look up the original document for the root by reading the most recent
  // searches row with this document_hash. The hash is one-way; we need the
  // raw digits to call Netrin. The bulk job equivalent stores it encrypted
  // — for single searches we re-derive from the request body, which means
  // the Edge Function caller must pass `documentRaw` alongside jobId.
  // We accept it here as a second body field.

  const rootRaw = typeof (body as { documentRaw?: unknown }).documentRaw === 'string'
    ? ((body as { documentRaw: string }).documentRaw)
    : null;
  if (!rootRaw) return jsonResponse({ error: 'missing documentRaw' }, 400);

  const userId = (job as { user_id: string }).user_id;
  const rootHash = (job as { root_hash: string }).root_hash;
  const rootType = (job as { root_type: 'cpf' | 'cnpj' }).root_type;

  const netrin = new NetrinClient({
    baseUrl: env.NETRIN_BASE_URL as string,
    token: env.NETRIN_TOKEN as string,
    pepAcuracia: Number.isFinite(pepAcuracia) ? pepAcuracia : undefined,
  });

  const auditFn = (event: Parameters<typeof writeAuditLog>[0]) =>
    writeAuditLog(event, admin as never, { allowFailure: true });
  const getCacheFn = (hash: string) => getNetrinCache(admin as never, hash);
  const setCacheFn = (hash: string, type: 'cpf' | 'cnpj', slugs: string[], payload: Record<string, unknown>) =>
    setNetrinCache(admin as never, hash, type, slugs, payload);

  const task = (async () => {
    try {
      await processEnrichmentJob(body.jobId as string, {
        job: { rootType, rootRaw, rootHash, userId },
        setJobStatus: (id, status, opts) => setJobStatus(admin as never, id, status, opts),
        setHop1Status: (id, s) => setHop1Status(admin as never, id, s),
        setHopTotals: (id, t) => setHopTotals(admin as never, id, t),
        bumpHopDone: (id, hop) => bumpHopDone(admin as never, id, hop),
        recordCall: (input) => recordCall(admin as never, input),
        runHop1: () => runHop1({
          documentRaw: rootRaw,
          documentHash: rootHash,
          userId,
          jobId: body.jobId as string,
          audit: auditFn,
          getCache: getCacheFn,
          setCache: setCacheFn,
          fetchComposta: (type, raw, slugs) => netrin.fetchComposta(type, raw, slugs),
        }),
        runHop2: (cnpjRaw) => {
          // hashDocument is in lib/hash.ts; import inside arrow to avoid top-level cycle
          return import('../../../lib/hash.ts').then(({ hashDocument }) =>
            runHop2({
              cnpjRaw,
              cnpjHash: hashDocument('cnpj', cnpjRaw),
              userId,
              jobId: body.jobId as string,
              audit: auditFn,
              getCache: getCacheFn,
              setCache: setCacheFn,
              fetchComposta: (type, raw, slugs) => netrin.fetchComposta(type, raw, slugs),
            }),
          );
        },
        runHop3: (cpfRaw) => {
          return import('../../../lib/hash.ts').then(({ hashDocument }) =>
            runHop3({
              cpfRaw,
              cpfHash: hashDocument('cpf', cpfRaw),
              userId,
              jobId: body.jobId as string,
              audit: auditFn,
              getCache: getCacheFn,
              setCache: setCacheFn,
              fetchComposta: (type, raw, slugs) => netrin.fetchComposta(type, raw, slugs),
            }),
          );
        },
        finalize: async ({ hop1Payload, hop2Payloads }) => {
          const graph = buildNetrinGraph({
            rootDocument: { type: rootType, raw: rootRaw },
            hop1Payload,
            hop2Payloads,
          });
          if (graph.nodes.length > 0) {
            await upsertGraph(admin as never, graph.nodes, graph.edges);
          }
        },
      });
    } catch (e) {
      console.error(`enrichment job ${body.jobId} failed:`, e);
      try {
        await setJobStatus(admin as never, body.jobId as string, 'failed', {
          error: e instanceof Error ? e.message : String(e),
          finished: true,
        });
      } catch (statusErr) {
        console.error('failed to mark job as failed:', statusErr);
      }
    }
  })();

  if (typeof EdgeRuntime !== 'undefined') {
    EdgeRuntime.waitUntil(task);
  } else {
    await task;
  }

  return jsonResponse({ jobId: body.jobId, status: 'started' }, 202);
});
```

- [ ] **Step 2: Deploy local**

Run: `pnpm exec supabase functions serve process-enrichment-job --no-verify-jwt`
Verify: cresce sem erros de import.

- [ ] **Step 3: Smoke (precisa de um job pré-criado via SQL)**

```bash
psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" -c \
"insert into enrichment_jobs (user_id, root_hash, root_type, status) values
 ((select id from auth.users limit 1), 'cpf:smoke', 'cpf', 'pending') returning id;"
```
Pegue o `id` retornado e:
```bash
curl -X POST http://localhost:54321/functions/v1/process-enrichment-job \
  -H "content-type: application/json" \
  -d '{"jobId":"<id>","documentRaw":"12345678909"}'
```
Expected: 202 + log da Edge function. O job poderá falhar com erro Netrin (token inválido) — esperado se o token de teste não estiver no `.env.local`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/process-enrichment-job/index.ts
git commit -m "feat(netrin): process-enrichment-job Edge Function (Deno)"
```

---

## Fase G — Gatilho via Server Actions

### Task G1: Disparar enriquecimento a partir de `searchPerson`

**Files:**
- Modify: `app/(app)/search/person/actions.ts`

- [ ] **Step 1: Acrescentar lógica de criação/dispatch ao final de `searchPerson` (antes do `return`)**

Logo após `await supabase.from('searches').insert({...})` e antes do `return { ok: true, ... }`, somente quando `input.type === 'cpf'`:

```ts
  if (input.type === 'cpf') {
    try {
      const { findOrCreateJob } = await import('@/lib/netrin/job-store');
      const { jobId, created } = await findOrCreateJob(admin, {
        userId: user.id,
        rootHash: documentHash,
        rootType: 'cpf',
      });
      if (created) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const secret = process.env.SUPABASE_SECRET_KEY;
        if (supabaseUrl && secret) {
          const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/process-enrichment-job`;
          // Fire-and-forget. Não fazemos await pra não bloquear o redirect.
          void fetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              Authorization: `Bearer ${secret}`,
            },
            body: JSON.stringify({ jobId, documentRaw: trimmed.replace(/\D/g, '') }),
          }).catch((e) => console.warn('enrichment dispatch failed:', e));
        }
      }
      // (jobId opcionalmente vai pra response; UI vai consultar o latest na page.)
    } catch (e) {
      console.warn('enrichment job creation failed:', e);
    }
  }
```

- [ ] **Step 2: Typecheck + lint + smoke (build)**

Run: `pnpm typecheck && pnpm lint:fix && pnpm build`
Expected: build verde.

- [ ] **Step 3: Commit**

```bash
git add app/(app)/search/person/actions.ts
git commit -m "feat(netrin): fire-and-forget enrichment job from searchPerson"
```

---

### Task G2: Disparar enriquecimento a partir de `searchByCnpj`

**Files:**
- Modify: `app/(app)/search/company/actions.ts`

- [ ] **Step 1: Inspecionar arquivo**

Run: `cat app/(app)/search/company/actions.ts | head -120`

- [ ] **Step 2: Adicionar mesmo bloco após o `searches` insert**

Análogo a G1, mas:
- `rootHash = documentHash` (já é `hashDocument('cnpj', raw)`)
- `rootType: 'cnpj'`
- `documentRaw: trimmed.replace(/\D/g, '')` (14 dígitos)

Não há branch por `input.type` — `/search/company` é sempre CNPJ.

- [ ] **Step 3: Commit**

```bash
pnpm typecheck && pnpm lint:fix
git add app/(app)/search/company/actions.ts
git commit -m "feat(netrin): fire-and-forget enrichment job from searchByCnpj"
```

---

## Fase H — UI

### Task H1: Componentes `components/antifraude/`

**Files:**
- Create: `components/antifraude/identity-card.tsx`
- Create: `components/antifraude/pep-card.tsx`
- Create: `components/antifraude/media-card.tsx`
- Create: `components/antifraude/restrictions-card.tsx`
- Create: `components/antifraude/related-companies.tsx`
- Create: `components/antifraude/types.ts`

- [ ] **Step 1: Tipos compartilhados**

```ts
// components/antifraude/types.ts
export type AntifraudeStatus = 'pending' | 'running' | 'success' | 'error' | 'cache_hit' | 'missing';

export type IdentityCardProps = {
  status: AntifraudeStatus;
  nome?: string;
  dataNascimento?: string;
  situacaoCadastral?: string;
};

export type PepCardProps = {
  status: AntifraudeStatus;
  currentlyPEP?: boolean;
  currentlySanctioned?: boolean;
  historicoCount?: number;
};

export type MediaCardProps = {
  status: AntifraudeStatus;
  mencoes?: number;
  itens?: { titulo: string; url?: string; data?: string }[];
};

export type RestrictionsCardProps = {
  status: AntifraudeStatus;
  apostasImpedido?: boolean;
};

export type RelatedCompanyEntry = {
  cnpj: string;
  razaoSocial?: string;
  vinculo?: string;
  ativo: boolean;
  dataInicio?: string;
  dataFim?: string;
  hop2?: {
    situacaoCadastral?: string;
    capitalSocial?: number;
    sancionado?: boolean;
    sociosCpfHashes?: string[];
  };
};
export type RelatedCompaniesProps = {
  status: AntifraudeStatus;
  items: RelatedCompanyEntry[];
};
```

- [ ] **Step 2: `identity-card.tsx` (exemplo do padrão)**

```tsx
// components/antifraude/identity-card.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { IdentityCardProps } from './types';

export function IdentityCard({ status, nome, dataNascimento, situacaoCadastral }: IdentityCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Identidade</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {status === 'pending' || status === 'running' ? (
          <>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </>
        ) : status === 'error' ? (
          <p className="text-muted-foreground">Indisponível.</p>
        ) : status === 'missing' ? (
          <p className="text-muted-foreground">Sem dados.</p>
        ) : (
          <>
            <div><span className="text-muted-foreground">Nome:</span> {nome ?? '—'}</div>
            <div><span className="text-muted-foreground">Nascimento:</span> {dataNascimento ?? '—'}</div>
            <div><span className="text-muted-foreground">Situação:</span> {situacaoCadastral ?? '—'}</div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Repetir padrão para `pep-card.tsx`, `media-card.tsx`, `restrictions-card.tsx`**

`pep-card.tsx`:
```tsx
// components/antifraude/pep-card.tsx
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { PepCardProps } from './types';

export function PepCard({ status, currentlyPEP, currentlySanctioned, historicoCount }: PepCardProps) {
  const skeleton = status === 'pending' || status === 'running';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">PEP / Sanções</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {skeleton ? (
          <><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-1/3" /></>
        ) : status === 'error' ? (
          <p className="text-muted-foreground">Indisponível.</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Sancionado:</span>
              {currentlySanctioned ? <Badge variant="destructive">Sim</Badge> : <Badge variant="secondary">Não</Badge>}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">PEP:</span>
              {currentlyPEP ? <Badge variant="destructive">Sim</Badge> : <Badge variant="secondary">Não</Badge>}
            </div>
            <div><span className="text-muted-foreground">Histórico:</span> {historicoCount ?? 0}</div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

`media-card.tsx`:
```tsx
// components/antifraude/media-card.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { MediaCardProps } from './types';

export function MediaCard({ status, mencoes, itens }: MediaCardProps) {
  const skeleton = status === 'pending' || status === 'running';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mídia negativa</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {skeleton ? (
          <Skeleton className="h-4 w-1/3" />
        ) : status === 'error' ? (
          <p className="text-muted-foreground">Indisponível.</p>
        ) : (
          <>
            <div>{mencoes ?? 0} menções</div>
            {itens?.slice(0, 5).map((it, idx) => (
              <div key={idx} className="border-t pt-2">
                <div className="font-medium">{it.titulo}</div>
                {it.data ? <div className="text-muted-foreground text-xs">{it.data}</div> : null}
              </div>
            )) ?? null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

`restrictions-card.tsx`:
```tsx
// components/antifraude/restrictions-card.tsx
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { RestrictionsCardProps } from './types';

export function RestrictionsCard({ status, apostasImpedido }: RestrictionsCardProps) {
  const skeleton = status === 'pending' || status === 'running';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Restrições</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {skeleton ? <Skeleton className="h-4 w-1/3" /> :
          status === 'error' ? <p className="text-muted-foreground">Indisponível.</p> :
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Apostas:</span>
            {apostasImpedido ? <Badge variant="destructive">Impedido</Badge> : <Badge variant="secondary">Sem restrição</Badge>}
          </div>}
      </CardContent>
    </Card>
  );
}
```

`related-companies.tsx`:
```tsx
// components/antifraude/related-companies.tsx
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { mask as maskCnpj } from '@/lib/validators/cnpj';
import type { RelatedCompaniesProps } from './types';

export function RelatedCompanies({ status, items }: RelatedCompaniesProps) {
  const skeleton = status === 'pending' || status === 'running';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Empresas relacionadas ({items.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {skeleton ? (
          <><Skeleton className="h-5 w-3/4" /><Skeleton className="h-5 w-2/3" /></>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground">Nenhuma empresa vinculada.</p>
        ) : (
          items.map((c) => (
            <div key={c.cnpj} className="border-t pt-2 first:border-t-0 first:pt-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{c.razaoSocial ?? 'Empresa'}</span>
                <span className="text-muted-foreground">{maskCnpj(c.cnpj)}</span>
                {c.vinculo ? <Badge variant="outline">{c.vinculo}</Badge> : null}
                {!c.ativo ? <Badge variant="secondary">encerrado</Badge> : null}
              </div>
              {c.hop2 ? (
                <div className="text-xs text-muted-foreground mt-1 flex gap-3 flex-wrap">
                  {c.hop2.situacaoCadastral ? <span>Situação: {c.hop2.situacaoCadastral}</span> : null}
                  {typeof c.hop2.capitalSocial === 'number' ? <span>Capital: R$ {c.hop2.capitalSocial.toLocaleString('pt-BR')}</span> : null}
                  {c.hop2.sancionado ? <Badge variant="destructive">sancionada</Badge> : null}
                  {c.hop2.sociosCpfHashes?.length ? <span>{c.hop2.sociosCpfHashes.length} sócios</span> : null}
                </div>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Lint + typecheck**

Run: `pnpm typecheck && pnpm lint:fix`

- [ ] **Step 5: Commit**

```bash
git add components/antifraude/
git commit -m "feat(ui): antifraude card components (identity, pep, media, restrictions, related)"
```

---

### Task H2: Server-side data loader e render em `/search/result/[hash]`

**Files:**
- Create: `lib/netrin/result-loader.ts`
- Modify: `app/(app)/search/result/[hash]/page.tsx`

- [ ] **Step 1: Loader (Server Component-friendly, decifra cache)**

```ts
// lib/netrin/result-loader.ts
import 'server-only';
import { decryptNetrinText } from '@/lib/crypto/vault';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import type { NetrinCompositePayload, NetrinDocumentType } from './types';
import { extractPivotCnpjs } from './parsers/pivot-cnpjs';

export type LoadedJob = {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'partial' | 'failed';
  hop1_status: string | null;
  hop2_total: number; hop2_done: number;
  hop3_total: number; hop3_done: number;
  started_at: string; finished_at: string | null; error: string | null;
};

export type LoadedCall = {
  hop: 1 | 2 | 3;
  document_hash: string;
  document_type: NetrinDocumentType;
  status: 'pending' | 'running' | 'success' | 'error' | 'cache_hit';
  cached: boolean;
  fetched_at: string | null;
  error: string | null;
};

export type LoadedPayloads = {
  hop1: NetrinCompositePayload | null;
  byCnpj: Record<string, NetrinCompositePayload>;
  byCpf: Record<string, NetrinCompositePayload>;
};

export async function loadEnrichmentForRoot(
  admin: SupabaseClient<Database>,
  args: { userId: string; rootHash: string; documentRaw: string; rootType: NetrinDocumentType },
): Promise<{ job: LoadedJob | null; calls: LoadedCall[]; payloads: LoadedPayloads } | null> {
  const { data: jobRow } = await admin
    .from('enrichment_jobs')
    .select('id, status, hop1_status, hop2_total, hop2_done, hop3_total, hop3_done, started_at, finished_at, error')
    .eq('user_id', args.userId)
    .eq('root_hash', args.rootHash)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle<LoadedJob>();

  if (!jobRow) return null;

  const { data: callsRows } = await admin
    .from('enrichment_job_calls')
    .select('hop, document_hash, document_type, status, cached, fetched_at, error')
    .eq('job_id', jobRow.id)
    .order('created_at', { ascending: true })
    .returns<LoadedCall[]>();

  const calls = callsRows ?? [];

  const payloads: LoadedPayloads = { hop1: null, byCnpj: {}, byCpf: {} };

  // For each successful call, fetch the cache row and decrypt.
  const hashes = Array.from(new Set(calls.filter((c) => c.status !== 'error').map((c) => c.document_hash)));
  if (hashes.length > 0) {
    const { data: cacheRows } = await admin
      .from('netrin_cache')
      .select('document_hash, document_type, encrypted_payload')
      .in('document_hash', hashes)
      .returns<{ document_hash: string; document_type: NetrinDocumentType; encrypted_payload: string }[]>();

    for (const row of cacheRows ?? []) {
      try {
        const plaintext = await decryptNetrinText(admin, row.encrypted_payload);
        const payload = JSON.parse(plaintext) as NetrinCompositePayload;
        if (row.document_hash === args.rootHash && args.rootType === 'cpf') {
          payloads.hop1 = payload;
        }
        if (row.document_type === 'cnpj') {
          // we need raw cnpj to key by — but cache stores only the hash. Re-derive via
          // Hop1 pivots if available.
          // Strategy: read it later from hop1Payload.empresas-relacionadas-cpf.
          // For now, store by hash too.
          payloads.byCnpj[row.document_hash] = payload;
        } else {
          payloads.byCpf[row.document_hash] = payload;
        }
      } catch (e) {
        console.warn('decrypt cache row failed:', e);
      }
    }
  }

  return { job: jobRow, calls, payloads };
}

export function pivotCnpjsFromHop1(payload: NetrinCompositePayload | null): string[] {
  return payload ? extractPivotCnpjs(payload) : [];
}
```

- [ ] **Step 2: Atualizar `app/(app)/search/result/[hash]/page.tsx`**

Read the existing file first:

Run: `cat 'app/(app)/search/result/[hash]/page.tsx'`

Adicione, depois do bloco que renderiza o cabeçalho e antes da lista de processos:

```tsx
{/* near top of page.tsx — imports */}
import { loadEnrichmentForRoot, pivotCnpjsFromHop1 } from '@/lib/netrin/result-loader';
import { hashDocument } from '@/lib/hash';
import { IdentityCard } from '@/components/antifraude/identity-card';
import { PepCard } from '@/components/antifraude/pep-card';
import { MediaCard } from '@/components/antifraude/media-card';
import { RestrictionsCard } from '@/components/antifraude/restrictions-card';
import { RelatedCompanies } from '@/components/antifraude/related-companies';
import { EnrichmentRealtime } from '@/components/antifraude/enrichment-realtime';
import { createAdminClient } from '@/lib/supabase/admin';
```

Substituir o bloco que renderiza só Predictus pelo seguinte (mantendo a lista de processos abaixo):

```tsx
const admin = createAdminClient();
const enrichment = await loadEnrichmentForRoot(admin, {
  userId: user.id,
  rootHash: hash,
  documentRaw,            // existing in scope (decrypted from search row)
  rootType,               // 'cpf' or 'cnpj' inferred earlier
});

const job = enrichment?.job;
const hop1Payload = enrichment?.payloads.hop1 ?? null;
const hop1 = hop1Payload as (Record<string, unknown> | null) ?? null;

const identity = (hop1?.['esp-cpf'] as Record<string, unknown> | undefined) ?? null;
const pep = (hop1?.['pep-kyc-cpf'] as Record<string, unknown> | undefined) ?? null;
const media = (hop1?.['midias-consolidado'] as Record<string, unknown> | undefined) ?? null;
const apostas = (hop1?.['pessoas-impedidas-apostar'] as Record<string, unknown> | undefined) ?? null;

const identityStatus = job?.hop1_status === 'success' || job?.hop1_status === 'cache_hit'
  ? 'success'
  : job?.hop1_status === 'error' ? 'error'
  : job ? 'running' : 'missing';

// derive related companies items
const cnpjPivots = pivotCnpjsFromHop1(hop1Payload);
const relatedItems = cnpjPivots.map((cnpj) => {
  const negocios = (hop1Payload?.['empresas-relacionadas-cpf'] as Record<string, unknown> | undefined)
    ?.['negociosRelacionados'] as unknown;
  const found = Array.isArray(negocios)
    ? (negocios as Record<string, unknown>[]).find((n) => typeof n.cnpj === 'string' && (n.cnpj as string).replace(/\D/g, '') === cnpj)
    : undefined;
  const hop2Payload = enrichment?.payloads.byCnpj[hashDocument('cnpj', cnpj)];
  const esp = hop2Payload?.['esp-cnpj-completo'] as Record<string, unknown> | undefined;
  const pep2 = hop2Payload?.['pep-kyc-cnpj'] as Record<string, unknown> | undefined;
  return {
    cnpj,
    razaoSocial: typeof found?.razaoSocial === 'string' ? found?.razaoSocial : (typeof esp?.razaoSocial === 'string' ? esp?.razaoSocial : undefined),
    vinculo: typeof found?.tipoVinculo === 'string' ? (found.tipoVinculo as string) : undefined,
    ativo: typeof found?.dataFimRelacionamento !== 'string' || found.dataFimRelacionamento === '9999-12-31',
    dataInicio: typeof found?.dataInicioRelacionamento === 'string' ? (found.dataInicioRelacionamento as string) : undefined,
    dataFim: typeof found?.dataFimRelacionamento === 'string' ? (found.dataFimRelacionamento as string) : undefined,
    hop2: hop2Payload ? {
      situacaoCadastral: typeof esp?.situacaoCadastral === 'string' ? esp?.situacaoCadastral : undefined,
      capitalSocial: typeof esp?.capitalSocial === 'number' ? esp?.capitalSocial : undefined,
      sancionado: pep2?.currentlySanctioned === true || pep2?.currentlySanctioned === 'Sim',
    } : undefined,
  };
});
```

Render block:

```tsx
{job ? (
  <section className="space-y-4">
    <div className="flex items-center gap-3">
      <h2 className="text-lg font-semibold">Antifraude</h2>
      <span className="text-sm text-muted-foreground">
        {job.status === 'completed' ? 'completo' :
         job.status === 'partial' ? 'parcial' :
         job.status === 'failed' ? `falhou${job.error ? `: ${job.error}` : ''}` :
         `enriquecendo… ${job.hop2_done}/${job.hop2_total} empresas, ${job.hop3_done}/${job.hop3_total} sócios`}
      </span>
    </div>
    <EnrichmentRealtime jobId={job.id} />
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <IdentityCard
        status={identityStatus}
        nome={typeof identity?.nome === 'string' ? identity.nome : undefined}
        dataNascimento={typeof identity?.dataNascimento === 'string' ? identity.dataNascimento : undefined}
        situacaoCadastral={typeof identity?.situacaoCadastral === 'string' ? identity.situacaoCadastral : undefined}
      />
      <PepCard
        status={identityStatus}
        currentlyPEP={pep?.currentlyPEP === true || pep?.currentlyPEP === 'Sim'}
        currentlySanctioned={pep?.currentlySanctioned === true || pep?.currentlySanctioned === 'Sim'}
        historicoCount={typeof pep?.historicoCount === 'number' ? pep.historicoCount as number : undefined}
      />
      <MediaCard
        status={identityStatus}
        mencoes={typeof media?.totalMencoes === 'number' ? media.totalMencoes as number : undefined}
      />
    </div>
    <RestrictionsCard
      status={identityStatus}
      apostasImpedido={apostas?.impedido === true || apostas?.impedido === 'Sim'}
    />
    <RelatedCompanies status={identityStatus} items={relatedItems} />
  </section>
) : null}
```

- [ ] **Step 3: Lint + build**

Run: `pnpm lint:fix && pnpm typecheck && pnpm build`

- [ ] **Step 4: Commit**

```bash
git add lib/netrin/result-loader.ts 'app/(app)/search/result/[hash]/page.tsx'
git commit -m "feat(ui): render antifraude cards on search result page"
```

---

### Task H3: Hook Realtime `EnrichmentRealtime`

**Files:**
- Create: `components/antifraude/enrichment-realtime.tsx`

- [ ] **Step 1: Implementar como Client Component**

```tsx
// components/antifraude/enrichment-realtime.tsx
'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function EnrichmentRealtime({ jobId }: { jobId: string }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`enrichment:${jobId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'enrichment_jobs', filter: `id=eq.${jobId}` },
        () => router.refresh(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'enrichment_job_calls', filter: `job_id=eq.${jobId}` },
        () => router.refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [jobId, router]);
  return null;
}
```

- [ ] **Step 2: Commit**

```bash
pnpm typecheck && pnpm lint:fix
git add components/antifraude/enrichment-realtime.tsx
git commit -m "feat(ui): EnrichmentRealtime client hook revalidates on job/call changes"
```

---

### Task H4: Grafo — toggle `Societário` + visual de `corporate_relation`

**Files:**
- Modify: `app/(app)/network/[hash]/page.tsx` (e/ou seu client component)

- [ ] **Step 1: Inspecionar página atual**

Run: `cat 'app/(app)/network/[hash]/page.tsx'`
Run: `find components -path '*network*' -type f`

- [ ] **Step 2: Adicionar filtro de kind**

No componente cliente que renderiza o grafo, encontre o controle de "Tipos de relação" (já existe pra `co_party`, `client_lawyer`, `lawyer_lawyer`). Adicione:

```tsx
{/* dentro da sidebar de filtros */}
<label className="flex items-center gap-2">
  <input
    type="checkbox"
    checked={kindToggle.corporate_relation}
    onChange={(e) => setKindToggle((s) => ({ ...s, corporate_relation: e.target.checked }))}
  />
  Societário
</label>
```

Estado inicial: `{ co_party: true, client_lawyer: true, lawyer_lawyer: true, corporate_relation: true }`.

- [ ] **Step 3: Estilo distinto**

No render de edges (sigma.js / vis / d3 — adapte ao que está no projeto):

```ts
function edgeColor(kind: string): string {
  if (kind === 'corporate_relation') return '#1d4ed8'; // blue-700
  if (kind === 'client_lawyer') return '#0ea5e9';      // sky-500
  if (kind === 'lawyer_lawyer') return '#7c3aed';      // violet-600
  return '#94a3b8';                                     // slate-400 (co_party)
}
```

CNPJ nodes ganham shape distinto (quadrado) — depende do renderizador. Sigma.js: usar `type: 'square'` no `node`.

- [ ] **Step 4: Build smoke**

Run: `pnpm dev` e abrir `/network/<hash>` de um CPF com job de enriquecimento completo. Verificar:
- Toggle "Societário" liga/desliga arestas azuis.
- Nós CNPJ aparecem com shape distinta.
- Shortest path + filtros existentes continuam funcionando.

- [ ] **Step 5: Commit**

```bash
git add 'app/(app)/network/[hash]/page.tsx' components/network/
git commit -m "feat(graph-ui): toggle Societário + corporate edge color + CNPJ node shape"
```

---

## Fase I — Verificação final

### Task I1: Bateria completa + smoke

- [ ] **Step 1: Rodar suite completa**

Run: `pnpm test`
Expected: counter sobe ~40-60 vs baseline. 0 falhas.

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: 0 erros, 0 warnings novos.

- [ ] **Step 3: Lint estrito**

Run: `pnpm lint`
Expected: 0 erros, 0 warnings.

- [ ] **Step 4: Smoke manual (Docker local)**

Roteiro:
1. `pnpm exec supabase start && pnpm dev`
2. Login no `/login` com operador existente.
3. Buscar um CPF válido em `/search/person`.
4. Esperar a página `/search/result/[hash]` mostrar:
   - Lista de processos Predictus (igual hoje).
   - Banner "Antifraude — enriquecendo…" com contadores.
   - Cards skeleton populando progressivamente via Realtime.
5. Após o job completar, abrir `/network/[hash]`:
   - Toggle "Societário" presente.
   - Arestas azuis visíveis.
   - Nós CNPJ com shape distinta.
6. Em outra aba, abrir `/admin/audit` (se acesso admin) e verificar linhas `enrichment_call` por hop e document_hash.

- [ ] **Step 5: Verificar LGPD**

Run:
```bash
psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" -c \
"select column_name, data_type from information_schema.columns
 where table_name in ('enrichment_jobs','enrichment_job_calls','netrin_cache')
 order by table_name, ordinal_position;"
```
Expected: nenhuma coluna armazena CPF/CNPJ em cleartext. `netrin_cache.encrypted_payload` é `bytea`. `enrichment_job_calls` tem `document_hash` (não `document`).

- [ ] **Step 6: Commit de tag de conclusão**

```bash
git commit --allow-empty -m "chore(netrin): antifraude enrichment feature-complete"
```

---

## Auto-revisão do plano

| Item da spec | Tarefa(s) que implementam |
|---|---|
| Cache 30d encriptado por documento | A1, A2, B3 |
| `enrichment_jobs` único por root | A3 + E1 |
| `enrichment_job_calls` (1 row por chamada) | A3 + E1 |
| Vault key separada `netrin_cache_key` | A1, A2, B3 |
| Estender `audit_log.action` (`enrichment_call`) | A4, A6 |
| Estender `graph_edges.kind` (`corporate_relation`) | A4, D1 |
| `upsert_graph` polimórfico | A4 |
| Retention pg_cron + órfãos | A5 |
| Tipos TS para novas tabelas | A6 |
| Vars de env Netrin | A7 |
| Slugs vocab (HOP1/HOP2/HOP3) | B1 |
| Client com retries, multi-`s=`, token em query | B2 |
| Cache helpers | B3 |
| Server-side factory | B4 |
| Pivot CNPJs | C1 |
| Pivot CPFs | C2 |
| Corporate edges + types | D1 |
| Graph bridge | D2 |
| Hops 1/2/3 | D3 |
| Job store + race | E1 |
| Processor com error isolation | E2 |
| Edge Function fire-and-forget | F1 |
| Trigger em searchPerson (CPF) | G1 |
| Trigger em searchByCnpj | G2 |
| Cards antifraude | H1 |
| Loader + render no /result | H2 |
| Realtime hook | H3 |
| Grafo: toggle + cor + shape | H4 |
| Smoke + LGPD final | I1 |

**Pontos a confirmar durante a implementação (já documentados na spec):**
- Nome exato do query param do token Netrin (`?token=`, `?apikey=`, etc.).
- `midias-consolidado` aceita `cnpj=` (Hop 2)? Se não, remover do bundle.
- Shape exato das chaves dos slugs Netrin — fixtures em `parsers/*.test.ts` se baseiam na descrição da doc; após primeira chamada real, atualizar fixtures e parsers se necessário.
