# Pesos persistidos nas relações da rede — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar peso às relações do grafo combinando multiplicidade (mesma dupla em vários processos) e diversidade (mesma dupla ligada por sócios + parentes + co-parte), persistindo o peso no banco, consolidando arestas paralelas numa única aresta proporcionalmente mais grossa com drill-down por conexão, e dimensionando os nós pela sua prominência.

**Architecture:** O peso é **materializado no banco** (Opção B): `graph_edges.weight` (força por tipo) e `graph_nodes.weight` (prominência = soma das arestas incidentes), ambos mantidos pelo `upsert_graph`. A apresentação consome esses números — a agregação por par (multiplicidade + bônus de diversidade) é uma função pura em `lib/graph/edge-weight.ts`, e o canvas renderiza uma aresta consolidada por par com largura ∝ peso e nós dimensionados por prominência. Decisão de persistir (em vez de calcular no cliente) é motivada pela página de rede já estar lenta — não queremos adicionar recomputação ao carregamento.

**Tech Stack:** Postgres 16 (plpgsql, `upsert_graph` security definer), TypeScript strict, Vitest (TDD em `lib/**`), React 19, React Flow + graphology (ForceAtlas2), Supabase JS.

---

## Contexto essencial (leia antes de começar)

- **Constraint atual:** `graph_edges` tem `unique(source_hash, target_hash, kind)`. O mesmo par de nós já pode ter várias linhas (uma por tipo). Nada hoje as agrega.
- **`upsert_graph`** (versão vigente: `supabase/migrations/20260526140000_graph_node_risk_flags.sql`) é polimórfica:
  - arestas de **processo** (`co_party`/`client_lawyer`/`lawyer_lawyer`) fazem set-union de `processNumbers` e gravam `occurrences` no jsonb `evidence`;
  - `corporate_relation`/`family_relation` **sobrescrevem** `evidence` (sem `occurrences`).
- **Migrations são append-only.** Nunca editar uma migration aplicada — criar arquivo novo `YYYYMMDDHHMMSS_<slug>.sql`.
- **LGPD:** peso usa só `kind`/`occurrences`/hashes. Nada de CPF/CNPJ/nome em claro, nada toca `encrypted_label`.
- **TDD:** `lib/graph/edge-weight.ts` nasce com `.test.ts`. As camadas `app/**`, migrations e `.tsx` são wiring fino — verificadas por `pnpm typecheck`/`pnpm build`/smoke manual (política do CLAUDE.md).
- **Modelo de peso:**
  - `edge.weight` (persistido): processo → `occurrences`; corporate/family → `1`.
  - `node.weight` (persistido): `Σ weight` das arestas incidentes (diversidade entra naturalmente, pois cada tipo é uma linha).
  - `pairWeight` (derivado, em `edge-weight.ts`): `Σ edge.weight do par + W_DIV*(diversidade-1)`, `W_DIV = 2`.

## File Structure

- **Criar** `supabase/migrations/20260527120000_graph_edge_node_weight.sql` — colunas `weight` + reescrita do `upsert_graph` + backfill.
- **Criar** `lib/graph/edge-weight.ts` + `lib/graph/edge-weight.test.ts` — agregação pura por par e mapeamentos visuais.
- **Modificar** `lib/supabase/types.ts` — `weight` em `graph_edges` e `graph_nodes` (Row/Insert/Update).
- **Modificar** `app/(app)/network/[hash]/actions.ts` — selecionar `weight`, expor `weight` no `GraphNodeDto`.
- **Modificar** `app/(app)/network/[hash]/network-canvas.tsx` — aresta consolidada (largura/cor por peso), tamanho do nó por prominência, slider por força, layout por peso, clique na aresta.
- **Modificar** `app/(app)/network/[hash]/node-detail-panel.tsx` — peso do par + drill-down de cada conexão; modo "detalhe do par" ao clicar numa aresta.
- **(Perf, opcional)** `supabase/migrations/20260527120100_decrypt_graph_labels_batch.sql` + `lib/graph/label-crypto.ts` + `actions.ts` — decifrar labels em 1 RPC (ataca a lentidão citada).

---

## Task 1: Migration — colunas de peso, `upsert_graph` e backfill

**Files:**
- Create: `supabase/migrations/20260527120000_graph_edge_node_weight.sql`

- [ ] **Step 1: Escrever a migration completa**

Conteúdo integral do arquivo (a função é a versão vigente de `20260526140000` + lógica de peso; mudanças marcadas com `-- WEIGHT:`):

```sql
-- ============================================================================
-- Pesos persistidos no grafo.
--   graph_edges.weight  : força por tipo (processo = occurrences; corp/fam = 1)
--   graph_nodes.weight  : prominência = soma das arestas incidentes
-- upsert_graph passa a gravar edge.weight e recomputar node.weight dos nós
-- tocados na escrita. Append-only: novo arquivo, nunca editar os anteriores.
-- ============================================================================

alter table public.graph_edges
  add column if not exists weight integer not null default 1;

alter table public.graph_nodes
  add column if not exists weight integer not null default 0;

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
  jsonb_evidence jsonb;
  in_pep boolean;
  in_sanction boolean;
begin
  -- Nodes
  if jsonb_typeof(nodes_in) = 'array' then
    for n in select * from jsonb_array_elements(nodes_in) loop
      in_pep := coalesce((n->>'is_pep')::boolean, false);
      in_sanction := coalesce((n->>'has_sanction')::boolean, false);
      insert into public.graph_nodes (
        node_hash, node_type, encrypted_label, masked_preview,
        is_pep, has_sanction, risk_updated_at
      )
      values (
        n->>'node_hash',
        n->>'node_type',
        decode(n->>'encrypted_label_b64', 'base64'),
        n->>'masked_preview',
        in_pep, in_sanction,
        case when (n ? 'is_pep') or (n ? 'has_sanction') then now() else null end
      )
      on conflict (node_hash) do update
        set last_seen_at = now(),
            is_pep = public.graph_nodes.is_pep or in_pep,
            has_sanction = public.graph_nodes.has_sanction or in_sanction,
            risk_updated_at = case
              when (n ? 'is_pep') or (n ? 'has_sanction') then now()
              else public.graph_nodes.risk_updated_at
            end;
    end loop;
  end if;

  -- Edges
  if jsonb_typeof(edges_in) = 'array' then
    for e in select * from jsonb_array_elements(edges_in) loop
      k := e->>'kind';
      if k in ('corporate_relation', 'family_relation') then
        jsonb_evidence := coalesce(e->'evidence', '{}'::jsonb);
        -- WEIGHT: corporate/family valem 1 (sem multiplicidade própria).
        insert into public.graph_edges (source_hash, target_hash, kind, evidence, weight)
        values (e->>'source_hash', e->>'target_hash', k, jsonb_evidence, 1)
        on conflict (source_hash, target_hash, kind) do update
          set evidence = excluded.evidence, last_seen_at = now(), weight = 1;
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
        -- WEIGHT: processo vale o nº de processos distintos (occurrences).
        insert into public.graph_edges (source_hash, target_hash, kind, evidence, weight)
        values (
          e->>'source_hash', e->>'target_hash', k,
          jsonb_build_object('processNumbers', process_numbers, 'samePolo', same_polo_val, 'occurrences', occurrences),
          occurrences
        )
        on conflict (source_hash, target_hash, kind) do update
          set evidence = jsonb_build_object('processNumbers', process_numbers, 'samePolo', same_polo_val, 'occurrences', occurrences),
              last_seen_at = now(),
              weight = occurrences;
      end if;
    end loop;

    -- WEIGHT: recomputa a prominência dos nós tocados nesta escrita.
    update public.graph_nodes g
    set weight = coalesce((
      select sum(ge.weight)::int from public.graph_edges ge
      where ge.source_hash = g.node_hash or ge.target_hash = g.node_hash
    ), 0)
    where g.node_hash in (
      select e2->>'source_hash' from jsonb_array_elements(edges_in) e2
      union
      select e2->>'target_hash' from jsonb_array_elements(edges_in) e2
    );
  end if;
end;
$$;

revoke all on function public.upsert_graph(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_graph(jsonb, jsonb) to service_role;

-- ----- Backfill dos dados existentes (grafo é append-only) -------------------
-- Arestas: processo recebe occurrences; corporate/family ficam em 1 (default).
update public.graph_edges
set weight = greatest(1, coalesce((evidence->>'occurrences')::int, 1));

-- Nós: prominência = soma das arestas incidentes.
update public.graph_nodes g
set weight = coalesce((
  select sum(ge.weight)::int from public.graph_edges ge
  where ge.source_hash = g.node_hash or ge.target_hash = g.node_hash
), 0);
```

