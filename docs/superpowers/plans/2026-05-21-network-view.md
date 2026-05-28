# Network View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared graph of CPF/CNPJ/lawyer nodes derived from every Predictus response, exposed at `/network/[hash]` with React Flow.

**Architecture:** Extraction runs as a pure function inside `lib/predictus/cache.ts:setCachedResults`, so both single search and bulk processing feed the same `graph_nodes`/`graph_edges` tables transparently. Labels are encrypted via a dedicated Vault key (`graph_label_key`) and decrypted only in Server Actions. The read path is one SQL roundtrip + per-row decrypt; the UI is a Next.js route gated by the new `search_network` permission.

**Tech Stack:** Next.js 16 App Router, React 19 + TypeScript strict, Supabase Postgres 16 (Vault, RLS, pgcrypto), Vitest, React Flow.

**Spec:** `docs/superpowers/specs/2026-05-21-network-view-design.md`

---

## File Structure

```
supabase/migrations/
├── 20260521130000_graph_schema.sql                 (NEW — nodes + edges + RLS + audit/perm CHECK)
├── 20260521130100_graph_label_crypto.sql           (NEW — encrypt/decrypt RPC bound to graph_label_key)
└── 20260521130200_upsert_graph_rpc.sql             (NEW — upsert_graph(nodes_in jsonb, edges_in jsonb))

scripts/
└── bootstrap-vault.sql                              (MODIFIED — provisions graph_label_key)

lib/
├── hash.ts                                          (MODIFIED — accept 'lawyer' prefix)
├── hash.test.ts                                     (MODIFIED — lawyer cases)
├── audit.ts                                         (MODIFIED — new action union)
├── auth/permissions.ts                              (MODIFIED — Service union + ALL_SERVICES)
├── auth/permissions.test.ts                         (MODIFIED — coverage for search_network)
├── supabase/types.ts                                (MODIFIED — Database extended)
├── predictus/cache.ts                               (MODIFIED — calls extractGraph+upsertGraph)
├── predictus/cache.test.ts                          (MODIFIED — verifies graph hooks)
└── graph/
    ├── types.ts                                     (NEW — shared types)
    ├── label-crypto.ts                              (NEW — encrypt/decrypt graph labels)
    ├── label-crypto.test.ts                         (NEW)
    ├── extractor.ts                                 (NEW — pure extraction)
    ├── extractor.test.ts                            (NEW)
    ├── writer.ts                                    (NEW — upsert via RPC)
    └── writer.test.ts                               (NEW)

app/(app)/
├── search/search-client.tsx                         (MODIFIED — "Ver rede" CTA)
└── network/[hash]/
    ├── page.tsx                                     (NEW — Server Component, perm gate)
    ├── actions.ts                                   (NEW — getSubgraph, expandNode)
    ├── network-canvas.tsx                           (NEW — React Flow client component)
    ├── node-detail-panel.tsx                        (NEW — side panel)
    └── network-header.tsx                           (NEW — search input + title)

package.json                                         (MODIFIED — reactflow dep)
```

Each task below is self-contained and ends in a commit. Tasks are ordered so each one builds on green code from the previous.

---

## Task 1: Add `lawyer` type prefix to hashDocument

