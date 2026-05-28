# Network view — design spec

**Status:** draft for review
**Author:** Andre Ganske (with Claude)
**Date:** 2026-05-21
**Branch context:** `feature/nextjs-rewrite`

## Problem

Operators of the PX Center background-check app today query a single CPF/CNPJ/name and see a flat list of processes. Each Predictus response carries rich relational signal — parties co-occurring in a process, lawyers representing those parties, lawyers sharing clients — but that signal is discarded after rendering. There is no way to ask "what is the network around this person?", and there is no way for one operator to benefit from relationships another operator has already surfaced.

This spec defines a **network view**: a shared, persistent graph derived from Predictus payloads, where every CPF, CNPJ and lawyer becomes a node, and edges encode the inferred relationships. The operator can open `/network/[hash]`, see the immediate neighbourhood of any entity, and expand it on demand.

## Goals

- Persist a graph of entities (CPF, CNPJ, lawyer) and relationships derived from every Predictus response the system already stores.
- Give operators a visual canvas to explore the network of a queried entity, with 1-hop expansion-on-click.
- Reuse the cache write path so single search and bulk processing both feed the graph identically.
- Stay coherent with the project's TDD invariant: extraction logic is a pure function under `lib/graph/`.

## Non-goals

- Multi-hop default rendering (>1 hop), community detection, centrality scoring.
- Real-time graph updates (no Realtime channel; the graph reloads on navigation).
- Backfilling the graph from existing `predictus_cache` rows in this iteration. The graph grows from new searches forward.
- Manual edge editing or curation by operators.
- Querying the graph by attribute (e.g. "all CPFs born in 1985"). Labels stay opaque-encrypted in the MVP.

## Decisions captured during brainstorm