- [ ] **Step 2: Aplicar a migration localmente**

Run: `pnpm exec supabase db reset`
Expected: aplica todas as migrations sem erro, incluindo `20260527120000_graph_edge_node_weight`. Sem `ERROR:` no log.

- [ ] **Step 3: Verificar colunas e backfill via psql**

Run:
```bash
psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" -c \
  "select count(*) filter (where weight >= 1) as edges_ok from public.graph_edges; \
   select column_name from information_schema.columns where table_name='graph_nodes' and column_name='weight';"
```
Expected: `edges_ok` = total de arestas (todas ≥ 1); a coluna `weight` existe em `graph_nodes`. (Em banco vazio recém-resetado, contagens podem ser 0 — então o objetivo é só confirmar que não há erro e a coluna existe.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260527120000_graph_edge_node_weight.sql
git commit -m "feat(graph): persiste weight em graph_edges/graph_nodes via upsert_graph"
```

---

## Task 2: Tipos do banco (`lib/supabase/types.ts`)

**Files:**
- Modify: `lib/supabase/types.ts:288-364` (blocos `graph_nodes` e `graph_edges`)

- [ ] **Step 1: Adicionar `weight` ao `graph_nodes`**

Em `graph_nodes.Row` (após `risk_updated_at: string | null;`) adicionar:
```ts
          weight: number;
```
Em `graph_nodes.Insert` e `graph_nodes.Update` (após `risk_updated_at?: ...`) adicionar:
```ts
          weight?: number;
```

- [ ] **Step 2: Adicionar `weight` ao `graph_edges`**

Em `graph_edges.Row` (após `evidence: Record<string, unknown>;`) adicionar:
```ts
          weight: number;
```
Em `graph_edges.Insert` e `graph_edges.Update` (após `evidence?: ...`) adicionar:
```ts
          weight?: number;
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (sem erros).

- [ ] **Step 4: Commit**

```bash
git add lib/supabase/types.ts
git commit -m "chore(types): weight em graph_nodes/graph_edges"
```

---

## Task 3: Função pura de agregação por par (`lib/graph/edge-weight.ts`)

**Files:**
- Create: `lib/graph/edge-weight.ts`
- Test: `lib/graph/edge-weight.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

`lib/graph/edge-weight.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  W_DIV,
  consolidatePairs,
  dominantKind,
  nodeScale,
  pairKey,
  pairStrokeWidth,
} from './edge-weight';

describe('pairKey', () => {
  it('is order-independent', () => {
    expect(pairKey('B', 'A')).toBe(pairKey('A', 'B'));
  });
});

describe('consolidatePairs', () => {
  it('sums weights and counts distinct kinds per unordered pair', () => {
    const pairs = consolidatePairs([
      { source: 'A', target: 'B', kind: 'co_party', weight: 3 },
      { source: 'B', target: 'A', kind: 'corporate_relation', weight: 1 },
      { source: 'A', target: 'B', kind: 'family_relation', weight: 1 },
    ]);
    const p = pairs.get(pairKey('A', 'B'));
    expect(p).toBeDefined();
    expect(p?.multiplicity).toBe(5); // 3 + 1 + 1
    expect(p?.diversity).toBe(3);
    expect(p?.weight).toBe(5 + W_DIV * 2); // multiplicidade + bônus de 2 tipos extras
  });

  it('single-kind process pair keeps weight == multiplicity (no diversity bonus)', () => {
    const pairs = consolidatePairs([{ source: 'A', target: 'B', kind: 'co_party', weight: 4 }]);
    const p = pairs.get(pairKey('A', 'B'));
    expect(p?.diversity).toBe(1);
    expect(p?.weight).toBe(4);
  });

  it('ignores self-loops and treats weight<1 as 1', () => {
    const pairs = consolidatePairs([
      { source: 'A', target: 'A', kind: 'co_party', weight: 9 },
      { source: 'A', target: 'B', kind: 'co_party', weight: 0 },
    ]);
    expect(pairs.has(pairKey('A', 'A'))).toBe(false);
    expect(pairs.get(pairKey('A', 'B'))?.multiplicity).toBe(1);
  });
});

describe('dominantKind', () => {
  it('prioritises adversarial/relevant kinds', () => {
    expect(dominantKind(['lawyer_lawyer', 'co_party'])).toBe('co_party');
    expect(dominantKind(['family_relation', 'corporate_relation'])).toBe('corporate_relation');
  });
});

describe('pairStrokeWidth', () => {
  it('grows with weight and clamps to [1, 8]', () => {
    expect(pairStrokeWidth(1, 1)).toBeGreaterThanOrEqual(1);
    expect(pairStrokeWidth(1, 1)).toBeLessThan(pairStrokeWidth(20, 1));
    expect(pairStrokeWidth(100000, 5)).toBeLessThanOrEqual(8);
  });
});