**Files:**
- Modify: `lib/hash.ts`
- Test: `lib/hash.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside `lib/hash.test.ts` (existing file). The lawyer key format is `'<UF>-<numero>'`, normalized to uppercase + digits.

```ts
describe('hashDocument lawyer', () => {
  it('hashes a lawyer key with UF + numero', () => {
    const a = hashDocument('lawyer', 'SP-12345');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is case-insensitive on UF', () => {
    expect(hashDocument('lawyer', 'sp-12345')).toBe(hashDocument('lawyer', 'SP-12345'));
  });

  it('trims surrounding whitespace', () => {
    expect(hashDocument('lawyer', '  SP-12345  ')).toBe(hashDocument('lawyer', 'SP-12345'));
  });

  it('differs from CPF/CNPJ hashes with the same digits', () => {
    // Prefix isolation: even if numero happened to be a 11-digit string, the
    // result must differ from a CPF hash of those same digits.
    const lawyerHash = hashDocument('lawyer', 'SP-12345678901');
    const cpfHash = hashDocument('cpf', '12345678901');
    expect(lawyerHash).not.toBe(cpfHash);
  });

  it('rejects malformed lawyer keys', () => {
    expect(() => hashDocument('lawyer', '')).toThrow();
    expect(() => hashDocument('lawyer', 'SP')).toThrow();         // missing numero
    expect(() => hashDocument('lawyer', '-12345')).toThrow();     // missing UF
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm test -- lib/hash.test.ts
```

Expected: failures because `'lawyer'` isn't in `HashDocumentType` (TS error) and `normalizeForType` doesn't handle it.

- [ ] **Step 3: Extend `lib/hash.ts`**

Replace the file with:

```ts
import { createHash } from 'node:crypto';
import { normalize as normalizeCnpj } from '@/lib/validators/cnpj';
import { normalize as normalizeCpf } from '@/lib/validators/cpf';

export type HashDocumentType = 'cpf' | 'cnpj' | 'name' | 'lawyer';

export function normalizeNameForHash(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toUpperCase();
}

function normalizeLawyerKey(value: string): string {
  const trimmed = value.trim().toUpperCase();
  const match = trimmed.match(/^([A-Z]{2})-(\d+)$/);
  if (!match) {
    throw new Error("Cannot hash lawyer: expected '<UF>-<numero>'.");
  }
  return `${match[1]}-${match[2]}`;
}

function normalizeForType(type: HashDocumentType, value: string): string {
  switch (type) {
    case 'cpf': {
      const normalized = normalizeCpf(value);
      if (normalized.length !== 11) {
        throw new Error('Cannot hash CPF: input does not normalize to 11 digits.');
      }
      return normalized;
    }
    case 'cnpj': {
      const normalized = normalizeCnpj(value);
      if (normalized.length !== 14) {
        throw new Error('Cannot hash CNPJ: input does not normalize to 14 digits.');
      }
      return normalized;
    }
    case 'name': {
      const normalized = normalizeNameForHash(value);
      if (!normalized) {
        throw new Error('Cannot hash name: input normalizes to empty.');
      }
      return normalized;
    }
    case 'lawyer': {
      return normalizeLawyerKey(value);
    }
  }
}

export function hashDocument(type: HashDocumentType, value: string): string {
  if (!value) {
    throw new Error(`Cannot hash ${type}: empty input.`);
  }
  const normalized = normalizeForType(type, value);
  return createHash('sha256').update(`${type}:${normalized}`).digest('hex');
}
```

- [ ] **Step 4: Verify all tests pass**

```
pnpm test -- lib/hash.test.ts
```

Expected: all green.

- [ ] **Step 5: Typecheck**

```
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```
git add lib/hash.ts lib/hash.test.ts
git commit -m "feat(hash): support 'lawyer' type prefix for OAB-based identity"
```

---

## Task 2: Migration for graph schema, audit actions, and search_network permission

**Files:**
- Create: `supabase/migrations/20260521130000_graph_schema.sql`

This single migration creates the two graph tables, their indexes, RLS, and extends the existing `audit_log.action` and `user_service_permissions.service` CHECKs. Bundled because they're all read-only schema mutations with no app dependency between them.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260521130000_graph_schema.sql`:

```sql
-- ============================================================================
-- Graph view: graph_nodes / graph_edges + audit and permission extensions
-- ============================================================================

-- public.graph_nodes ---------------------------------------------------------
create table public.graph_nodes (
  node_hash       text primary key,
  node_type       text not null check (node_type in ('cpf','cnpj','lawyer')),
  encrypted_label bytea not null,
  masked_preview  text not null,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);

comment on table public.graph_nodes is
  'Shared graph of entities derived from Predictus payloads. node_hash reuses '
  'hashDocument(cpf|cnpj|lawyer, value). encrypted_label is the JSON shape '
  '{name?, document?, oab?} encrypted via graph_label_key.';

-- public.graph_edges ---------------------------------------------------------
create table public.graph_edges (
  id              uuid primary key default gen_random_uuid(),
  source_hash     text not null references public.graph_nodes(node_hash),
  target_hash     text not null references public.graph_nodes(node_hash),
  kind            text not null check (kind in ('co_party','client_lawyer','lawyer_lawyer')),
  evidence        jsonb not null default '{}'::jsonb,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  unique (source_hash, target_hash, kind)
);

create index graph_edges_source_idx on public.graph_edges (source_hash);
create index graph_edges_target_idx on public.graph_edges (target_hash);

comment on table public.graph_edges is
  'Inferred relationships. co_party and lawyer_lawyer are symmetric: stored once '
  'with source_hash < target_hash. client_lawyer is directional (parte -> advogado).';

-- RLS ------------------------------------------------------------------------
alter table public.graph_nodes enable row level security;
alter table public.graph_edges enable row level security;

-- Authenticated operators can read; writes are service_role only.
create policy graph_nodes_read_authenticated on public.graph_nodes
  for select using (auth.role() = 'authenticated');

create policy graph_edges_read_authenticated on public.graph_edges
  for select using (auth.role() = 'authenticated');

-- Audit actions --------------------------------------------------------------
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in (
    'login','logout','search_single','search_bulk_item',
    'bulk_job_created','export_csv',
    'admin_user_created','admin_user_set_active',
    'admin_user_set_role','admin_user_permission_changed',
    'view_network','expand_network_node'
  ));

-- Service permission vocabulary ---------------------------------------------
alter table public.user_service_permissions drop constraint user_service_permissions_service_check;
alter table public.user_service_permissions add constraint user_service_permissions_service_check
  check (service in ('search_person','search_company','search_bulk','search_network'));
```

- [ ] **Step 2: Reset local Supabase and verify the migration applies clean**

```
pnpm exec supabase db reset
```

Expected: all migrations apply with no errors. Note: this destroys local data.

- [ ] **Step 3: Sanity-check the schema with psql**

```
psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" -c "\d public.graph_nodes" -c "\d public.graph_edges"
```

Expected: both tables present, columns match, RLS enabled.

- [ ] **Step 4: Commit**

```
git add supabase/migrations/20260521130000_graph_schema.sql
git commit -m "feat(db): graph_nodes/graph_edges schema + audit and permission extensions"
```

---

## Task 3: Provision `graph_label_key` and add encrypt/decrypt RPCs

**Files:**
- Modify: `scripts/bootstrap-vault.sql`
- Create: `supabase/migrations/20260521130100_graph_label_crypto.sql`

- [ ] **Step 1: Extend `scripts/bootstrap-vault.sql`**

Open the file. After the `predictus_cache_key` block, append (same `if not exists` pattern):

```sql
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'graph_label_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'graph_label_key',
      'Encryption key for graph_nodes.encrypted_label'
    );
    raise notice 'graph_label_key created.';
  else
    raise notice 'graph_label_key already exists, skipping.';
  end if;
end
$$;
```

- [ ] **Step 2: Create the RPC migration**

Create `supabase/migrations/20260521130100_graph_label_crypto.sql`:

```sql
-- ============================================================================
-- Encryption helpers for graph_nodes.encrypted_label
-- Mirrors predictus_cache crypto helpers; bound to 'graph_label_key'.
-- ============================================================================

create or replace function public.encrypt_graph_label(plaintext text)
returns bytea
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  k text;
begin
  select decrypted_secret into k
  from vault.decrypted_secrets
  where name = 'graph_label_key'
  limit 1;

  if k is null then
    raise exception 'Vault secret graph_label_key not found';
  end if;

  return extensions.pgp_sym_encrypt(plaintext, k);
end;
$$;

create or replace function public.decrypt_graph_label(ciphertext bytea)
returns text
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  k text;
begin
  select decrypted_secret into k
  from vault.decrypted_secrets
  where name = 'graph_label_key'
  limit 1;

  if k is null then
    raise exception 'Vault secret graph_label_key not found';
  end if;

  return extensions.pgp_sym_decrypt(ciphertext, k);
end;
$$;

revoke all on function public.encrypt_graph_label(text) from public, anon, authenticated;
revoke all on function public.decrypt_graph_label(bytea) from public, anon, authenticated;
grant execute on function public.encrypt_graph_label(text) to service_role;
grant execute on function public.decrypt_graph_label(bytea) to service_role;
```

- [ ] **Step 3: Apply the migration and bootstrap the Vault**

```
pnpm exec supabase db reset
psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" -f scripts/bootstrap-vault.sql
```

Expected: notices say both `predictus_cache_key` and `graph_label_key` are present.

- [ ] **Step 4: Smoke-test the RPC roundtrip**

```
psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" \
  -c "select public.decrypt_graph_label(public.encrypt_graph_label('hello'));"
```

Expected: returns `hello`.

- [ ] **Step 5: Commit**

```
git add scripts/bootstrap-vault.sql supabase/migrations/20260521130100_graph_label_crypto.sql
git commit -m "feat(db): graph_label_key vault secret + encrypt/decrypt RPCs"
```

---

## Task 4: Extend `lib/supabase/types.ts` with new tables and RPCs

**Files:**
- Modify: `lib/supabase/types.ts`

- [ ] **Step 1: Add `graph_nodes` and `graph_edges` to `Database.public.Tables`**

Inside the `Tables` block (after `audit_log`), insert:

```ts
      graph_nodes: {
        Row: {
          node_hash: string;
          node_type: 'cpf' | 'cnpj' | 'lawyer';
          encrypted_label: string;
          masked_preview: string;
          first_seen_at: string;
          last_seen_at: string;
        };
        Insert: {
          node_hash: string;
          node_type: 'cpf' | 'cnpj' | 'lawyer';
          encrypted_label: string;
          masked_preview: string;
          first_seen_at?: string;
          last_seen_at?: string;
        };
        Update: {
          node_hash?: string;
          node_type?: 'cpf' | 'cnpj' | 'lawyer';
          encrypted_label?: string;
          masked_preview?: string;
          first_seen_at?: string;
          last_seen_at?: string;
        };
      };
      graph_edges: {
        Row: {
          id: string;
          source_hash: string;
          target_hash: string;
          kind: 'co_party' | 'client_lawyer' | 'lawyer_lawyer';
          evidence: Record<string, unknown>;
          first_seen_at: string;
          last_seen_at: string;
        };
        Insert: {
          id?: string;
          source_hash: string;
          target_hash: string;
          kind: 'co_party' | 'client_lawyer' | 'lawyer_lawyer';
          evidence?: Record<string, unknown>;
          first_seen_at?: string;
          last_seen_at?: string;
        };
        Update: {
          id?: string;
          source_hash?: string;
          target_hash?: string;
          kind?: 'co_party' | 'client_lawyer' | 'lawyer_lawyer';
          evidence?: Record<string, unknown>;
          first_seen_at?: string;
          last_seen_at?: string;
        };
      };
```

- [ ] **Step 2: Extend the `audit_log.action` union (Row + Insert + Update)**

In each of the three blocks (Row, Insert, Update), append `| 'view_network' | 'expand_network_node'` to the union of literal types.

- [ ] **Step 3: Extend the `user_service_permissions.service` union (Row + Insert + Update)**

Change every occurrence of `'search_person' | 'search_company' | 'search_bulk'` in this table block to `'search_person' | 'search_company' | 'search_bulk' | 'search_network'`.

- [ ] **Step 4: Add `Functions` for `encrypt_graph_label`, `decrypt_graph_label`, and `upsert_graph`**

Inside `Functions`, add:

```ts
      encrypt_graph_label: {
        Args: { plaintext: string };
        Returns: string;
      };
      decrypt_graph_label: {
        Args: { ciphertext: string };
        Returns: string;
      };
      upsert_graph: {
        Args: { nodes_in: unknown; edges_in: unknown };
        Returns: void;
      };
```

(`upsert_graph` is created in Task 8; declaring its type now is harmless.)

- [ ] **Step 5: Typecheck**

```
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```
git add lib/supabase/types.ts
git commit -m "feat(types): graph_nodes/graph_edges + new audit and permission values"
```

---

## Task 5: Create `lib/graph/types.ts` (shared types only)

**Files:**
- Create: `lib/graph/types.ts`

Types-only files do not require their own Vitest suite per the project convention; they are exercised by the modules that consume them.

- [ ] **Step 1: Write the types**

```ts
import type { PredictusProcess } from '@/lib/predictus/types';

export type NodeType = 'cpf' | 'cnpj' | 'lawyer';

export type EdgeKind = 'co_party' | 'client_lawyer' | 'lawyer_lawyer';

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

export type ExtractedEdge = {
  sourceHash: string;
  targetHash: string;
  kind: EdgeKind;
  evidence: { processNumber: string; samePolo: boolean | null };
};

// What the extractor returns. The writer collapses ExtractedEdge instances
// sharing (source, target, kind) into a single graph_edges row whose stored
// `evidence` jsonb is { processNumbers: string[], samePolo: ... , occurrences: n }.
export type ExtractedGraph = {
  nodes: ExtractedNode[];
  edges: ExtractedEdge[];
};

export type StoredEdgeEvidence = {
  processNumbers: string[];
  samePolo: boolean | null;
  occurrences: number;
};

export type ExtractGraphInput = {
  payload: PredictusProcess[];
  searchedHash: string;
};
```

- [ ] **Step 2: Typecheck**

```
pnpm typecheck
```

- [ ] **Step 3: Commit**

```
git add lib/graph/types.ts
git commit -m "feat(graph): shared types for nodes, edges, and extraction"
```

---

## Task 6: `lib/graph/label-crypto.ts` (TDD)

**Files:**
- Create: `lib/graph/label-crypto.ts`
- Create: `lib/graph/label-crypto.test.ts`

This module mirrors `lib/crypto/vault.ts` but binds to `encrypt_graph_label` / `decrypt_graph_label`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/graph/label-crypto.test.ts
import { describe, expect, it } from 'vitest';
import { decryptLabel, encryptLabel } from './label-crypto';

function buildFakeClient(opts: { encryptError?: string; decryptError?: string } = {}) {
  const calls: Array<{ name: string; params: unknown }> = [];
  return {
    calls,
    client: {
      rpc(name: string, params: Record<string, unknown>) {
        calls.push({ name, params });
        if (name === 'encrypt_graph_label') {
          if (opts.encryptError) {
            return Promise.resolve({ data: null, error: { message: opts.encryptError } });
          }
          return Promise.resolve({ data: `cipher:${params.plaintext}`, error: null });
        }
        if (name === 'decrypt_graph_label') {
          if (opts.decryptError) {
            return Promise.resolve({ data: null, error: { message: opts.decryptError } });
          }
          return Promise.resolve({
            data: String(params.ciphertext).replace(/^cipher:/, ''),
            error: null,
          });
        }
        throw new Error(`unexpected rpc: ${name}`);
      },
    },
  };
}

describe('encryptLabel', () => {
  it('calls encrypt_graph_label and returns ciphertext', async () => {
    const { client, calls } = buildFakeClient();
    const result = await encryptLabel(client as never, '{"name":"X"}');
    expect(result).toBe('cipher:{"name":"X"}');
    expect(calls).toEqual([{ name: 'encrypt_graph_label', params: { plaintext: '{"name":"X"}' } }]);
  });

  it('throws when the RPC fails', async () => {
    const { client } = buildFakeClient({ encryptError: 'vault key missing' });
    await expect(encryptLabel(client as never, 'x')).rejects.toThrow(/vault key missing/);
  });
});

describe('decryptLabel', () => {
  it('calls decrypt_graph_label and returns plaintext', async () => {
    const { client } = buildFakeClient();
    const result = await decryptLabel(client as never, 'cipher:{"name":"Y"}');
    expect(result).toBe('{"name":"Y"}');
  });

  it('throws when the RPC fails', async () => {
    const { client } = buildFakeClient({ decryptError: 'no secret' });
    await expect(decryptLabel(client as never, 'whatever')).rejects.toThrow(/no secret/);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```
pnpm test -- lib/graph/label-crypto.test.ts
```

Expected: fails (module missing).

- [ ] **Step 3: Implement the module**

```ts
// lib/graph/label-crypto.ts
import type { Database } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function encryptLabel(
  client: SupabaseClient<Database>,
  plaintext: string,
): Promise<string> {
  const { data, error } = await client.rpc(
    'encrypt_graph_label' as never,
    { plaintext } as never,
  );
  if (error) throw new Error(`encryptLabel failed: ${error.message}`);
  return data as unknown as string;
}

export async function decryptLabel(
  client: SupabaseClient<Database>,
  ciphertext: string,
): Promise<string> {
  const { data, error } = await client.rpc(
    'decrypt_graph_label' as never,
    { ciphertext } as never,
  );
  if (error) throw new Error(`decryptLabel failed: ${error.message}`);
  return data as unknown as string;
}
```

- [ ] **Step 4: Run tests until green**

```
pnpm test -- lib/graph/label-crypto.test.ts
```

- [ ] **Step 5: Typecheck and lint**

```
pnpm typecheck
pnpm lint:fix
```

- [ ] **Step 6: Commit**

```
git add lib/graph/label-crypto.ts lib/graph/label-crypto.test.ts
git commit -m "feat(graph): label-crypto module wraps encrypt/decrypt_graph_label RPCs"
```

---

## Task 7: `lib/graph/extractor.ts` (TDD — the pure-function core)

**Files:**
- Create: `lib/graph/extractor.ts`
- Create: `lib/graph/extractor.test.ts`

This is the largest task. The extractor is pure and gets one test per extraction rule from the spec.

- [ ] **Step 1: Write the failing test suite**

```ts
// lib/graph/extractor.test.ts
import { hashDocument } from '@/lib/hash';
import type { PredictusProcess } from '@/lib/predictus/types';
import { describe, expect, it } from 'vitest';
import { extractGraph } from './extractor';

const HASH_CPF_A = hashDocument('cpf', '11144477735');
const HASH_CPF_B = hashDocument('cpf', '52998224725');
const HASH_CNPJ = hashDocument('cnpj', '11222333000181');
const HASH_LAWYER_SP = hashDocument('lawyer', 'SP-12345');
const HASH_LAWYER_RJ = hashDocument('lawyer', 'RJ-99999');

function processWith(parts: unknown[], processNumber = 'P-1'): PredictusProcess {
  return { numeroProcessoUnico: processNumber, partes: parts };
}

describe('extractGraph', () => {
  it('returns empty result for empty payload', () => {
    const result = extractGraph({ payload: [], searchedHash: HASH_CPF_A });
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('emits one node for a parte with CPF, zero edges when alone', () => {
    const payload = [processWith([{ tipo: 'AUTOR', nome: 'Alice', cpf: '11144477735' }])];
    const { nodes, edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ nodeHash: HASH_CPF_A, nodeType: 'cpf' });
    expect(nodes[0]?.label.name).toBe('Alice');
    expect(edges).toEqual([]);
  });

  it('emits a co_party edge between two partes in the same process', () => {
    const payload = [
      processWith([
        { tipo: 'AUTOR', nome: 'Alice', cpf: '11144477735' },
        { tipo: 'RÉU', nome: 'Beto', cpf: '52998224725' },
      ]),
    ];
    const { nodes, edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    expect(nodes.map((n) => n.nodeHash).sort()).toEqual([HASH_CPF_A, HASH_CPF_B].sort());
    expect(edges).toHaveLength(1);
    expect(edges[0]?.kind).toBe('co_party');
    expect(edges[0]?.evidence.samePolo).toBe(false);
    // Symmetric ordering: source < target lexicographically
    expect((edges[0]?.sourceHash ?? '') < (edges[0]?.targetHash ?? '')).toBe(true);
  });

  it('marks samePolo=true when both partes share the same tipo', () => {
    const payload = [
      processWith([
        { tipo: 'AUTOR', nome: 'A', cpf: '11144477735' },
        { tipo: 'AUTOR', nome: 'B', cpf: '52998224725' },
      ]),
    ];
    const { edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    expect(edges[0]?.evidence.samePolo).toBe(true);
  });

  it('marks samePolo=null when either tipo is missing', () => {
    const payload = [
      processWith([
        { nome: 'A', cpf: '11144477735' },
        { tipo: 'RÉU', nome: 'B', cpf: '52998224725' },
      ]),
    ];
    const { edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    expect(edges[0]?.evidence.samePolo).toBeNull();
  });

  it('treats a parte with CNPJ as nodeType cnpj', () => {
    const payload = [
      processWith([
        { tipo: 'AUTOR', nome: 'Alice', cpf: '11144477735' },
        { tipo: 'RÉU', nome: 'Acme', cnpj: '11222333000181' },
      ]),
    ];
    const { nodes } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    const cnpjNode = nodes.find((n) => n.nodeHash === HASH_CNPJ);
    expect(cnpjNode?.nodeType).toBe('cnpj');
  });

  it('discards partes without CPF or CNPJ', () => {
    const payload = [
      processWith([
        { tipo: 'AUTOR', nome: 'Alice', cpf: '11144477735' },
        { tipo: 'TESTEMUNHA', nome: 'Sem doc' },
      ]),
    ];
    const { nodes, edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    expect(nodes).toHaveLength(1);
    expect(edges).toEqual([]);
  });

  it('emits lawyer node and client_lawyer edge for valid advogado', () => {
    const payload = [
      processWith([
        {
          tipo: 'AUTOR',
          nome: 'Alice',
          cpf: '11144477735',
          advogados: [{ nome: 'Dr. Souza', oab: { uf: 'SP', numero: '12345' } }],
        },
      ]),
    ];
    const { nodes, edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    expect(nodes.map((n) => n.nodeHash).sort()).toEqual([HASH_CPF_A, HASH_LAWYER_SP].sort());
    expect(edges).toHaveLength(1);
    expect(edges[0]?.kind).toBe('client_lawyer');
    expect(edges[0]?.sourceHash).toBe(HASH_CPF_A);
    expect(edges[0]?.targetHash).toBe(HASH_LAWYER_SP);
  });

  it('discards advogados with malformed OAB', () => {
    const payload = [
      processWith([
        {
          tipo: 'AUTOR',
          nome: 'Alice',
          cpf: '11144477735',
          advogados: [
            { nome: 'No OAB' },
            { nome: 'Partial', oab: { uf: 'SP' } },
            { nome: 'Empty numero', oab: { uf: 'SP', numero: '' } },
          ],
        },
      ]),
    ];
    const { nodes, edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    expect(nodes.map((n) => n.nodeHash)).toEqual([HASH_CPF_A]);
    expect(edges).toEqual([]);
  });

  it('emits lawyer_lawyer edge between two advogados in the same process', () => {
    const payload = [
      processWith([
        {
          tipo: 'AUTOR',
          nome: 'Alice',
          cpf: '11144477735',
          advogados: [{ nome: 'Dr. Souza', oab: { uf: 'SP', numero: '12345' } }],
        },
        {
          tipo: 'RÉU',
          nome: 'Beto',
          cpf: '52998224725',
          advogados: [{ nome: 'Dra. Lima', oab: { uf: 'RJ', numero: '99999' } }],
        },
      ]),
    ];
    const { edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    const lawyerEdge = edges.find((e) => e.kind === 'lawyer_lawyer');
    expect(lawyerEdge).toBeDefined();
    expect([lawyerEdge?.sourceHash, lawyerEdge?.targetHash].sort()).toEqual(
      [HASH_LAWYER_SP, HASH_LAWYER_RJ].sort(),
    );
    expect((lawyerEdge?.sourceHash ?? '') < (lawyerEdge?.targetHash ?? '')).toBe(true);
  });

  it('does not emit self-edges', () => {
    // Two partes with the same CPF (data quirk in Predictus) — must not produce
    // a self-edge.
    const payload = [
      processWith([
        { tipo: 'AUTOR', nome: 'Alice', cpf: '11144477735' },
        { tipo: 'AUTOR', nome: 'Alice (dup)', cpf: '11144477735' },
      ]),
    ];
    const { edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    expect(edges).toEqual([]);
  });

  it('emits one ExtractedEdge per process observation (writer dedupes)', () => {
    const payload = [
      processWith(
        [
          { tipo: 'AUTOR', nome: 'A', cpf: '11144477735' },
          { tipo: 'RÉU', nome: 'B', cpf: '52998224725' },
        ],
        'P-1',
      ),
      processWith(
        [
          { tipo: 'AUTOR', nome: 'A', cpf: '11144477735' },
          { tipo: 'RÉU', nome: 'B', cpf: '52998224725' },
        ],
        'P-2',
      ),
    ];
    const { edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    const coParty = edges.filter((e) => e.kind === 'co_party');
    expect(coParty).toHaveLength(2);
    expect(coParty.map((e) => e.evidence.processNumber).sort()).toEqual(['P-1', 'P-2']);
  });

  it('skips advogados block when partes list is empty', () => {
    const payload = [processWith([])];
    const { nodes, edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```
pnpm test -- lib/graph/extractor.test.ts
```

Expected: fails because `./extractor` doesn't exist.

- [ ] **Step 3: Implement the extractor**

```ts
// lib/graph/extractor.ts
import { hashDocument } from '@/lib/hash';
import type { PredictusProcess } from '@/lib/predictus/types';
import { mask as maskCnpj } from '@/lib/validators/cnpj';
import { mask as maskCpf } from '@/lib/validators/cpf';
import type {
  ExtractGraphInput,
  ExtractedEdge,
  ExtractedGraph,
  ExtractedNode,
  GraphNodeLabel,
  NodeType,
} from './types';

type PartyShape = {
  tipo?: string;
  nome?: string;
  cpf?: string;
  cnpj?: string;
  advogados?: LawyerShape[];
};

type LawyerShape = {
  nome?: string;
  oab?: { uf?: string; numero?: string };
};

type PartyNodeInfo = {
  hash: string;
  type: NodeType;
  rawDoc: string;
  tipo: string | null;
};

type LawyerNodeInfo = {
  hash: string;
  uf: string;
  numero: string;
};

function maskLawyer(name: string | undefined, uf: string, numero: string): string {
  const first = (name ?? 'Advogado').split(/\s+/)[0] ?? 'Advogado';
  return `${first[0] ?? ''}. *** — OAB/${uf} ${numero}`;
}

function asPartyNode(parte: PartyShape): { info: PartyNodeInfo; node: ExtractedNode } | null {
  const cnpjRaw = typeof parte.cnpj === 'string' ? parte.cnpj.replace(/\D/g, '') : '';
  const cpfRaw = typeof parte.cpf === 'string' ? parte.cpf.replace(/\D/g, '') : '';
  if (cnpjRaw.length === 14) {
    const hash = hashDocument('cnpj', cnpjRaw);
    return {
      info: { hash, type: 'cnpj', rawDoc: cnpjRaw, tipo: parte.tipo?.trim() || null },
      node: {
        nodeHash: hash,
        nodeType: 'cnpj',
        label: { name: parte.nome, document: cnpjRaw },
        maskedPreview: `${(parte.nome ?? '').slice(0, 24)} — ${maskCnpj(cnpjRaw)}`,
      },
    };
  }
  if (cpfRaw.length === 11) {
    const hash = hashDocument('cpf', cpfRaw);
    return {
      info: { hash, type: 'cpf', rawDoc: cpfRaw, tipo: parte.tipo?.trim() || null },
      node: {
        nodeHash: hash,
        nodeType: 'cpf',
        label: { name: parte.nome, document: cpfRaw },
        maskedPreview: `${(parte.nome ?? '').slice(0, 24)} — ${maskCpf(cpfRaw)}`,
      },
    };
  }
  return null;
}

function asLawyerNode(adv: LawyerShape): { info: LawyerNodeInfo; node: ExtractedNode } | null {
  const uf = adv.oab?.uf?.trim().toUpperCase();
  const numero = adv.oab?.numero?.toString().trim();
  if (!uf || !numero || !/^[A-Z]{2}$/.test(uf) || !/^\d+$/.test(numero)) return null;
  const hash = hashDocument('lawyer', `${uf}-${numero}`);
  return {
    info: { hash, uf, numero },
    node: {
      nodeHash: hash,
      nodeType: 'lawyer',
      label: { name: adv.nome, oab: { uf, numero } },
      maskedPreview: maskLawyer(adv.nome, uf, numero),
    },
  };
}

function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function computeSamePolo(a: string | null, b: string | null): boolean | null {
  if (!a || !b) return null;
  return a === b;
}

export function extractGraph({ payload, searchedHash: _ }: ExtractGraphInput): ExtractedGraph {
  const nodeMap = new Map<string, ExtractedNode>();
  const edges: ExtractedEdge[] = [];

  for (const process of payload) {
    const processNumber = typeof process.numeroProcessoUnico === 'string'
      ? process.numeroProcessoUnico
      : '';
    const rawParties = Array.isArray(process.partes) ? process.partes : [];

    const partyEntries: Array<{ info: PartyNodeInfo; lawyerHashes: string[] }> = [];

    for (const parteUnknown of rawParties) {
      const parte = parteUnknown as PartyShape;
      const partyResult = asPartyNode(parte);
      if (!partyResult) continue;
      if (!nodeMap.has(partyResult.info.hash)) {
        nodeMap.set(partyResult.info.hash, partyResult.node);
      }

      const lawyerHashes: string[] = [];
      const rawAdvogados = Array.isArray(parte.advogados) ? parte.advogados : [];
      for (const advUnknown of rawAdvogados) {
        const advResult = asLawyerNode(advUnknown as LawyerShape);
        if (!advResult) continue;
        if (!nodeMap.has(advResult.info.hash)) {
          nodeMap.set(advResult.info.hash, advResult.node);
        }
        if (advResult.info.hash !== partyResult.info.hash) {
          edges.push({
            sourceHash: partyResult.info.hash,
            targetHash: advResult.info.hash,
            kind: 'client_lawyer',
            evidence: { processNumber, samePolo: null },
          });
        }
        lawyerHashes.push(advResult.info.hash);
      }
      partyEntries.push({ info: partyResult.info, lawyerHashes });
    }

    // co_party edges: every distinct pair of parties in this process
    for (let i = 0; i < partyEntries.length; i++) {
      for (let j = i + 1; j < partyEntries.length; j++) {
        const a = partyEntries[i]?.info;
        const b = partyEntries[j]?.info;
        if (!a || !b || a.hash === b.hash) continue;
        const [src, tgt] = orderedPair(a.hash, b.hash);
        edges.push({
          sourceHash: src,
          targetHash: tgt,
          kind: 'co_party',
          evidence: {
            processNumber,
            samePolo: computeSamePolo(a.tipo, b.tipo),
          },
        });
      }
    }

    // lawyer_lawyer edges: every distinct pair of advogados in this process
    const allLawyers = Array.from(
      new Set(partyEntries.flatMap((p) => p.lawyerHashes)),
    );
    for (let i = 0; i < allLawyers.length; i++) {
      for (let j = i + 1; j < allLawyers.length; j++) {
        const a = allLawyers[i];
        const b = allLawyers[j];
        if (!a || !b || a === b) continue;
        const [src, tgt] = orderedPair(a, b);
        edges.push({
          sourceHash: src,
          targetHash: tgt,
          kind: 'lawyer_lawyer',
          evidence: { processNumber, samePolo: null },
        });
      }
    }
  }

  return { nodes: Array.from(nodeMap.values()), edges };
}
```

- [ ] **Step 4: Iterate to green**

```
pnpm test -- lib/graph/extractor.test.ts
```

Expected: all green. If a test fails, fix and rerun.

- [ ] **Step 5: Typecheck and lint**

```
pnpm typecheck
pnpm lint:fix
```

- [ ] **Step 6: Commit**

```
git add lib/graph/extractor.ts lib/graph/extractor.test.ts
git commit -m "feat(graph): pure extractor turns Predictus payloads into nodes + edges"
```

---

## Task 8: Migration — `upsert_graph` RPC

**Files:**
- Create: `supabase/migrations/20260521130200_upsert_graph_rpc.sql`

The RPC takes a JSON array of nodes and a JSON array of edges (already serialised by the app) and performs the upserts atomically. Edges merge `process_numbers` (set union) and refresh `last_seen_at`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- upsert_graph: atomic write path used by lib/graph/writer.ts
-- nodes_in :  jsonb array of { node_hash, node_type, encrypted_label_b64, masked_preview }
-- edges_in :  jsonb array of { source_hash, target_hash, kind, process_number, same_polo }
--
-- Nodes are upserted first (so foreign keys hold). Edges are then upserted with
-- evidence merging done in plpgsql.
-- ============================================================================

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
  existing_evidence jsonb;
  process_numbers jsonb;
  same_polo_val jsonb;
  occurrences int;
begin
  -- Nodes ---------------------------------------------------------------------
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

  -- Edges ---------------------------------------------------------------------
  if jsonb_typeof(edges_in) = 'array' then
    for e in select * from jsonb_array_elements(edges_in) loop
      -- Read current evidence if the row exists
      select evidence into existing_evidence
      from public.graph_edges
      where source_hash = e->>'source_hash'
        and target_hash = e->>'target_hash'
        and kind        = e->>'kind';

      if existing_evidence is null then
        process_numbers := jsonb_build_array(e->>'process_number');
        occurrences := 1;
      else
        -- Set-union the process number
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

      insert into public.graph_edges (
        source_hash, target_hash, kind, evidence
      )
      values (
        e->>'source_hash',
        e->>'target_hash',
        e->>'kind',
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
    end loop;
  end if;
end;
$$;

revoke all on function public.upsert_graph(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_graph(jsonb, jsonb) to service_role;
```

- [ ] **Step 2: Apply and smoke-test**

```
pnpm exec supabase db reset
psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" -f scripts/bootstrap-vault.sql
```

Then exercise the RPC manually (substitute one CPF hash). The label encryption is done by the app — we feed a base64 blob:

```
psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" -c "
select public.upsert_graph(
  '[{\"node_hash\":\"a\",\"node_type\":\"cpf\",\"encrypted_label_b64\":\"\",\"masked_preview\":\"A\"},
    {\"node_hash\":\"b\",\"node_type\":\"cpf\",\"encrypted_label_b64\":\"\",\"masked_preview\":\"B\"}]'::jsonb,
  '[{\"source_hash\":\"a\",\"target_hash\":\"b\",\"kind\":\"co_party\",\"process_number\":\"P1\",\"same_polo\":false}]'::jsonb
);
select node_hash, node_type from public.graph_nodes;
select source_hash, target_hash, kind, evidence from public.graph_edges;
"
```

Expected: two nodes, one edge, `evidence` = `{processNumbers:["P1"], samePolo:false, occurrences:1}`. Re-running the same call should not duplicate `P1`.

- [ ] **Step 3: Commit**

```
git add supabase/migrations/20260521130200_upsert_graph_rpc.sql
git commit -m "feat(db): upsert_graph RPC with set-union evidence merge"
```

---

## Task 9: `lib/graph/writer.ts` (TDD)

**Files:**
- Create: `lib/graph/writer.ts`
- Create: `lib/graph/writer.test.ts`

The writer:
1. Encrypts each node's label JSON via `encryptLabel`.
2. Serialises the resulting bytea (Supabase JS returns it as `\x...` hex string when read; for write we hand-roll base64 → it's decoded inside the RPC).
3. Calls `upsert_graph` once with both arrays.

Because Supabase returns `encrypted_label` as `\x...` hex when selected, the writer takes a different path: it just sends base64 of the ciphertext, and the RPC decodes via `decode(... , 'base64')`. The app encrypts via the existing `encrypt_graph_label` RPC which returns a hex string; we convert hex → base64 before the upsert.

- [ ] **Step 1: Failing tests**

```ts
// lib/graph/writer.test.ts
import { describe, expect, it } from 'vitest';
import type { ExtractedEdge, ExtractedNode } from './types';
import { upsertGraph } from './writer';

type RpcCall = { name: string; params: unknown };

function buildFakeClient(opts: { encryptError?: string; upsertError?: string } = {}) {
  const calls: RpcCall[] = [];
  const client = {
    rpc(name: string, params: Record<string, unknown>) {
      calls.push({ name, params });
      if (name === 'encrypt_graph_label') {
        if (opts.encryptError) {
          return Promise.resolve({ data: null, error: { message: opts.encryptError } });
        }
        // Pretend the RPC returns a hex-encoded ciphertext of the plaintext bytes.
        const hex = Buffer.from(String(params.plaintext), 'utf8').toString('hex');
        return Promise.resolve({ data: `\\x${hex}`, error: null });
      }
      if (name === 'upsert_graph') {
        if (opts.upsertError) {
          return Promise.resolve({ data: null, error: { message: opts.upsertError } });
        }
        return Promise.resolve({ data: null, error: null });
      }
      throw new Error(`unexpected rpc: ${name}`);
    },
  };
  return { client, calls };
}

const NODE_A: ExtractedNode = {
  nodeHash: 'cpf:a',
  nodeType: 'cpf',
  label: { name: 'Alice', document: '11144477735' },
  maskedPreview: 'Alice — ***',
};

const NODE_B: ExtractedNode = {
  nodeHash: 'cpf:b',
  nodeType: 'cpf',
  label: { name: 'Beto', document: '52998224725' },
  maskedPreview: 'Beto — ***',
};

const EDGE: ExtractedEdge = {
  sourceHash: 'cpf:a',
  targetHash: 'cpf:b',
  kind: 'co_party',
  evidence: { processNumber: 'P-1', samePolo: false },
};

describe('upsertGraph', () => {
  it('encrypts every node label then calls upsert_graph once', async () => {
    const { client, calls } = buildFakeClient();
    await upsertGraph(client as never, [NODE_A, NODE_B], [EDGE]);

    const encryptCalls = calls.filter((c) => c.name === 'encrypt_graph_label');
    expect(encryptCalls).toHaveLength(2);
    expect(encryptCalls[0]?.params).toEqual({ plaintext: JSON.stringify(NODE_A.label) });

    const upsertCalls = calls.filter((c) => c.name === 'upsert_graph');
    expect(upsertCalls).toHaveLength(1);
    const params = upsertCalls[0]?.params as { nodes_in: unknown[]; edges_in: unknown[] };
    expect(Array.isArray(params.nodes_in)).toBe(true);
    expect(Array.isArray(params.edges_in)).toBe(true);
    expect(params.nodes_in).toHaveLength(2);
    expect(params.edges_in).toHaveLength(1);
    expect((params.nodes_in[0] as { node_hash: string }).node_hash).toBe('cpf:a');
    expect((params.nodes_in[0] as { encrypted_label_b64: string }).encrypted_label_b64).toMatch(
      /^[A-Za-z0-9+/=]+$/,
    );
  });

  it('does nothing when both arrays are empty', async () => {
    const { client, calls } = buildFakeClient();
    await upsertGraph(client as never, [], []);
    expect(calls).toEqual([]);
  });

  it('throws when label encryption fails', async () => {
    const { client } = buildFakeClient({ encryptError: 'vault' });
    await expect(upsertGraph(client as never, [NODE_A], [])).rejects.toThrow(/vault/);
  });

  it('throws when upsert_graph fails', async () => {
    const { client } = buildFakeClient({ upsertError: 'rls denied' });
    await expect(upsertGraph(client as never, [NODE_A], [])).rejects.toThrow(/rls denied/);
  });

  it('forwards same_polo and process_number on each edge', async () => {
    const { client, calls } = buildFakeClient();
    await upsertGraph(client as never, [NODE_A, NODE_B], [
      EDGE,
      { ...EDGE, evidence: { processNumber: 'P-2', samePolo: null } },
    ]);
    const upsert = calls.find((c) => c.name === 'upsert_graph');
    const params = upsert?.params as { edges_in: Array<Record<string, unknown>> };
    expect(params.edges_in[0]).toMatchObject({
      source_hash: 'cpf:a',
      target_hash: 'cpf:b',
      kind: 'co_party',
      process_number: 'P-1',
      same_polo: false,
    });
    expect(params.edges_in[1]).toMatchObject({
      process_number: 'P-2',
      same_polo: null,
    });
  });
});
```

- [ ] **Step 2: Run, verify failure**

```
pnpm test -- lib/graph/writer.test.ts
```

- [ ] **Step 3: Implement the writer**

```ts
// lib/graph/writer.ts
import type { Database } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptLabel } from './label-crypto';
import type { ExtractedEdge, ExtractedNode } from './types';

function hexCiphertextToBase64(hex: string): string {
  // Supabase returns bytea as the prefixed-hex string '\x<HEX>'. Strip the
  // prefix and re-encode as base64 for the upsert_graph RPC, which decodes
  // base64 internally.
  const cleaned = hex.startsWith('\\x') ? hex.slice(2) : hex;
  return Buffer.from(cleaned, 'hex').toString('base64');
}

export async function upsertGraph(
  client: SupabaseClient<Database>,
  nodes: ExtractedNode[],
  edges: ExtractedEdge[],
): Promise<void> {
  if (nodes.length === 0 && edges.length === 0) return;

  const nodes_in: Array<Record<string, string>> = [];
  for (const node of nodes) {
    const hexCipher = await encryptLabel(client, JSON.stringify(node.label));
    nodes_in.push({
      node_hash: node.nodeHash,
      node_type: node.nodeType,
      encrypted_label_b64: hexCiphertextToBase64(hexCipher),
      masked_preview: node.maskedPreview,
    });
  }

  const edges_in = edges.map((e) => ({
    source_hash: e.sourceHash,
    target_hash: e.targetHash,
    kind: e.kind,
    process_number: e.evidence.processNumber,
    same_polo: e.evidence.samePolo,
  }));

  const { error } = await client.rpc(
    'upsert_graph' as never,
    { nodes_in, edges_in } as never,
  );
  if (error) throw new Error(`upsertGraph failed: ${error.message}`);
}
```

- [ ] **Step 4: Iterate to green**

```
pnpm test -- lib/graph/writer.test.ts
```

- [ ] **Step 5: Typecheck and lint**

```
pnpm typecheck
pnpm lint:fix
```

- [ ] **Step 6: Commit**

```
git add lib/graph/writer.ts lib/graph/writer.test.ts
git commit -m "feat(graph): writer encrypts labels and calls upsert_graph atomically"
```

---

## Task 10: Wire extractor + writer into `setCachedResults`

**Files:**
- Modify: `lib/predictus/cache.ts`
- Modify: `lib/predictus/cache.test.ts`

- [ ] **Step 1: Extend `cache.test.ts` with a graph-hook test**

Add to `lib/predictus/cache.test.ts`. The fake client needs to also accept `encrypt_graph_label` and `upsert_graph`. Modify the existing `buildFakeClient` helper or add a new one. Simplest: add a new helper for cache+graph tests; do not regress the existing tests.

```ts
// Append at the bottom of lib/predictus/cache.test.ts
function buildGraphAwareClient() {
  const rpcCalls: Array<{ name: string; params: unknown }> = [];
  return {
    rpcCalls,
    client: {
      from(table: string) {
        if (table !== 'predictus_cache') throw new Error(`unexpected table: ${table}`);
        return {
          upsert(_values: unknown) {
            return Promise.resolve({ error: null });
          },
        };
      },
      rpc(name: string, params: Record<string, unknown>) {
        rpcCalls.push({ name, params });
        if (name === 'encrypt_payload') return Promise.resolve({ data: 'cipher', error: null });
        if (name === 'encrypt_graph_label') return Promise.resolve({ data: '\\x6869', error: null });
        if (name === 'upsert_graph') return Promise.resolve({ data: null, error: null });
        throw new Error(`unexpected rpc: ${name}`);
      },
    },
  };
}

describe('setCachedResults — graph hook', () => {
  it('calls upsert_graph after the cache upsert when payload yields nodes', async () => {
    const { client, rpcCalls } = buildGraphAwareClient();
    const payload = [
      {
        numeroProcessoUnico: 'P-1',
        partes: [
          { tipo: 'AUTOR', nome: 'Alice', cpf: '11144477735' },
          { tipo: 'RÉU', nome: 'Beto', cpf: '52998224725' },
        ],
      },
    ];
    await setCachedResults(client as never, 'hash-x', 'cpf', payload as never);

    const names = rpcCalls.map((c) => c.name);
    expect(names).toContain('encrypt_payload');
    expect(names).toContain('encrypt_graph_label');
    expect(names).toContain('upsert_graph');
  });

  it('does not call upsert_graph when payload has no extractable partes', async () => {
    const { client, rpcCalls } = buildGraphAwareClient();
    await setCachedResults(client as never, 'hash-empty', 'cpf', []);
    expect(rpcCalls.map((c) => c.name)).not.toContain('upsert_graph');
  });

  it('swallows graph errors and lets the cache write succeed', async () => {
    const rpcCalls: Array<{ name: string }> = [];
    const client = {
      from(_t: string) {
        return { upsert(_v: unknown) { return Promise.resolve({ error: null }); } };
      },
      rpc(name: string) {
        rpcCalls.push({ name });
        if (name === 'encrypt_payload') return Promise.resolve({ data: 'cipher', error: null });
        return Promise.resolve({ data: null, error: { message: 'boom' } });
      },
    };
    const payload = [{ numeroProcessoUnico: 'P-1', partes: [
      { tipo: 'AUTOR', nome: 'A', cpf: '11144477735' },
      { tipo: 'RÉU',  nome: 'B', cpf: '52998224725' },
    ]}];
    await expect(setCachedResults(client as never, 'h', 'cpf', payload as never)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
pnpm test -- lib/predictus/cache.test.ts
```

Expected: the new tests fail because `setCachedResults` doesn't call the graph functions yet.

- [ ] **Step 3: Modify `lib/predictus/cache.ts`**

At the bottom of `setCachedResults`, after the existing upsert and its error check, add:

```ts
  try {
    const { extractGraph } = await import('@/lib/graph/extractor');
    const { upsertGraph } = await import('@/lib/graph/writer');
    const { nodes, edges } = extractGraph({ payload: results, searchedHash: documentHash });
    if (nodes.length > 0) {
      await upsertGraph(client, nodes, edges);
    }
  } catch (e) {
    console.warn('graph upsert failed; cache write succeeded:', e);
  }
```

Static imports are also fine — pick whichever the project style prefers (existing `cache.ts` uses static imports; switch to static if you remove the dynamic form).

Static form:

```ts
// At top of cache.ts
import { extractGraph } from '@/lib/graph/extractor';
import { upsertGraph } from '@/lib/graph/writer';

// At bottom of setCachedResults
try {
  const { nodes, edges } = extractGraph({ payload: results, searchedHash: documentHash });
  if (nodes.length > 0) {
    await upsertGraph(client, nodes, edges);
  }
} catch (e) {
  console.warn('graph upsert failed; cache write succeeded:', e);
}
```

Use static imports.

- [ ] **Step 4: Run tests**

```
pnpm test -- lib/predictus/cache.test.ts
pnpm test
```

Expected: all green (157+ new tests).

- [ ] **Step 5: Typecheck and lint**

```
pnpm typecheck
pnpm lint:fix
```

- [ ] **Step 6: Commit**

```
git add lib/predictus/cache.ts lib/predictus/cache.test.ts
git commit -m "feat(graph): feed graph from setCachedResults — covers single + bulk"
```

---

## Task 11: Extend audit and permissions modules

**Files:**
- Modify: `lib/audit.ts`
- Modify: `lib/auth/permissions.ts`
- Modify: `lib/auth/permissions.test.ts`

- [ ] **Step 1: Extend `lib/audit.ts`**

Open the file and add `'view_network'` and `'expand_network_node'` to the `AuditAction` union (or whatever the local name for it is). The literal list must match the migration CHECK from Task 2.

- [ ] **Step 2: Extend `lib/auth/permissions.ts`**

Change the `Service` type and the `ALL_SERVICES` array:

```ts
export type Service = 'search_person' | 'search_company' | 'search_bulk' | 'search_network';

export const ALL_SERVICES: readonly Service[] = [
  'search_person',
  'search_company',
  'search_bulk',
  'search_network',
] as const;
```

- [ ] **Step 3: Extend the permissions test suite**

Add a test confirming that `requirePermission('search_network')` follows the same admin/operator semantics as the other services. The existing tests in `lib/auth/permissions.test.ts` are the template — copy a representative case and substitute `'search_network'`.

Example minimal addition:

```ts
it('grants admins search_network without an explicit row', async () => {
  // Reuse the existing admin-user fixture pattern in this file.
  // ...same setup as the existing 'admin bypasses' test...
  const user = await requirePermission('search_network');
  expect(user.role).toBe('admin');
});
```

- [ ] **Step 4: Run tests**

```
pnpm test -- lib/audit.test.ts lib/auth/permissions.test.ts
pnpm typecheck
pnpm lint:fix
```

- [ ] **Step 5: Commit**

```
git add lib/audit.ts lib/auth/permissions.ts lib/auth/permissions.test.ts
git commit -m "feat(auth/audit): add search_network permission and graph audit actions"
```

---

## Task 12: Install React Flow and scaffold the route

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`
- Create: `app/(app)/network/[hash]/page.tsx`
- Create: `app/(app)/network/[hash]/network-canvas.tsx`
- Create: `app/(app)/network/[hash]/actions.ts`

- [ ] **Step 1: Install React Flow**

```
pnpm add reactflow
```

- [ ] **Step 2: Create a stub `actions.ts`**

```ts
// app/(app)/network/[hash]/actions.ts
'use server';

import { requirePermission } from '@/lib/auth/permissions';
import type { EdgeKind, GraphNodeLabel, NodeType } from '@/lib/graph/types';

export type GraphNodeDto = {
  hash: string;
  type: NodeType;
  label: GraphNodeLabel;
  maskedPreview: string;
  inCache: boolean;
  lastSeenAt: string;
};

export type GraphEdgeDto = {
  source: string;
  target: string;
  kind: EdgeKind;
  evidence: { processNumbers: string[]; samePolo: boolean | null; occurrences: number };
  lastSeenAt: string;
};

export type SubgraphDto = {
  center: GraphNodeDto | null;
  neighbors: GraphNodeDto[];
  edges: GraphEdgeDto[];
};

export async function getSubgraph(_centerHash: string): Promise<SubgraphDto> {
  await requirePermission('search_network');
  // Implemented in Task 13.
  return { center: null, neighbors: [], edges: [] };
}
```

- [ ] **Step 3: Stub `network-canvas.tsx`**

```tsx
// app/(app)/network/[hash]/network-canvas.tsx
'use client';

import type { SubgraphDto } from './actions';

export function NetworkCanvas({ subgraph }: { subgraph: SubgraphDto }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
      Canvas em construção. {subgraph.neighbors.length} vizinhos carregados.
    </div>
  );
}
```

- [ ] **Step 4: `page.tsx` Server Component**

```tsx
// app/(app)/network/[hash]/page.tsx
import { requirePermission } from '@/lib/auth/permissions';
import { getSubgraph } from './actions';
import { NetworkCanvas } from './network-canvas';

export default async function NetworkPage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  await requirePermission('search_network');
  const { hash } = await params;
  const decoded = decodeURIComponent(hash);
  const subgraph = await getSubgraph(decoded);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Rede</h1>
      <NetworkCanvas subgraph={subgraph} />
    </div>
  );
}
```

- [ ] **Step 5: Build and smoke-test**

```
pnpm build
pnpm dev
```

Navigate to `/network/cpf%3Aabc`. Expected: 200 if logged-in admin (or operator with permission); 302 to `/access-denied` otherwise. The canvas shows "0 vizinhos".

- [ ] **Step 6: Commit**

```
git add package.json pnpm-lock.yaml app/\(app\)/network
git commit -m "feat(network): scaffold /network/[hash] route gated by search_network"
```

---

## Task 13: Implement `getSubgraph`

**Files:**
- Modify: `app/(app)/network/[hash]/actions.ts`

- [ ] **Step 1: Replace the stub with the full implementation**

```ts
'use server';

import { writeAuditLog, extractRequestContext } from '@/lib/audit';
import { decryptLabel } from '@/lib/graph/label-crypto';
import type { EdgeKind, GraphNodeLabel, NodeType, StoredEdgeEvidence } from '@/lib/graph/types';
import { requirePermission } from '@/lib/auth/permissions';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { headers } from 'next/headers';

export type GraphNodeDto = {
  hash: string;
  type: NodeType;
  label: GraphNodeLabel;
  maskedPreview: string;
  inCache: boolean;
  lastSeenAt: string;
};

export type GraphEdgeDto = {
  source: string;
  target: string;
  kind: EdgeKind;
  evidence: StoredEdgeEvidence;
  lastSeenAt: string;
};

export type SubgraphDto = {
  center: GraphNodeDto | null;
  neighbors: GraphNodeDto[];
  edges: GraphEdgeDto[];
};

type NodeRow = {
  node_hash: string;
  node_type: NodeType;
  encrypted_label: string;
  masked_preview: string;
  last_seen_at: string;
};

type EdgeRow = {
  source_hash: string;
  target_hash: string;
  kind: EdgeKind;
  evidence: StoredEdgeEvidence;
  last_seen_at: string;
};

async function rowToDto(
  admin: ReturnType<typeof createAdminClient>,
  row: NodeRow,
  cacheHashes: Set<string>,
): Promise<GraphNodeDto> {
  let label: GraphNodeLabel = {};
  try {
    const plaintext = await decryptLabel(admin, row.encrypted_label);
    label = JSON.parse(plaintext) as GraphNodeLabel;
  } catch (e) {
    console.warn('label decrypt failed; falling back to masked preview:', e);
  }
  return {
    hash: row.node_hash,
    type: row.node_type,
    label,
    maskedPreview: row.masked_preview,
    inCache: row.node_type !== 'lawyer' && cacheHashes.has(row.node_hash),
    lastSeenAt: row.last_seen_at,
  };
}

export async function getSubgraph(centerHash: string): Promise<SubgraphDto> {
  const user = await requirePermission('search_network');
  const admin = createAdminClient();
  const supabase = await createClient();

  const { data: centerRow } = await supabase
    .from('graph_nodes')
    .select('node_hash, node_type, encrypted_label, masked_preview, last_seen_at')
    .eq('node_hash', centerHash)
    .maybeSingle()
    .returns<NodeRow>();

  if (!centerRow) {
    await writeAuditLog(
      {
        userId: user.id,
        action: 'view_network',
        documentHash: centerHash,
        metadata: { neighbors_count: 0, found: false },
        ...extractRequestContext(await headers()),
      },
      admin,
      { allowFailure: true },
    );
    return { center: null, neighbors: [], edges: [] };
  }

  const { data: edgeRows } = await supabase
    .from('graph_edges')
    .select('source_hash, target_hash, kind, evidence, last_seen_at')
    .or(`source_hash.eq.${centerHash},target_hash.eq.${centerHash}`)
    .returns<EdgeRow[]>();

  const edges: EdgeRow[] = edgeRows ?? [];
  const neighborHashes = Array.from(
    new Set(
      edges
        .flatMap((e) => [e.source_hash, e.target_hash])
        .filter((h) => h !== centerHash),
    ),
  );

  const { data: neighborRows } =
    neighborHashes.length === 0
      ? { data: [] as NodeRow[] }
      : await supabase
          .from('graph_nodes')
          .select('node_hash, node_type, encrypted_label, masked_preview, last_seen_at')
          .in('node_hash', neighborHashes)
          .returns<NodeRow[]>();

  const hashesToCheckCache = [centerRow.node_hash, ...neighborHashes].filter(
    (h) => !h.startsWith('lawyer:'),
  );
  const nowIso = new Date().toISOString();
  const { data: cacheRows } =
    hashesToCheckCache.length === 0
      ? { data: [] as Array<{ document_hash: string }> }
      : await supabase
          .from('predictus_cache')
          .select('document_hash')
          .in('document_hash', hashesToCheckCache)
          .gt('expires_at', nowIso)
          .returns<Array<{ document_hash: string }>>();
  const cacheHashes = new Set((cacheRows ?? []).map((r) => r.document_hash));

  const center = await rowToDto(admin, centerRow, cacheHashes);
  const neighbors = await Promise.all(
    (neighborRows ?? []).map((r) => rowToDto(admin, r, cacheHashes)),
  );

  await writeAuditLog(
    {
      userId: user.id,
      action: 'view_network',
      documentHash: centerHash,
      metadata: { neighbors_count: neighbors.length, found: true },
      ...extractRequestContext(await headers()),
    },
    admin,
    { allowFailure: true },
  );

  return {
    center,
    neighbors,
    edges: edges.map((e) => ({
      source: e.source_hash,
      target: e.target_hash,
      kind: e.kind,
      evidence: e.evidence,
      lastSeenAt: e.last_seen_at,
    })),
  };
}
```

(Keep the `expandNode` declaration removed for now — added in Task 14.)

- [ ] **Step 2: Update `page.tsx` to render the loaded data more usefully**

For now, the existing canvas stub will just show neighbor count. Visual rendering comes in Task 15.

- [ ] **Step 3: Smoke-test end-to-end**

1. Start dev server: `pnpm dev`.
2. Search a CPF that has co-parties at `/search`.
3. Visit `/network/cpf%3A<hash-of-that-cpf>` directly. Verify the canvas reports the right neighbor count.
4. Check `audit_log` via Studio: a `view_network` row should appear.

- [ ] **Step 4: Typecheck**

```
pnpm typecheck
```

- [ ] **Step 5: Commit**

```
git add app/\(app\)/network/\[hash\]/actions.ts
git commit -m "feat(network): getSubgraph reads, decrypts, and audits one-hop neighbourhood"
```

---

## Task 14: Implement `expandNode`

**Files:**
- Modify: `app/(app)/network/[hash]/actions.ts`

- [ ] **Step 1: Append the action**

```ts
import { setCachedResults } from '@/lib/predictus/cache';
import { createServerPredictusClient } from '@/lib/predictus/server-client';

export async function expandNode(
  hash: string,
): Promise<{ subgraph: SubgraphDto; usedPredictus: boolean }> {
  const user = await requirePermission('search_network');
  const admin = createAdminClient();
  const supabase = await createClient();

  const { data: row } = await supabase
    .from('graph_nodes')
    .select('node_hash, node_type, encrypted_label')
    .eq('node_hash', hash)
    .maybeSingle()
    .returns<{ node_hash: string; node_type: NodeType; encrypted_label: string }>();

  if (!row) {
    const subgraph = await getSubgraph(hash);
    return { subgraph, usedPredictus: false };
  }

  // Lawyers cannot be expanded online: Predictus has no search-by-OAB endpoint.
  if (row.node_type === 'lawyer') {
    const subgraph = await getSubgraph(hash);
    return { subgraph, usedPredictus: false };
  }

  // Check whether the cache is fresh.
  const nowIso = new Date().toISOString();
  const { data: cacheRow } = await supabase
    .from('predictus_cache')
    .select('document_hash')
    .eq('document_hash', hash)
    .gt('expires_at', nowIso)
    .maybeSingle()
    .returns<{ document_hash: string }>();

  if (cacheRow) {
    const subgraph = await getSubgraph(hash);
    return { subgraph, usedPredictus: false };
  }

  // Need to call Predictus: decrypt the label to recover the raw document.
  const plaintext = await decryptLabel(admin, row.encrypted_label);
  const label = JSON.parse(plaintext) as GraphNodeLabel;
  if (!label.document) {
    const subgraph = await getSubgraph(hash);
    return { subgraph, usedPredictus: false };
  }

  await writeAuditLog(
    {
      userId: user.id,
      action: 'expand_network_node',
      documentHash: hash,
      metadata: { used_predictus: true, expanded_hash: hash },
      ...extractRequestContext(await headers()),
    },
    admin,
    { allowFailure: true },
  );

  const client = await createServerPredictusClient();
  const results =
    row.node_type === 'cpf'
      ? await client.searchByCpf(label.document)
      : await client.searchByCnpj(label.document);

  await setCachedResults(admin, hash, row.node_type, results);

  const subgraph = await getSubgraph(hash);
  return { subgraph, usedPredictus: true };
}
```

- [ ] **Step 2: Typecheck**

```
pnpm typecheck
```

- [ ] **Step 3: Commit**

```
git add app/\(app\)/network/\[hash\]/actions.ts
git commit -m "feat(network): expandNode pulls Predictus on cache miss, refreshes subgraph"
```

---

## Task 15: NetworkCanvas — render with React Flow

**Files:**
- Modify: `app/(app)/network/[hash]/network-canvas.tsx`
- Create: `app/(app)/network/[hash]/node-detail-panel.tsx`

This task focuses on a working visual — custom node and edge components, click-to-select, basic layout. The expand confirmation flow lands in Task 16.

- [ ] **Step 1: Replace `network-canvas.tsx`**

```tsx
'use client';

import { Building2, Scale, User } from 'lucide-react';
import { useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { NodeDetailPanel } from './node-detail-panel';
import type { GraphEdgeDto, GraphNodeDto, SubgraphDto } from './actions';

type NodeData = { dto: GraphNodeDto; isCenter: boolean };

function CpfNode({ data }: NodeProps<NodeData>) {
  return (
    <div
      className={
        'flex items-center gap-2 rounded-full border bg-primary/15 px-3 py-2 text-xs ' +
        (data.isCenter ? 'border-primary ring-2 ring-primary' : 'border-primary/60')
      }
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <User className="size-3.5 text-primary" />
      <span className="font-medium">{data.dto.label.name ?? data.dto.maskedPreview}</span>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
}

function CnpjNode({ data }: NodeProps<NodeData>) {
  return (
    <div
      className={
        'flex items-center gap-2 rounded-md border bg-accent/15 px-3 py-2 text-xs ' +
        (data.isCenter ? 'border-accent ring-2 ring-accent' : 'border-accent/60')
      }
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Building2 className="size-3.5 text-accent-foreground" />
      <span className="font-medium">{data.dto.label.name ?? data.dto.maskedPreview}</span>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
}

function LawyerNode({ data }: NodeProps<NodeData>) {
  return (
    <div className="flex items-center gap-2 rounded-sm border bg-muted px-3 py-2 text-xs">
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Scale className="size-3.5" />
      <span className="font-medium">{data.dto.label.name ?? 'Advogado'}</span>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
}

const NODE_TYPES = { cpf: CpfNode, cnpj: CnpjNode, lawyer: LawyerNode };

function edgeStyle(edge: GraphEdgeDto): { stroke: string; strokeDasharray?: string } {
  if (edge.kind === 'client_lawyer') return { stroke: '#999', strokeDasharray: '4 4' };
  if (edge.kind === 'lawyer_lawyer') return { stroke: '#999', strokeDasharray: '2 4' };
  if (edge.evidence.samePolo === true) return { stroke: '#22c55e' };
  if (edge.evidence.samePolo === false) return { stroke: '#ef4444' };
  return { stroke: '#71717a' };
}

function layout(center: GraphNodeDto, neighbors: GraphNodeDto[]): Node<NodeData>[] {
  const cx = 0;
  const cy = 0;
  const radius = 220;
  const centerNode: Node<NodeData> = {
    id: center.hash,
    type: center.type,
    position: { x: cx, y: cy },
    data: { dto: center, isCenter: true },
  };
  const ring = neighbors.map((n, i) => {
    const angle = (i / Math.max(1, neighbors.length)) * Math.PI * 2;
    return {
      id: n.hash,
      type: n.type,
      position: { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius },
      data: { dto: n, isCenter: false },
    } satisfies Node<NodeData>;
  });
  return [centerNode, ...ring];
}

export function NetworkCanvas({ subgraph }: { subgraph: SubgraphDto }) {
  const [selectedHash, setSelectedHash] = useState<string | null>(null);

  const nodes = useMemo(() => {
    if (!subgraph.center) return [];
    return layout(subgraph.center, subgraph.neighbors);
  }, [subgraph]);

  const edges = useMemo<Edge[]>(
    () =>
      subgraph.edges.map((e, i) => {
        const style = edgeStyle(e);
        const widthBase = Math.min(4, 1 + e.evidence.occurrences * 0.5);
        return {
          id: `e-${i}`,
          source: e.source,
          target: e.target,
          style: { ...style, strokeWidth: widthBase },
        };
      }),
    [subgraph.edges],
  );

  const selected =
    selectedHash === null
      ? null
      : subgraph.center?.hash === selectedHash
        ? subgraph.center
        : subgraph.neighbors.find((n) => n.hash === selectedHash) ?? null;

  if (!subgraph.center) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
        Este nó ainda não tem conexões mapeadas.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_320px]">
      <div className="h-[600px] rounded-xl border border-border bg-card">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={(_, n) => setSelectedHash(n.id)}
          fitView
        >
          <Background gap={24} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      <NodeDetailPanel
        node={selected}
        center={subgraph.center}
        edges={subgraph.edges}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create `node-detail-panel.tsx`**

```tsx
'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { GraphEdgeDto, GraphNodeDto } from './actions';

function formatDoc(node: GraphNodeDto): string | null {
  if (node.type === 'cpf' && node.label.document) {
    return node.label.document.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (node.type === 'cnpj' && node.label.document) {
    return node.label.document.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      '$1.$2.$3/$4-$5',
    );
  }
  if (node.type === 'lawyer' && node.label.oab) {
    return `OAB/${node.label.oab.uf} ${node.label.oab.numero}`;
  }
  return null;
}

export function NodeDetailPanel({
  node,
  center,
  edges,
}: {
  node: GraphNodeDto | null;
  center: GraphNodeDto;
  edges: GraphEdgeDto[];
}) {
  if (!node) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Selecione um nó</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Clique em qualquer nó para ver detalhes e conexões.
        </CardContent>
      </Card>
    );
  }

  const linkingEdges = edges.filter(
    (e) =>
      (e.source === node.hash && e.target === center.hash) ||
      (e.target === node.hash && e.source === center.hash),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{node.label.name ?? node.maskedPreview}</CardTitle>
        <p className="text-xs text-muted-foreground">{formatDoc(node) ?? node.maskedPreview}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {linkingEdges.length > 0 ? (
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">Evidências</p>
            <ul className="mt-1 space-y-1">
              {linkingEdges.map((e, i) => (
                <li key={`${e.kind}-${i}`} className="text-xs">
                  <span className="font-medium">{e.kind}</span>
                  {' · '}
                  {e.evidence.occurrences} processo(s)
                  {e.evidence.samePolo === true ? ' · mesmo polo' : null}
                  {e.evidence.samePolo === false ? ' · polos opostos' : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {node.type !== 'lawyer' ? (
          <Button asChild variant="outline" size="sm">
            <a href={`/network/${encodeURIComponent(node.hash)}`}>Ver rede deste nó</a>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Smoke-test in the browser**

Visit `/network/cpf%3A<hash>` for a CPF with cached neighbours. Click around. Verify:
- Centre is highlighted with a ring.
- Edges colour-code by `samePolo`.
- Side panel updates on click.

- [ ] **Step 4: Typecheck + lint**

```
pnpm typecheck
pnpm lint:fix
```

- [ ] **Step 5: Commit**

```
git add app/\(app\)/network/\[hash\]/network-canvas.tsx app/\(app\)/network/\[hash\]/node-detail-panel.tsx
git commit -m "feat(network): React Flow canvas with custom nodes/edges + detail panel"
```

---

## Task 16: Expand-on-click with confirmation

**Files:**
- Modify: `app/(app)/network/[hash]/node-detail-panel.tsx`
- Create: `app/(app)/network/[hash]/expand-button.tsx`

- [ ] **Step 1: Create the expand button**

```tsx
// app/(app)/network/[hash]/expand-button.tsx
'use client';

import { Button } from '@/components/ui/button';
import { useState, useTransition } from 'react';
import { expandNode } from './actions';

export function ExpandButton({ hash, inCache }: { hash: string; inCache: boolean }) {
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function doExpand() {
    startTransition(async () => {
      await expandNode(hash);
      // Server Action refreshes the cache; reload to pull fresh data.
      window.location.reload();
    });
  }

  if (inCache) {
    return (
      <Button size="sm" variant="outline" disabled={pending} onClick={doExpand}>
        {pending ? 'Expandindo…' : 'Expandir (cache)'}
      </Button>
    );
  }

  if (!confirmOpen) {
    return (
      <Button size="sm" variant="outline" onClick={() => setConfirmOpen(true)}>
        Expandir (chamar Predictus)
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
      <p>Isto vai consumir uma chamada Predictus. Continuar?</p>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={doExpand}>
          {pending ? 'Expandindo…' : 'Confirmar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirmOpen(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the detail panel**

In `node-detail-panel.tsx`, import `ExpandButton` and render it for non-lawyer nodes (right above or below the existing "Ver rede deste nó" link):

```tsx
import { ExpandButton } from './expand-button';

// ...inside CardContent, alongside the other CTA:
{node.type !== 'lawyer' ? (
  <ExpandButton hash={node.hash} inCache={node.inCache} />
) : null}
```

- [ ] **Step 3: Smoke-test**

1. Open the network of a CPF whose neighbour has `inCache=true` → "Expandir (cache)" works instantly, page reloads with fresh data.
2. Open a neighbour with `inCache=false` → click triggers confirmation; confirming hits Predictus and reloads. Verify a `expand_network_node` row landed in `audit_log`.

- [ ] **Step 4: Typecheck + lint + commit**

```
pnpm typecheck
pnpm lint:fix
git add app/\(app\)/network/\[hash\]/expand-button.tsx app/\(app\)/network/\[hash\]/node-detail-panel.tsx
git commit -m "feat(network): expand-on-click with cache-fast path and Predictus confirmation"
```

---

## Task 17: Header search + entry point from `/search`

**Files:**
- Create: `app/(app)/network/[hash]/network-header.tsx`
- Modify: `app/(app)/network/[hash]/page.tsx`
- Modify: `app/(app)/search/search-client.tsx`

`hashDocument` lives in `lib/hash.ts` and uses `node:crypto`, so it must run server-side. The header therefore submits to a Server Action that hashes and redirects.

- [ ] **Step 1a: Add `navigateToNetwork` to `actions.ts`**

```ts
// At top of app/(app)/network/[hash]/actions.ts
import { redirect } from 'next/navigation';
import { hashDocument } from '@/lib/hash';
import { isValid as isCnpjValid } from '@/lib/validators/cnpj';
import { isValid as isCpfValid } from '@/lib/validators/cpf';

// At bottom of the file:
export async function navigateToNetwork(formData: FormData): Promise<void> {
  await requirePermission('search_network');
  const value = String(formData.get('q') ?? '').trim();
  if (isCpfValid(value)) {
    redirect(`/network/${encodeURIComponent(hashDocument('cpf', value))}`);
  }
  if (isCnpjValid(value)) {
    redirect(`/network/${encodeURIComponent(hashDocument('cnpj', value))}`);
  }
  // Stay on the same page; the header re-renders with an error state.
  redirect(`/network/_invalid?q=${encodeURIComponent(value)}`);
}
```

- [ ] **Step 1b: Build the header**

```tsx
// app/(app)/network/[hash]/network-header.tsx
'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { navigateToNetwork } from './actions';

export function NetworkHeader({ centerName }: { centerName: string | null }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <h1 className="text-lg font-semibold">
        {centerName ? `Rede de ${centerName}` : 'Rede'}
      </h1>
      <form action={navigateToNetwork} className="flex items-center gap-2">
        <Input
          name="q"
          placeholder="CPF ou CNPJ"
          className="w-56 font-mono"
          autoComplete="off"
        />
        <Button type="submit" size="sm">Ir</Button>
      </form>
    </header>
  );
}
```

- [ ] **Step 2: Wire the header into `page.tsx`**

```tsx
// inside NetworkPage, replace <h1> with:
<NetworkHeader centerName={subgraph.center?.label.name ?? null} />
```

- [ ] **Step 3: Add the "Ver rede" CTA in `/search`**

`hashDocument` is server-only, so compute the hash inside the Server Action and ship it down with the result.

```ts
// In app/(app)/search/actions.ts, extend SearchByDocOk:
export type SearchByDocOk = {
  ok: true;
  results: PredictusProcess[];
  displayTerm: string;
  searchType: SearchType;
  cached: boolean;
  fetchedAt: string;
  networkHash: string | null;  // null for name searches
};

// And in searchByDoc, after computing documentHash:
const networkHash = input.type === 'name' ? null : documentHash;

// Add `networkHash` to both return objects (cached + fresh).
```

Then in `app/(app)/search/search-client.tsx` (already `'use client'`), render a CTA inside the success card. The CTA visibility is gated by a new prop `canSeeNetwork`:

```tsx
import Link from 'next/link';

// component signature:
export function SearchClient({ canSeeNetwork }: { canSeeNetwork: boolean }) {
  // ...existing body...
}

// inside the result Card header, next to the result-count title:
{state.ok && state.networkHash && canSeeNetwork ? (
  <Button asChild size="sm" variant="outline">
    <Link href={`/network/${encodeURIComponent(state.networkHash)}`}>Ver rede</Link>
  </Button>
) : null}
```

- [ ] **Step 4: Permission-aware CTA**

The "Ver rede" button must hide for operators without `search_network`. Easiest path: load the permission set in the server `page.tsx` of `/search` and pass a boolean to the client component. If `/search/page.tsx` doesn't already pull this, add:

```ts
// In app/(app)/search/page.tsx
import { listUserPermissions } from '@/lib/auth/permissions';
import { requireAuth } from '@/lib/auth/permissions';

const user = await requireAuth();
const perms = await listUserPermissions(user.id);
const canSeeNetwork = user.role === 'admin' || perms.has('search_network');

// Pass to <SearchClient canSeeNetwork={canSeeNetwork} />
```

Update `search-client.tsx` props to accept `canSeeNetwork: boolean` and gate the CTA on it.

- [ ] **Step 5: Smoke-test**

1. Log in as admin, search a CPF → "Ver rede" appears.
2. Click → lands on `/network/<hash>` with the centre present.
3. Use the header search to navigate to another CPF.
4. Log in as operator without permission → "Ver rede" missing; visiting `/network/...` redirects to `/access-denied`.

- [ ] **Step 6: Commit**

```
git add app/\(app\)/network/\[hash\]/network-header.tsx app/\(app\)/network/\[hash\]/page.tsx app/\(app\)/network/\[hash\]/actions.ts app/\(app\)/search/page.tsx app/\(app\)/search/search-client.tsx app/\(app\)/search/actions.ts
git commit -m "feat(network): header search + 'Ver rede' CTA gated by search_network"
```

---

## Task 18: Final smoke + cleanup

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

```
pnpm test
```

Expected: every test passes. The total count should be at least:
- previous 157
- + Task 1: 5
- + Task 6: 4
- + Task 7: 12
- + Task 9: 5
- + Task 10: 3
- + Task 11: 1+

≈ 187+ passing.

- [ ] **Step 2: Lint + format**

```
pnpm lint
pnpm format
```

- [ ] **Step 3: Build**

```
pnpm build
```

Expected: clean build.

- [ ] **Step 4: Manual end-to-end walk-through**

1. Reset local Supabase + bootstrap Vault:
   ```
   pnpm exec supabase db reset
   psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" -f scripts/bootstrap-vault.sql
   ```
2. Create an operator in Studio with `role=admin` (or grant `search_network`).
3. `pnpm dev`, sign in.
4. Search a CPF that has multiple co-parties.
5. Click "Ver rede". Verify the canvas shows the centre + neighbours.
6. Click a neighbour. Side panel updates.
7. Click "Expandir (cache)" on a cached neighbour. Page reloads, neighbours grow.
8. Click "Expandir (chamar Predictus)" on a non-cached neighbour. Confirm. Page reloads.
9. Use the header search to jump to another CPF.
10. Check `audit_log` in Studio for `view_network` and `expand_network_node` rows.

- [ ] **Step 5: If any cleanup commit is needed**

```
git add -A
git commit -m "chore(network): final tidy after smoke test"
```

---

## Out-of-scope follow-ups (do not implement here)

- Backfill script that replays `extractGraph` over historical `predictus_cache` rows.
- `graph_node_attributes` append-only table for multi-source enrichment.
- Multi-hop traversal beyond 1.
- Centrality / community detection.
- Backfill of `audit_log` for searches that happened before this feature shipped.