| Topic | Decision |
|---|---|
| Edge kinds in scope | `co_party`, `client_lawyer`, `lawyer_lawyer`. Operator co-search excluded. |
| LGPD posture | Relaxed: labels (name + document) are stored encrypted via Vault, but rendered in full to authenticated operators. Justified by the investigative purpose of the tool. |
| Visibility | Shared across all operators. Reads allowed to any authenticated user; writes service-role only. |
| Expansion | Lazy with cache-first. Predictus only fires on cache miss/expired, and only after explicit confirmation. |
| Retention | Persist indefinitely. The graph survives Predictus cache expiration. |
| Lawyers | First-class nodes, identified by `hash('lawyer', \`${uf}-${numero}\`)`. |
| Trigger point | Extraction runs inside `setCachedResults` after the cache upsert. The graph is "fed by the database", regardless of which flow originated the search. |
| Enrichment future | Stay flat (`name`, `document`, `oab` in one `encrypted_label`) for MVP. Documented path forward: `graph_node_attributes` append-only table with `(node_hash, attribute_key, encrypted_value, source, observed_at, superseded_by)` when external enrichment (DOB, mother's name, address) lands. |
| Hops by default | 1, with click-to-expand. |
| Render | React Flow. |
| Access control | Nova permissão `search_network` no vocabulário de `user_service_permissions`. Admins veem por padrão (igual aos outros serviços); operadores precisam de linha explícita. |

## Architecture

### High-level flow

```
search_single | search_bulk_item  ──► Predictus API ──► setCachedResults()
                                                            │
                                                            ├──► predictus_cache upsert (existing)
                                                            │
                                                            └──► extractGraph()  ── pure ──► upsertGraph(admin)
                                                                                                  │
                                                                                                  ▼
                                                                                      graph_nodes, graph_edges
```

Read path:

```
GET /network/[hash]  ──► page.tsx (Server)  ──► getSubgraph(hash, hops=1)  ──► SQL + decrypt
                                                                                      │
                                                                                      ▼
                                                                            <NetworkCanvas /> (React Flow)
```

### Data model

Two tables, both service-role-write-only, authenticated-read.

```sql
create table public.graph_nodes (
  node_hash       text primary key,
  node_type       text not null check (node_type in ('cpf','cnpj','lawyer')),
  encrypted_label bytea not null,
  masked_preview  text not null,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);

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
```

**`node_hash` is the canonical identifier:**
- CPF / CNPJ: `hashDocument('cpf' | 'cnpj', value)` — identical to what `searches.document_hash` already uses, so the two tables join naturally.
- Lawyer: `hashDocument('lawyer', \`${oab.uf}-${oab.numero}\`)`. New type prefix added to `lib/hash.ts`.

**`encrypted_label` payload shape (JSON-encoded, then encrypted via Vault):**

```ts
type GraphNodeLabel = {
  name?: string;                              // PARTE.nome or ADVOGADO.nome
  document?: string;                           // raw, digits-only CPF/CNPJ (lawyers may omit)
  oab?: { uf: string; numero: string };        // lawyers only
};
```

Same Vault key as `predictus_cache`? **No.** Provision a separate `graph_label_key` in `scripts/bootstrap-vault.sql` (the same file that already provisions `predictus_cache_key`). The new migration adds `encrypt_graph_label` and `decrypt_graph_label` RPCs that bind to this key, mirroring the pattern in `migrations/.._crypto_helpers.sql`. `lib/graph/label-crypto.ts` wraps the RPC, identical shape to `lib/crypto/vault.ts`.

**`evidence` payload shape:**

```ts
type EdgeEvidence = {
  processNumbers: string[];   // numeroProcessoUnico set; capped only if pathological
  samePolo: boolean | null;   // for co_party edges; null if unknown
  occurrences: number;        // |processNumbers|, denormalised for sorting
};
```

**Symmetric edge convention:** `co_party` and `lawyer_lawyer` are symmetric. To avoid storing both directions, the extractor sorts the pair lexicographically and always writes `source_hash < target_hash`. The read query unions both directions. `client_lawyer` is directional (parte → advogado).

### Extraction pipeline

`lib/graph/extractor.ts` is a pure function — no Supabase, no Vault, no I/O. Trivially tested under Vitest.

```ts
type ExtractedNode = {
  nodeHash: string;
  nodeType: 'cpf' | 'cnpj' | 'lawyer';
  label: GraphNodeLabel;
  maskedPreview: string;
};

type ExtractedEdge = {
  sourceHash: string;
  targetHash: string;
  kind: 'co_party' | 'client_lawyer' | 'lawyer_lawyer';
  evidence: { processNumber: string; samePolo: boolean | null };
};

// Note: the extractor emits one ExtractedEdge per process observation. The
// writer collapses multiple ExtractedEdges with the same (source, target, kind)
// into a single graph_edges row whose `evidence` jsonb stores the set-union of
// processNumbers and the final occurrences count. Singular in transit, plural
// at rest.

export function extractGraph(
  payload: PredictusProcess[],
  searchedHash: string,
): { nodes: ExtractedNode[]; edges: ExtractedEdge[] };
```

**Extraction rules** (each rule = one Vitest case, written before the implementation):

1. For each `process` in `payload`:
   - Each `parte` with a CPF or CNPJ yields a node (type from which field is present). Both present → use CNPJ.
   - Each `advogado` with a valid `oab.uf` and `oab.numero` yields a lawyer node. Missing or malformed OAB → discard the advogado, no node, no edges.
2. **Co-party edges:** every distinct pair of parte-nodes in the same process. `samePolo = (a.tipo === b.tipo)` when both `tipo` strings are non-empty, else `null`.
3. **Client–lawyer edges:** for each parte, every advogado of that parte (directional: parte → advogado).
4. **Lawyer–lawyer edges:** every distinct pair of advogados across the whole process (regardless of which parte each represents). Same office in the same case is the signal.
5. **Self-edges forbidden:** discard any pair where source and target are the same hash.
6. **Symmetric ordering:** `co_party` and `lawyer_lawyer` always emit with `sourceHash < targetHash` lexicographically.
7. **`maskedPreview` derivation:** `mask*` functions from `lib/validators/{cpf,cnpj,name}.ts`. Lawyers use a custom mask like `Dr. J. S*** — OAB/SP 12.345`.

**Writer:** `lib/graph/writer.ts` exposes `upsertGraph(admin, nodes, edges)`, a thin wrapper around a single `rpc('upsert_graph', { nodes, edges })`. The RPC is the unit of atomicity — one transaction inserts/updates nodes, then edges, merging `evidence.processNumbers` (set-union) and refreshing `last_seen_at`. The RPC lives in `supabase/migrations/<ts>_upsert_graph_rpc.sql`.

**Call site:**

```ts
// lib/predictus/cache.ts (modified)
export async function setCachedResults(client, hash, type, results) {
  // existing upsert into predictus_cache
  // ...

  try {
    const { nodes, edges } = extractGraph(results, hash);
    if (nodes.length > 0) {
      await upsertGraph(client, nodes, edges);
    }
  } catch (e) {
    console.warn('graph upsert failed; continuing without graph update:', e);
  }
}
```

A graph write failure must not roll back the cache write. Same defensive posture as today's audit/cache writes in `searchByDoc`.

### Read API

`app/(app)/network/[hash]/actions.ts`:

```ts
export type GraphNodeDto = {
  hash: string;
  type: 'cpf' | 'cnpj' | 'lawyer';
  label: GraphNodeLabel;       // decrypted
  maskedPreview: string;
  inCache: boolean;            // true ⇔ predictus_cache row exists and is fresh
  lastSeenAt: string;
};

export type GraphEdgeDto = {
  source: string;
  target: string;
  kind: 'co_party' | 'client_lawyer' | 'lawyer_lawyer';
  evidence: { processNumbers: string[]; samePolo: boolean | null; occurrences: number };
  lastSeenAt: string;
};

export type SubgraphDto = {
  center: GraphNodeDto;
  neighbors: GraphNodeDto[];
  edges: GraphEdgeDto[];
};

export async function getSubgraph(centerHash: string): Promise<SubgraphDto>;
export async function expandNode(hash: string): Promise<{ subgraph: SubgraphDto; usedPredictus: boolean }>;
```

`getSubgraph` is a single SQL query over `graph_nodes` and `graph_edges`, then a decryption pass via `decrypt_payload`. `inCache` comes from a join with `predictus_cache` on `document_hash = node_hash`, filtered by `expires_at > now()`. Lawyers always have `inCache = false`.

`expandNode` flow:
1. If `node.inCache` is true → just rerun `getSubgraph(hash)`. `usedPredictus = false`.
2. Else, if `node.type ∈ {cpf, cnpj}` and label has `document`:
   - Decrypt label, pull `document`.
   - Audit `expand_network_node` with `{ used_predictus: true }`.
   - Call `createServerPredictusClient().searchByCpf|Cnpj(document)`.
   - `setCachedResults(...)` → graph populated via the normal pipeline.
   - Rerun `getSubgraph(hash)`. `usedPredictus = true`.
3. Lawyers cannot be expanded online (Predictus has no "search by OAB"); the UI hides the button.

### Access control

The route and Server Actions live behind `requirePermission('search_network')` (helper from `lib/auth/permissions.ts`). Admin users pass automatically per the existing `has_service_permission` semantics; operators need a row in `user_service_permissions`.

A migration extends the existing CHECK on `user_service_permissions.service` to include the new value:

```sql
alter table public.user_service_permissions drop constraint user_service_permissions_service_check;
alter table public.user_service_permissions add constraint user_service_permissions_service_check
  check (service in ('search_person','search_company','search_bulk','search_network'));
```

The admin UI that already manages per-user permissions picks up the new entry automatically as long as it iterates over the vocabulary; if it hardcodes the list, add `search_network` there too.

`getSubgraph` and `expandNode` both call `requirePermission('search_network')` at entry. The "Ver rede" CTA on `/search` is hidden when the operator lacks the permission (read via `listUserPermissions` from `lib/auth/permissions.ts`).

### Auditing

Two new actions added to `audit_log.action`:

```sql
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in (
    'login','logout','search_single','search_bulk_item',
    'bulk_job_created','export_csv',
    'view_network','expand_network_node'
  ));
```

`document_hash` carries the `centerHash`. `metadata` carries `{ neighbors_count }` for `view_network` and `{ used_predictus, expanded_hash }` for `expand_network_node`.

### UI

Route: `app/(app)/network/[hash]/`. The `[hash]` segment is URL-encoded.

- `page.tsx` — Server Component. Loads initial subgraph, passes to `<NetworkCanvas />`.
- `network-canvas.tsx` — Client Component. React Flow with custom node types per `node_type` and custom edge types per `kind`.
- `node-detail-panel.tsx` — Sidebar showing the selected node's full label, evidence list (processes linking it to the centre), and action buttons.

**Visual conventions:**

| `node_type` | Shape | Theme class | Icon |
|---|---|---|---|
| cpf | circle | `bg-primary/15 border-primary` | `User` |
| cnpj | rounded square | `bg-accent/15 border-accent` | `Building2` |
| lawyer | diamond | `bg-muted border-foreground/40` | `Scale` |

| `kind` | Line | Colour |
|---|---|---|
| `co_party` same polo | solid | `stroke-success/60` |
| `co_party` opposite polo | solid | `stroke-destructive/60` |
| `co_party` polo unknown | solid | `stroke-muted-foreground/50` |
| `client_lawyer` | dashed | `stroke-foreground/40` |
| `lawyer_lawyer` | dotted | `stroke-muted-foreground/40` |

Stroke width grows with `evidence.occurrences` (1px → 4px, no hard cap needed).

**Interactions:**

- Click node → sidebar opens with full label and three actions: "Ver processos" (filters the existing `/search` result), "Consultar Predictus" (calls `expandNode`, behind a confirmation modal if the node is not in cache), "Pesquisar este nó" (deep-link to `/search` with the document prefilled).
- Click `[+]` on a node → `expandNode(hash)`. If the node is not in cache, show confirmation: "Isto consumirá uma chamada Predictus."
- Header search → input takes a raw CPF/CNPJ, computes the hash via `hashDocument`, navigates to `/network/<hash>`. Hash not found → empty state with "Consultar e criar rede" CTA that redirects through `/search`.

**Empty / error states:**
- Centre exists but has zero edges: card explaining "Esta entidade ainda não tem conexões mapeadas".
- Centre does not exist in `graph_nodes`: empty state with the "Consultar e criar rede" CTA.
- Decryption failure on a node: fall back to `masked_preview`, surface a small warning icon.

**Accessibility:**
- React Flow keyboard navigation enabled (tab between nodes, enter to select).
- ARIA labels on nodes: `"<tipo> <nome>, <N> conexões"`.
- Sidebar receives focus on node selection.

## File-by-file impact

**New:**
- `supabase/migrations/<ts>_graph_schema.sql` — tables, indexes, RLS.
- `supabase/migrations/<ts>_audit_actions_graph.sql` — extends `audit_log.action` check.
- `supabase/migrations/<ts>_upsert_graph_rpc.sql` — `upsert_graph(nodes jsonb, edges jsonb)` function.
- `supabase/migrations/<ts>_graph_label_vault_key.sql` — adds `encrypt_graph_label` / `decrypt_graph_label` RPCs bound to `graph_label_key`.
- `supabase/migrations/<ts>_search_network_permission.sql` — extends `user_service_permissions.service` CHECK to include `'search_network'`.
- `lib/graph/types.ts`
- `lib/graph/extractor.ts` + `extractor.test.ts`
- `lib/graph/writer.ts` + `writer.test.ts`
- `lib/graph/label-crypto.ts` + `label-crypto.test.ts` — encrypts/decrypts node labels using `graph_label_key`.
- `app/(app)/network/[hash]/page.tsx`
- `app/(app)/network/[hash]/actions.ts`
- `app/(app)/network/[hash]/network-canvas.tsx`
- `app/(app)/network/[hash]/node-detail-panel.tsx`

**Modified:**
- `scripts/bootstrap-vault.sql` — provision `graph_label_key` alongside `predictus_cache_key`.
- `lib/hash.ts` — add `'lawyer'` to the accepted type prefixes; extend the test suite.
- `lib/predictus/cache.ts` — call `extractGraph` + `upsertGraph` after the cache upsert.
- `lib/supabase/types.ts` — add `graph_nodes`, `graph_edges` to `Database`.
- `lib/audit.ts` — add `'view_network'`, `'expand_network_node'` to the action union.
- `lib/auth/permissions.ts` — extend the `Service` union (and the `SERVICES` array) with `'search_network'`.
- `app/(app)/search/search-client.tsx` — add a "Ver rede" button to each result that links to `/network/<hash>`, hidden when operator lacks the permission.
- Admin UI that lists service permissions (wherever the vocabulary is rendered today) — surface `search_network` so admins can grant it.
- `package.json` — add `reactflow` dependency.

## Test plan

Unit (Vitest, before implementation):
- `lib/graph/extractor.test.ts`: each of the 7 extraction rules above. Edge cases — empty payload, partes without CPF/CNPJ, advogado with missing OAB, single parte (no co-party edges), self-references, duplicates across processes (set-union of evidence).
- `lib/graph/writer.test.ts`: contract against a mocked Supabase client. First write creates rows; second write merges evidence; conflicting kinds remain distinct.
- `lib/graph/label-crypto.test.ts`: roundtrip encrypt/decrypt using a stubbed Vault RPC.
- `lib/hash.test.ts`: extend with `'lawyer'` cases.

Integration / manual smoke (no unit tests required per CLAUDE.md):
- Run a single search of a CPF with known co-parties → verify `graph_nodes` / `graph_edges` populate, `/network/<hash>` renders.
- Re-search the same CPF → `evidence.processNumbers` stays deduplicated.
- Bulk job with two CSV rows that share a co-party → both end up linked through that shared node.
- Open `/network/<hash>`, click expand on a neighbour not in cache → confirmation modal → expansion succeeds and new nodes appear.

## Status / out of scope details

- Spec leaves React Flow custom node/edge component code unspecified — implementation detail for the plan.
- No backfill in this iteration.

## Open questions (not blocking)

- Backfill of the existing `predictus_cache` rows. A one-off script could replay decryption + `extractGraph` over every cached row; nice-to-have, not in scope here.
- Lawyer name normalisation. Predictus sometimes returns "DR. JOÃO" and sometimes "JOAO DA SILVA"; today we trust the OAB as identity and pick the most recent name. Good enough for MVP; revisit if duplicates emerge.
- Graph view auditing granularity: currently `view_network` writes once per page load. Per-node-selection audit events would be noisier and add little value; skipping.

## Future evolution

- `graph_node_attributes` append-only table for multi-source enrichment (DOB, mother's name, address). Adds provenance and history. See "Decisions captured" above for the schema sketch.
- Multi-hop traversal with cap.
- Centrality / community detection (e.g. detect "shell" lawyers that connect otherwise disjoint clusters).
- Backfill script for historical `predictus_cache` rows.