describe('nodeScale', () => {
  it('grows with weight and clamps to [1, 1.8]', () => {
    expect(nodeScale(0)).toBe(1);
    expect(nodeScale(4)).toBeGreaterThan(1);
    expect(nodeScale(1000000)).toBeLessThanOrEqual(1.8);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm test -- lib/graph/edge-weight`
Expected: FAIL — `Cannot find module './edge-weight'`.

- [ ] **Step 3: Implementar `lib/graph/edge-weight.ts`**

```ts
import type { EdgeKind } from './types';

/** Bônus de peso por tipo de relação extra entre o mesmo par (cada tipo além do primeiro). */
export const W_DIV = 2;

export type MinimalEdge = {
  source: string;
  target: string;
  kind: EdgeKind;
  weight: number;
};

export type ConsolidatedPair = {
  a: string;
  b: string;
  kinds: EdgeKind[];
  /** Soma das forças (edge.weight) das arestas do par. */
  multiplicity: number;
  /** Nº de tipos distintos ligando o par. */
  diversity: number;
  /** multiplicity + W_DIV*(diversity-1). */
  weight: number;
  dominantKind: EdgeKind;
};

// Maior rank = mais evidente. co_party fica no topo porque pode ser adversarial
// (o canvas distingue mesmo/oposto pela evidência ao escolher a cor final).
const KIND_RANK: Record<EdgeKind, number> = {
  co_party: 5,
  corporate_relation: 4,
  family_relation: 3,
  client_lawyer: 2,
  lawyer_lawyer: 1,
};

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

export function dominantKind(kinds: EdgeKind[]): EdgeKind {
  return kinds.reduce((best, k) => (KIND_RANK[k] > KIND_RANK[best] ? k : best), kinds[0]);
}

export function consolidatePairs(edges: MinimalEdge[]): Map<string, ConsolidatedPair> {
  const acc = new Map<string, { a: string; b: string; kinds: Set<EdgeKind>; multiplicity: number }>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    const a = e.source < e.target ? e.source : e.target;
    const b = e.source < e.target ? e.target : e.source;
    const key = `${a}__${b}`;
    const cur = acc.get(key) ?? { a, b, kinds: new Set<EdgeKind>(), multiplicity: 0 };
    cur.kinds.add(e.kind);
    cur.multiplicity += Math.max(1, e.weight);
    acc.set(key, cur);
  }
  const out = new Map<string, ConsolidatedPair>();
  for (const [key, v] of acc) {
    const kinds = [...v.kinds];
    const diversity = kinds.length;
    out.set(key, {
      a: v.a,
      b: v.b,
      kinds,
      multiplicity: v.multiplicity,
      diversity,
      weight: v.multiplicity + W_DIV * (diversity - 1),
      dominantKind: dominantKind(kinds),
    });
  }
  return out;
}

export function pairStrokeWidth(weight: number, diversity: number): number {
  const w = 1 + 1.2 * Math.log2(weight + 1) + 0.6 * (diversity - 1);
  return Math.min(8, Math.max(1, w));
}

export function nodeScale(weight: number): number {
  return Math.min(1.8, Math.max(1, 1 + 0.15 * Math.log2(weight + 1)));
}
```

- [ ] **Step 4: Rodar os testes e confirmar verde**

Run: `pnpm test -- lib/graph/edge-weight`
Expected: PASS (todos os casos).

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/graph/edge-weight.ts lib/graph/edge-weight.test.ts
git commit -m "feat(graph): edge-weight — consolidação por par + mapeamento visual"
```

---

## Task 4: Expor `weight` na leitura do subgrafo (`actions.ts`)

**Files:**
- Modify: `app/(app)/network/[hash]/actions.ts`

- [ ] **Step 1: Incluir `weight` no `GraphNodeDto`**

No tipo `GraphNodeDto` (após `lastSeenAt: string;`) adicionar:
```ts
  weight: number;
```

- [ ] **Step 2: Incluir `weight` no `NodeRow` e no SELECT de nós**

No tipo `NodeRow` (após `last_seen_at: string;`) adicionar:
```ts
  weight: number;
```
Atualizar as **três** strings de `.select(...)` de `graph_nodes` (em `fetchNodesInChunks`, no `centerRow` dentro de `getSubgraph`) para incluir `weight`. A string passa a ser:
```ts
      'node_hash, node_type, encrypted_label, masked_preview, last_seen_at, is_pep, has_sanction, weight',
```

- [ ] **Step 3: Mapear `weight` em `rowToDto`**

No objeto retornado por `rowToDto`, adicionar (após `lastSeenAt: row.last_seen_at,`):
```ts
    weight: row.weight,
```

- [ ] **Step 4: Incluir `weight` nas arestas do `GraphEdgeDto`**

No tipo `GraphEdgeDto` (após `evidence: StoredEdgeEvidence;`) adicionar:
```ts
  weight: number;
```
No tipo `EdgeRow` (após `evidence: StoredEdgeEvidence;`) adicionar:
```ts
  weight: number;
```
No SELECT de `graph_edges` dentro de `getSubgraph`, trocar para incluir `weight`:
```ts
    .select('source_hash, target_hash, kind, evidence, last_seen_at, weight')
```
No `edges.map(...)` final do `getSubgraph`, adicionar ao objeto retornado (após `lastSeenAt: e.last_seen_at,`):
```ts
      weight: e.weight,
```

- [ ] **Step 5: Default seguro nos fallbacks de `path` em `node-detail-panel`**

(Antecipa erro de tipo na Task 6.) Nenhuma mudança aqui ainda — só registrar que o objeto fallback de nó no painel precisará de `weight: 0`.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (Se acusar `weight` faltando em algum literal de `GraphNodeDto`, é o fallback do painel — será corrigido na Task 6; se a Task 6 ainda não rodou, adicione `weight: 0` no fallback agora.)

- [ ] **Step 7: Commit**

```bash
git add 'app/(app)/network/[hash]/actions.ts'
git commit -m "feat(graph): getSubgraph expõe weight de nós e arestas"
```

---

## Task 5: Canvas — aresta consolidada, peso visual e prominência de nó

**Files:**
- Modify: `app/(app)/network/[hash]/network-canvas.tsx`

Esta tarefa reescreve o componente. Substitua o arquivo inteiro pelo conteúdo abaixo (mudanças-chave vs. atual: importa `edge-weight`; `NodeData` ganha `scale`; nós escalam por `dto.weight`; o slider vira "força do vínculo"; as arestas são **consolidadas por par** com largura/cor por peso; clique em aresta seleciona o par; `computeLayout` usa o peso do par).

- [ ] **Step 1: Substituir `network-canvas.tsx`**

```tsx
'use client';

import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { Building2, Filter, Scale, User } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  type ConsolidatedPair,
  consolidatePairs,
  nodeScale,
  pairKey,
  pairStrokeWidth,
} from '@/lib/graph/edge-weight';
import { findShortestPath } from '@/lib/graph/path';
import type { EdgeKind, NodeType, StoredEdgeEvidence } from '@/lib/graph/types';
import type { GraphEdgeDto, GraphNodeDto, SubgraphDto } from './actions';
import { FloatingEdge } from './floating-edge';
import { NodeDetailPanel } from './node-detail-panel';

/** True when the stored evidence comes from the process branch (has occurrences/samePolo). */
function isProcessEvidence(
  ev: StoredEdgeEvidence,
): ev is Extract<StoredEdgeEvidence, { occurrences: number }> {
  return 'occurrences' in ev;
}

type NodeData = {
  dto: GraphNodeDto;
  isCenter: boolean;
  inSpotlight: boolean;
  dimmed: boolean;
  onPath: boolean;
  isPathStart: boolean;
  /** Escala visual derivada da prominência do nó (peso persistido). */
  scale: number;
};

const PATH_HIGHLIGHT = '#fbbf24'; // amber-400

function nodeBoxShadow(data: NodeData): string | undefined {
  if (data.isPathStart) return `0 0 0 3px ${PATH_HIGHLIGHT}, 0 0 18px ${PATH_HIGHLIGHT}55`;
  if (data.onPath) return `0 0 0 2.5px ${PATH_HIGHLIGHT}`;
  if (data.dto.isPep || data.dto.hasSanction) return '0 0 0 3px #ef4444, 0 0 14px #ef444455';
  return undefined;
}

function NodeShell({
  data,
  baseClass,
  Icon,
  iconClass,
}: {
  data: NodeData;
  baseClass: string;
  Icon: typeof User;
  iconClass?: string;
}) {
  const shadow = nodeBoxShadow(data);
  // A prominência aumenta o tamanho do nó; o centro mantém destaque próprio.
  const style: React.CSSProperties = {
    transform: `scale(${data.scale})`,
    transformOrigin: 'center',
    ...(shadow ? { boxShadow: shadow } : {}),
  };
  return (
    <div
      className={`transition-opacity ${baseClass} ${data.dimmed ? 'opacity-20' : 'opacity-100'}`}
      style={style}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Icon className={`size-3 shrink-0 ${iconClass ?? ''}`} />
      <span className="truncate font-medium">{data.dto.label.name ?? data.dto.maskedPreview}</span>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
}

function CpfNode({ data }: NodeProps<NodeData>) {
  const sizing = data.isCenter ? 'px-3 py-1.5 text-[0.7rem]' : 'px-2 py-1 text-[0.6rem]';
  const border = data.isCenter
    ? 'border-2 border-primary ring-2 ring-primary/30'
    : 'border-2 border-primary/70';
  return (
    <NodeShell
      data={data}
      Icon={User}
      iconClass="text-primary"
      baseClass={`flex max-w-[160px] items-center gap-1.5 rounded-full bg-card shadow-sm ${sizing} ${border}`}
    />
  );
}

function CnpjNode({ data }: NodeProps<NodeData>) {
  const sizing = data.isCenter ? 'px-3 py-1.5 text-[0.7rem]' : 'px-2 py-1 text-[0.6rem]';
  const border = data.isCenter
    ? 'border-2 border-accent ring-2 ring-accent/30'
    : 'border-2 border-accent/70';
  return (
    <NodeShell
      data={data}
      Icon={Building2}
      iconClass="text-accent-foreground"
      baseClass={`flex max-w-[160px] items-center gap-1.5 rounded-md bg-card shadow-sm ${sizing} ${border}`}
    />
  );
}

function LawyerNode({ data }: NodeProps<NodeData>) {
  return (
    <NodeShell
      data={data}
      Icon={Scale}
      iconClass="text-muted-foreground"
      baseClass="flex max-w-[160px] items-center gap-1.5 rounded-sm border-2 border-border bg-card px-2 py-1 text-[0.6rem] shadow-sm"
    />
  );
}

const TYPE_ORDER: readonly NodeType[] = ['cpf', 'cnpj', 'lawyer'];
const TYPE_LABELS: Record<NodeType, string> = {
  cpf: 'Pessoas',
  cnpj: 'Empresas',
  lawyer: 'Advogados',
};
const TYPE_ICON: Record<NodeType, typeof User> = {
  cpf: User,
  cnpj: Building2,
  lawyer: Scale,
};

type EdgeStyleKind =
  | 'co_party_same'
  | 'co_party_opposed'
  | 'co_party_unknown'
  | 'client_lawyer'
  | 'lawyer_lawyer'
  | 'corporate_relation'
  | 'family_relation';

const EDGE_STYLES: Record<EdgeStyleKind, { stroke: string; strokeDasharray?: string; label: string }> = {
  co_party_same: { stroke: '#22c55e', label: 'Mesmo polo' },
  co_party_opposed: { stroke: '#ef4444', label: 'Polos opostos' },
  co_party_unknown: { stroke: '#71717a', label: 'Co-parte (polo n/d)' },
  client_lawyer: { stroke: '#0ea5e9', strokeDasharray: '6 4', label: 'Representação' },
  lawyer_lawyer: { stroke: '#7c3aed', strokeDasharray: '2 4', label: 'Advogado ↔ advogado' },
  corporate_relation: { stroke: '#1d4ed8', strokeDasharray: '4 3', label: 'Vínculo societário' },
  family_relation: { stroke: '#db2777', strokeDasharray: '1 3', label: 'Parentesco' },
};

// Severidade para escolher a cor da aresta consolidada quando há vários tipos.
const STYLE_RANK: Record<EdgeStyleKind, number> = {
  co_party_opposed: 7,
  corporate_relation: 6,
  family_relation: 5,
  co_party_same: 4,
  client_lawyer: 3,
  lawyer_lawyer: 2,
  co_party_unknown: 1,
};

function classifyEdge(edge: GraphEdgeDto): EdgeStyleKind {
  if (edge.kind === 'client_lawyer') return 'client_lawyer';
  if (edge.kind === 'lawyer_lawyer') return 'lawyer_lawyer';
  if (edge.kind === 'corporate_relation') return 'corporate_relation';
  if (edge.kind === 'family_relation') return 'family_relation';
  if (isProcessEvidence(edge.evidence) && edge.evidence.samePolo === true) return 'co_party_same';
  if (isProcessEvidence(edge.evidence) && edge.evidence.samePolo === false) return 'co_party_opposed';
  return 'co_party_unknown';
}

/** Estilo dominante de um par = o de maior severidade entre suas arestas. */
function dominantStyle(constituents: GraphEdgeDto[]): EdgeStyleKind {
  return constituents
    .map(classifyEdge)
    .reduce((best, s) => (STYLE_RANK[s] > STYLE_RANK[best] ? s : best), 'co_party_unknown' as EdgeStyleKind);
}

function computeLayout(
  center: GraphNodeDto,
  visibleNeighbors: GraphNodeDto[],
  visiblePairs: ConsolidatedPair[],
): { positions: Map<string, { x: number; y: number }> } {
  const positions = new Map<string, { x: number; y: number }>();
  const g = new Graph({ multi: false, type: 'undirected' });
  g.addNode(center.hash);
  for (const n of visibleNeighbors) {
    if (!g.hasNode(n.hash)) g.addNode(n.hash);
  }
  for (const p of visiblePairs) {
    if (!g.hasNode(p.a) || !g.hasNode(p.b)) continue;
    if (p.a === p.b) continue;
    if (!g.hasEdge(p.a, p.b)) g.addEdge(p.a, p.b, { weight: Math.max(1, p.weight) });
  }

  const seedRadius = Math.max(400, g.order * 30);
  for (const node of g.nodes()) {
    if (node === center.hash) {
      g.setNodeAttribute(node, 'x', 0);
      g.setNodeAttribute(node, 'y', 0);
    } else {
      const angle = Math.random() * Math.PI * 2;
      const r = seedRadius * (0.5 + Math.random() * 0.5);
      g.setNodeAttribute(node, 'x', r * Math.cos(angle));
      g.setNodeAttribute(node, 'y', r * Math.sin(angle));
    }
    g.setNodeAttribute(node, 'size', node === center.hash ? 90 : 70);
  }

  const iterations = Math.min(300, Math.max(120, g.order * 3));
  try {
    forceAtlas2.assign(g, {
      iterations,
      settings: {
        gravity: 0.3,
        scalingRatio: 80,
        strongGravityMode: false,
        barnesHutOptimize: true,
        barnesHutTheta: 0.5,
        slowDown: 2,
        linLogMode: true,
        outboundAttractionDistribution: true,
        adjustSizes: true,
        edgeWeightInfluence: 1, // pares mais pesados puxam mais forte
      },
    });
  } catch {
    // Fall back to the seeded scatter.
  }

  const cx = (g.getNodeAttribute(center.hash, 'x') as number) ?? 0;
  const cy = (g.getNodeAttribute(center.hash, 'y') as number) ?? 0;
  for (const node of g.nodes()) {
    positions.set(node, {
      x: ((g.getNodeAttribute(node, 'x') as number) ?? 0) - cx,
      y: ((g.getNodeAttribute(node, 'y') as number) ?? 0) - cy,
    });
  }
  return { positions };
}

export function NetworkCanvas({ subgraph }: { subgraph: SubgraphDto }) {
  return (
    <ReactFlowProvider>
      <InnerCanvas subgraph={subgraph} />
    </ReactFlowProvider>
  );
}

function InnerCanvas({ subgraph }: { subgraph: SubgraphDto }) {
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [hoveredHash, setHoveredHash] = useState<string | null>(null);
  const [pathStart, setPathStart] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<NodeType>>(new Set());
  const [hiddenEdgeKinds, setHiddenEdgeKinds] = useState<Set<EdgeStyleKind>>(new Set());
  const [minWeight, setMinWeight] = useState(1);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const nodeTypes = useMemo(() => ({ cpf: CpfNode, cnpj: CnpjNode, lawyer: LawyerNode }), []);
  const edgeTypes = useMemo(() => ({ floating: FloatingEdge }), []);
  const fitViewOptions = useMemo(() => ({ padding: 0.2 }), []);
  const reactFlow = useReactFlow();

  const deferredMinWeight = useDeferredValue(minWeight);
  const deferredHiddenTypes = useDeferredValue(hiddenTypes);
  const deferredHiddenEdgeKinds = useDeferredValue(hiddenEdgeKinds);

  const counts = useMemo(() => {
    const result: Record<NodeType, number> = { cpf: 0, cnpj: 0, lawyer: 0 };
    for (const n of subgraph.neighbors) result[n.type]++;
    return result;
  }, [subgraph.neighbors]);

  const candidateHashes = useMemo(() => {
    const s = new Set<string>();
    if (subgraph.center) s.add(subgraph.center.hash);
    for (const n of subgraph.neighbors) {
      if (!deferredHiddenTypes.has(n.type)) s.add(n.hash);
    }
    return s;
  }, [subgraph.center, subgraph.neighbors, deferredHiddenTypes]);

  // Arestas cruas que sobrevivem ao filtro de tipo de nó e de tipo de relação.
  const typeFilteredEdges = useMemo(
    () =>
      subgraph.edges.filter(
        (e) =>
          candidateHashes.has(e.source) &&
          candidateHashes.has(e.target) &&
          !deferredHiddenEdgeKinds.has(classifyEdge(e)),
      ),
    [subgraph.edges, candidateHashes, deferredHiddenEdgeKinds],
  );

  // Constituintes por par (para cor dominante e drill-down no painel).
  const constituentsByPair = useMemo(() => {
    const m = new Map<string, GraphEdgeDto[]>();
    for (const e of typeFilteredEdges) {
      const key = pairKey(e.source, e.target);
      const arr = m.get(key) ?? [];
      arr.push(e);
      m.set(key, arr);
    }
    return m;
  }, [typeFilteredEdges]);

  const allPairs = useMemo(
    () =>
      consolidatePairs(
        typeFilteredEdges.map((e) => ({
          source: e.source,
          target: e.target,
          kind: e.kind,
          weight: e.weight,
        })),
      ),
    [typeFilteredEdges],
  );

  const maxWeight = useMemo(() => {
    let max = 1;
    for (const p of allPairs.values()) if (p.weight > max) max = p.weight;
    return Math.ceil(max);
  }, [allPairs]);

  // Pares que sobrevivem ao slider de força.
  const visiblePairs = useMemo(
    () => [...allPairs.values()].filter((p) => p.weight >= deferredMinWeight),
    [allPairs, deferredMinWeight],
  );

  const connectedHashes = useMemo(() => {
    const s = new Set<string>();
    if (subgraph.center) s.add(subgraph.center.hash);
    for (const p of visiblePairs) {
      s.add(p.a);
      s.add(p.b);
    }
    return s;
  }, [visiblePairs, subgraph.center]);

  const visibleNeighbors = useMemo(
    () => subgraph.neighbors.filter((n) => connectedHashes.has(n.hash)),
    [subgraph.neighbors, connectedHashes],
  );

  const { positions } = useMemo(() => {
    if (!subgraph.center) return { positions: new Map<string, { x: number; y: number }>() };
    return computeLayout(subgraph.center, visibleNeighbors, visiblePairs);
  }, [subgraph.center, visibleNeighbors, visiblePairs]);

  // Caminho mais curto roda sobre os pares visíveis (um "edge" por par).
  const pathEdges = useMemo(
    () => visiblePairs.map((p) => ({ source: p.a, target: p.b })),
    [visiblePairs],
  );
  const path = useMemo(() => {
    if (!pathStart || !selectedHash || pathStart === selectedHash) return null;
    return findShortestPath(pathEdges, pathStart, selectedHash);
  }, [pathStart, selectedHash, pathEdges]);

  const spotlight = useMemo(() => {
    const nodes = new Set<string>();
    const edges = new Set<string>(); // por pairKey
    if (path) {
      for (const h of path.nodes) nodes.add(h);
      for (let i = 0; i < path.nodes.length - 1; i++) {
        const a = path.nodes[i];
        const b = path.nodes[i + 1];
        if (a && b) edges.add(pairKey(a, b));
      }
      return { nodes, edges, kind: 'path' as const };
    }
    if (hoveredHash) {
      nodes.add(hoveredHash);
      for (const p of visiblePairs) {
        if (p.a === hoveredHash || p.b === hoveredHash) {
          edges.add(pairKey(p.a, p.b));
          nodes.add(p.a);
          nodes.add(p.b);
        }
      }
      return { nodes, edges, kind: 'hover' as const };
    }
    return null;
  }, [path, hoveredHash, visiblePairs]);

  const pathNodesByHash = useMemo(() => {
    const m = new Map<string, GraphNodeDto>();
    if (subgraph.center) m.set(subgraph.center.hash, subgraph.center);
    for (const n of subgraph.neighbors) m.set(n.hash, n);
    return m;
  }, [subgraph.center, subgraph.neighbors]);

  const pathStartNode = pathStart ? (pathNodesByHash.get(pathStart) ?? null) : null;

  const selectedNode =
    selectedHash === null
      ? null
      : subgraph.center?.hash === selectedHash
        ? subgraph.center
        : (subgraph.neighbors.find((n) => n.hash === selectedHash) ?? null);

  const finalEdges = useMemo<Edge[]>(
    () =>
      visiblePairs.map((p) => {
        const key = pairKey(p.a, p.b);
        const constituents = constituentsByPair.get(key) ?? [];
        const styleKind = dominantStyle(constituents);
        const style = EDGE_STYLES[styleKind];
        const widthBase = pairStrokeWidth(p.weight, p.diversity);
        const onPath = spotlight?.kind === 'path' && spotlight.edges.has(key);
        const inHover = spotlight?.kind === 'hover' && spotlight.edges.has(key);
        const dimmed = spotlight !== null && !spotlight.edges.has(key);
        return {
          id: key,
          source: p.a,
          target: p.b,
          type: 'floating',
          // Pares multi-tipo nunca tracejam (linha cheia = vínculo "forte/denso").
          style: {
            stroke: onPath ? PATH_HIGHLIGHT : style.stroke,
            strokeDasharray: onPath || p.diversity > 1 ? undefined : style.strokeDasharray,
            strokeWidth: onPath ? widthBase + 1.5 : widthBase,
            opacity: dimmed ? 0.08 : inHover || onPath ? 1 : 0.7,
          },
        };
      }),
    [visiblePairs, constituentsByPair, spotlight],
  );

  const finalNodes = useMemo<Node<NodeData>[]>(() => {
    if (!subgraph.center) return [];
    const pool: GraphNodeDto[] = [subgraph.center, ...visibleNeighbors];
    return pool.map((n) => {
      const pos = positions.get(n.hash) ?? { x: 0, y: 0 };
      const inSpotlight = spotlight?.nodes.has(n.hash) ?? false;
      const dimmed = spotlight !== null && !inSpotlight;
      const onPath = spotlight?.kind === 'path' && spotlight.nodes.has(n.hash);
      return {
        id: n.hash,
        type: n.type,
        position: pos,
        data: {
          dto: n,
          isCenter: n.hash === subgraph.center?.hash,
          inSpotlight,
          dimmed,
          onPath,
          isPathStart: n.hash === pathStart,
          scale: n.hash === subgraph.center?.hash ? 1 : nodeScale(n.weight),
        },
      };
    });
  }, [subgraph.center, visibleNeighbors, positions, spotlight, pathStart]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reactFlow.fitView is stable across renders
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      reactFlow.fitView({ padding: 0.2, duration: 400 });
    });
    return () => cancelAnimationFrame(id);
  }, [finalNodes.length, finalEdges.length, reactFlow]);

  function toggleType(t: NodeType) {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  function toggleEdgeKind(k: EdgeStyleKind) {
    setHiddenEdgeKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  if (!subgraph.center) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
        <p className="text-sm font-medium">Este nó ainda não tem rede mapeada</p>
        <p className="max-w-md text-xs text-muted-foreground">
          A rede é construída a partir das partes e advogados que aparecem nos processos retornados
          pela consulta. Faça uma busca pelo documento (ou aguarde uma busca que o mencione como
          co-parte) para que ele apareça aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">
            <Filter className="size-3" />
            Tipos
          </span>
          {TYPE_ORDER.map((t) => {
            const Icon = TYPE_ICON[t];
            const hidden = hiddenTypes.has(t);
            const count = counts[t];
            if (count === 0) return null;
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors ${
                  hidden
                    ? 'border-border bg-transparent text-muted-foreground line-through'
                    : 'border-foreground/20 bg-foreground/5 text-foreground'
                }`}
              >
                <Icon className="size-3" />
                {TYPE_LABELS[t]} ({count})
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full border border-foreground/20 bg-foreground/5 px-2.5 py-1 text-foreground"
          >
            <Filter className="size-3" />
            Filtros {showAdvanced ? '▾' : '▸'}
          </button>
          <span className="ml-auto text-muted-foreground">
            mostrando {visibleNeighbors.length} de {subgraph.neighbors.length} vizinhos ·{' '}
            {finalEdges.length} vínculo(s)
          </span>
        </div>

        {showAdvanced ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Relações</span>
              <button
                type="button"
                onClick={() => toggleEdgeKind('corporate_relation')}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors ${
                  hiddenEdgeKinds.has('corporate_relation')
                    ? 'border-border bg-transparent text-muted-foreground line-through'
                    : 'border-foreground/20 bg-foreground/5 text-foreground'
                }`}
              >
                <span
                  aria-hidden
                  className="inline-block h-[2px] w-4 rounded"
                  style={{ backgroundColor: EDGE_STYLES.corporate_relation.stroke }}
                />
                Societário
              </button>
              <label className="flex items-center gap-2 text-muted-foreground" htmlFor="min-weight">
                Força ≥
                <input
                  id="min-weight"
                  type="range"
                  min={1}
                  max={Math.max(1, maxWeight)}
                  value={minWeight}
                  onChange={(e) => setMinWeight(Number(e.target.value))}
                  className="w-48 accent-primary"
                />
                <span className="font-mono text-foreground">{minWeight}</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-2 text-[0.7rem] text-muted-foreground">
              <span className="font-medium uppercase tracking-wider">Legenda</span>
              {(
                Object.entries(EDGE_STYLES) as Array<[EdgeStyleKind, (typeof EDGE_STYLES)[EdgeStyleKind]]>
              ).map(([k, s]) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-[2px] w-6"
                    style={
                      s.strokeDasharray
                        ? {
                            backgroundImage: `repeating-linear-gradient(90deg, ${s.stroke} 0 4px, transparent 4px 8px)`,
                          }
                        : { backgroundColor: s.stroke }
                    }
                  />
                  {s.label}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-[3px] w-6 rounded bg-foreground" />
                linha mais grossa = vínculo mais forte
              </span>
            </div>
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="h-[78vh] min-h-[600px] overflow-hidden rounded-xl border border-border bg-card">
          <ReactFlow
            nodes={finalNodes}
            edges={finalEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(_, n) => setSelectedHash(n.id)}
            onNodeMouseEnter={(_, n) => setHoveredHash(n.id)}
            onNodeMouseLeave={() => setHoveredHash(null)}
            onEdgeClick={(_, edge) => {
              // Selecionar a aresta abre o detalhe do par no painel: escolhe o
              // endpoint que não é o centro (ou a origem) para focar o vínculo.
              const other = edge.source === subgraph.center?.hash ? edge.target : edge.source;
              setSelectedHash(other);
            }}
            onPaneClick={() => setHoveredHash(null)}
            fitView
            fitViewOptions={fitViewOptions}
            minZoom={0.05}
          >
            <Background gap={24} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
        <NodeDetailPanel
          node={selectedNode}
          center={subgraph.center}
          edges={subgraph.edges}
          pathStart={pathStart}
          pathStartNode={pathStartNode}
          path={path}
          pathNodesByHash={pathNodesByHash}
          onSetPathStart={setPathStart}
          onClearPathStart={() => setPathStart(null)}
          onPickNode={setSelectedHash}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. (Atenção: `EdgeKind` é importado de `@/lib/graph/types`; confirme que está usado — se o linter reclamar de import não usado, remova-o.)

> Nota: `family_relation` foi adicionado a `EdgeStyleKind`/`EDGE_STYLES` (antes não era classificado e caía em `co_party_unknown`). Isso é um ganho colateral correto.

- [ ] **Step 3: Commit**

```bash
git add 'app/(app)/network/[hash]/network-canvas.tsx'
git commit -m "feat(network): aresta consolidada por peso + prominência de nó + filtro por força"
```

---

## Task 6: Painel — peso do par e drill-down por conexão

**Files:**
- Modify: `app/(app)/network/[hash]/node-detail-panel.tsx`

O `VisaoTab` já lista as arestas incidentes ao nó selecionado. Vamos: (a) garantir `weight: 0` nos fallbacks de `GraphNodeDto`; (b) adicionar um cabeçalho com o **peso do vínculo com o centro** (multiplicidade + diversidade) e (c) manter a lista de cada conexão como o drill-down ("detalhe de cada conexão"). Como o clique na aresta (Task 5) seleciona o outro endpoint, o painel já mostra todas as conexões daquele par.

- [ ] **Step 1: Importar o helper de peso**

No topo de `node-detail-panel.tsx`, junto aos imports de `@/lib/graph/...`:
```ts
import { W_DIV } from '@/lib/graph/edge-weight';
```

- [ ] **Step 2: Corrigir o fallback de nó para incluir `weight`**

Em `CaminhosTab`, no objeto literal de fallback de `n` (dentro do `path.nodes.map`), adicionar `weight: 0` junto de `isPep`/`hasSanction`:
```ts
                      isPep: false,
                      hasSanction: false,
                      weight: 0,
                      lastSeenAt: '',
```

- [ ] **Step 3: Adicionar cabeçalho de peso no `VisaoTab`**

Substituir o `<div>` inicial do `VisaoTab` (o bloco que começa em `<p ...>{node.hash === center.hash ? 'Centro da rede' : 'Vínculo com o centro'}</p>`) para incluir um resumo de peso quando houver vínculo direto com o centro. Logo após `const topEvidences = ...;`, inserir o cálculo:

```tsx
  // Peso do vínculo direto com o centro (mesma fórmula do canvas).
  const directWeight = linkToCenter.reduce(
    (sum, e) => sum + Math.max(1, (e as { weight?: number }).weight ?? 1),
    0,
  );
  const directKinds = new Set(linkToCenter.map((e) => e.kind));
  const pairWeight =
    linkToCenter.length > 0 ? directWeight + W_DIV * (directKinds.size - 1) : 0;
```

E, dentro do primeiro `<div>` do retorno, logo abaixo do `<p>` do título "Vínculo com o centro", inserir o chip de peso (só quando houver vínculo direto):

```tsx
        {linkToCenter.length > 0 ? (
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span className="rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 font-mono tabular-nums text-foreground">
              força {pairWeight}
            </span>
            <span className="text-muted-foreground">
              {directKinds.size} tipo{directKinds.size === 1 ? '' : 's'} ·{' '}
              {linkToCenter.length} conexõe{linkToCenter.length === 1 ? '' : 's'}
            </span>
          </div>
        ) : null}
```

(A lista `topEvidences` logo abaixo continua sendo o drill-down de cada conexão — uma linha por tipo, com `occurrences`/`samePolo`/dados societários, como já era.)

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'app/(app)/network/[hash]/node-detail-panel.tsx'
git commit -m "feat(network): painel mostra força do vínculo + drill-down por conexão"
```

---

## Task 7: Verificação ponta-a-ponta

**Files:** nenhum (verificação).

- [ ] **Step 1: Suíte completa + build**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: testes verdes (incl. `edge-weight`), typecheck/lint limpos, build sem erro.

- [ ] **Step 2: Smoke manual**

1. `pnpm exec supabase db reset` e popular Vault/dispatch (`scripts/bootstrap-vault.sql` + `scripts/bootstrap-dispatch-secrets.sql`).
2. Rodar uma busca por CPF que tenha sócios E parentes (ou usar um documento conhecido), aguardar o enrichment.
3. Abrir `/network/<hash>`:
   - um par ligado por mais de um tipo aparece como **uma** aresta, mais grossa;
   - nós com mais vínculos aparecem **maiores**;
   - o slider "Força ≥" filtra por peso do vínculo;
   - clicar numa aresta abre o painel com a **força** e a lista de cada conexão (drill-down);
   - a legenda mostra "linha mais grossa = vínculo mais forte".

- [ ] **Step 3: Commit (se houver ajuste de smoke)**

```bash
git add -A && git commit -m "chore(network): ajustes pós-smoke de pesos"
```

---

## Task 8 (OPCIONAL — performance): decifrar labels em lote

> Ataca diretamente a lentidão de carregamento citada: hoje `getSubgraph` faz **1 RPC `decrypt_graph_label` por nó** (em ondas de 50 paralelas). Em redes densas isso domina o tempo. Esta task troca por **1 RPC para todas as labels**.

**Files:**
- Create: `supabase/migrations/20260527120100_decrypt_graph_labels_batch.sql`
- Modify: `lib/graph/label-crypto.ts`
- Modify: `app/(app)/network/[hash]/actions.ts`

- [ ] **Step 1: Migration com a RPC plural**

`supabase/migrations/20260527120100_decrypt_graph_labels_batch.sql`:
```sql
-- ============================================================================
-- decrypt_graph_labels: versão em lote de decrypt_graph_label. Recebe um array
-- de ciphertexts (bytea como '\x...') e devolve os plaintexts na mesma ordem.
-- Reduz N round-trips PostgREST a 1 no carregamento da rede. service_role only.
-- ============================================================================
create or replace function public.decrypt_graph_labels(ciphertexts text[])
returns text[]
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  result text[] := '{}';
  c text;
begin
  foreach c in array ciphertexts loop
    result := array_append(result, public.decrypt_graph_label(c::bytea));
  end loop;
  return result;
end;
$$;

revoke all on function public.decrypt_graph_labels(text[]) from public, anon, authenticated;
grant execute on function public.decrypt_graph_labels(text[]) to service_role;
```

> Confirme a assinatura de `decrypt_graph_label` em `supabase/migrations/20260525120000_graph_label_key.sql`. Se o parâmetro dela for `ciphertext bytea` com outro nome, ajuste a chamada interna (`public.decrypt_graph_label(c::bytea)`) para usar o nome correto do parâmetro ou passagem posicional.

- [ ] **Step 2: Aplicar e validar**

Run: `pnpm exec supabase db reset`
Expected: aplica sem erro.

- [ ] **Step 3: Helper `decryptLabels` em `lib/graph/label-crypto.ts`**

Adicionar:
```ts
export async function decryptLabels(
  client: SupabaseClient<Database>,
  ciphertexts: string[],
): Promise<string[]> {
  if (ciphertexts.length === 0) return [];
  const { data, error } = await client.rpc('decrypt_graph_labels' as never, {
    ciphertexts,
  } as never);
  if (error) throw new Error(`decryptLabels failed: ${error.message}`);
  return data as unknown as string[];
}
```

- [ ] **Step 4: Usar em `getSubgraph` (`actions.ts`)**

Substituir `rowsToDtosBatched` por uma versão que decifra tudo num RPC. Trocar o corpo de `rowsToDtosBatched`:
```ts
async function rowsToDtosBatched(admin: AdminClient, rows: NodeRow[]): Promise<GraphNodeDto[]> {
  if (rows.length === 0) return [];
  let plaintexts: string[] = [];
  try {
    plaintexts = await decryptLabels(admin, rows.map((r) => r.encrypted_label));
  } catch (e) {
    console.warn('batch label decrypt failed; falling back to masked previews:', e);
  }
  return rows.map((row, i) => {
    let label: GraphNodeLabel = {};
    try {
      if (plaintexts[i]) label = JSON.parse(plaintexts[i] as string) as GraphNodeLabel;
    } catch (e) {
      console.warn('label parse failed; using masked preview:', e);
    }
    return {
      hash: row.node_hash,
      type: row.node_type,
      label,
      maskedPreview: row.masked_preview,
      isPep: row.is_pep,
      hasSanction: row.has_sanction,
      lastSeenAt: row.last_seen_at,
      weight: row.weight,
    };
  });
}
```
Adicionar `decryptLabels` ao import de `./label-crypto` (já importa `decryptLabel`). O `rowToDto` single segue em uso para o `centerRow` — mantenha.

- [ ] **Step 5: Typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260527120100_decrypt_graph_labels_batch.sql lib/graph/label-crypto.ts 'app/(app)/network/[hash]/actions.ts'
git commit -m "perf(network): decifra labels do subgrafo em 1 RPC (decrypt_graph_labels)"
```

---

## Self-Review (feito)

- **Cobertura do spec:** peso por multiplicidade (occurrences) + diversidade (W_DIV) ✓ (Tasks 1,3); persistido em banco ✓ (Task 1); aresta consolidada mais grossa ✓ (Task 5); cor por tipo dominante ✓ (Task 5); drill-down por conexão ✓ (Tasks 5 onEdgeClick + 6 painel); prominência de nó ✓ (Tasks 1,4,5); performance ✓ (Task 8).
- **Placeholders:** nenhum — todo passo tem SQL/TS/comando concreto.
- **Consistência de tipos:** `weight` em `graph_edges`/`graph_nodes` (Task 2) → `GraphNodeDto.weight`/`GraphEdgeDto.weight`/`NodeRow.weight`/`EdgeRow.weight` (Task 4) → consumido em `consolidatePairs`/`nodeScale` (Tasks 3,5) e no painel (Task 6). `pairKey`/`ConsolidatedPair`/`pairStrokeWidth`/`nodeScale`/`dominantKind`/`W_DIV` definidos na Task 3 e usados nas Tasks 5–6 com as mesmas assinaturas.
- **Riscos a observar na execução:**
  - O fallback de nó em `CaminhosTab` precisa de `weight: 0` (Task 6 Step 2) senão a Task 4 quebra o typecheck — por isso a ordem sugerida pode antecipar esse ajuste.
  - `EdgeKind` import no canvas: só é usado em tipos; se o Biome acusar, remova.
  - Em `decrypt_graph_labels`, confirmar nome/tipo do parâmetro de `decrypt_graph_label`.

---

## Execution Handoff

**Plano salvo em `docs/superpowers/plans/2026-05-27-pesos-arestas-rede-plan.md`. Duas opções de execução:**

**1. Subagent-Driven (recomendado)** — disparo um subagente novo por task, reviso entre tasks, iteração rápida.

**2. Inline Execution** — executo as tasks nesta sessão (executing-plans), com checkpoints de review.

**Qual abordagem?**
