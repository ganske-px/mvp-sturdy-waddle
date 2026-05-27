# Rede orientada a investigação + risco — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expor o `findPathBetween` na UI e tornar a tela de rede mais simples, com um alerta de risco automático (proximidade a PEP/sancionado) que aparece já na tela de resultado e na rede.

**Architecture:** Lógica de proximidade de risco vira função pura testada em Vitest (`findNearestRisk`, espelhando `buildPathResult`). Loaders finos no servidor carregam arestas + hashes arriscados e montam o verdicto. As telas (`/search/result/[hash]` e `/network/[hash]`) são wiring fino sobre `lib/`. Comunidades/hubs do canvas são removidos.

**Tech Stack:** Next.js 16 (App Router) + React 19 + TS strict, Supabase (Postgres 16), Vitest (TDD), Biome, reactflow.

---

## Contexto crítico (ler antes de tocar código)

### Spec
`docs/superpowers/specs/2026-05-27-rede-investigacao-risco-design.md`. As 4 fases abaixo são **independentes e shippáveis em ordem**; cada uma fecha verde sozinha.

### Baseline
`pnpm test` → **358 passing**. Cada fase deve manter/aumentar esse número. Nunca commitar com `pnpm typecheck` ou `pnpm test` vermelho.

### Verdades canônicas já no código (não reinventar)
- `findShortestPath(edges, source, target)` em `lib/graph/path.ts` → `{ nodes: string[]; edgeIndices: number[] } | null`. BFS não-direcionado, self-loops dropados. **Reusar** para o BFS de proximidade (mesma estrutura `adj`).
- `buildPathResult` em `lib/graph/path-result.ts` é o precedente de "wrapper puro testável" — seguir o mesmo estilo.
- `findPathBetween(hashA, hashB)` em `app/(app)/network/[hash]/actions.ts:333` já existe e funciona (carrega todas as arestas via `fetchAllEdges`, retorna `PathBetweenDto = { found, nodes: GraphNodeDto[], hops }`).
- `GraphNodeDto` (actions.ts:28) hoje **não** carrega flags de risco; `NodeRow` (actions.ts:51) não seleciona `is_pep`/`has_sanction`.
- `graph_nodes.is_pep` / `has_sanction` existem (migration `20260526140000`, tipos em `lib/supabase/types.ts:295`). RLS: qualquer operador autenticado lê `graph_nodes`/`graph_edges`.
- `getSubgraphStats` em `lib/graph/subgraph-stats.ts:60` é o padrão de loader leve (server client, **nunca decifra labels**) — espelhar para o verdicto.
- Página de resultado: `networkHash`/`canSeeNetwork`/`networkStats` calculados em `app/(app)/search/result/[hash]/page.tsx:421-439`; render principal começa em `:488`.

### Refinamento de design (importante para a coloração)
O canvas mostra a **vizinhança de 1 salto** do centro. Portanto:
- **Coloração de nó no canvas** = a flag de risco **do próprio nó** (vermelho se `isPep || hasSanction`). Um vizinho arriscado é, por definição, risco direto.
- A camada **âmbar "a 2–3 saltos"** é um sinal **do verdicto** (calculado no grafo inteiro), exibido no banner/cabeçalho — não uma cor por nó na ego-rede. Quando o operador clica "ver caminho até o risco", a rota é desenhada e o nó arriscado-alvo (que é arriscado) aparece vermelho na ponta.

Isso evita calcular distância no grafo inteiro por nó visível (sem otimização prematura) e mantém a história visual coerente.

---

## FASE 1 — `findNearestRisk` (função pura, TDD)

**Por quê primeiro:** é o núcleo do alerta de risco e não depende de UI nem DB. Fecha verde sozinha e alimenta as fases 2 e 4.

**Files:**
- Create: `lib/graph/nearest-risk.ts`
- Create: `lib/graph/nearest-risk.test.ts`

---

- [ ] **Step 1.1: Escrever o teste (falhando)**

Create `lib/graph/nearest-risk.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findNearestRisk } from './nearest-risk';

describe('findNearestRisk', () => {
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'c', target: 'd' },
    { source: 'd', target: 'e' },
  ];

  it('detecta risco direto (1 salto)', () => {
    expect(findNearestRisk(edges, 'a', new Set(['b']), 3)).toEqual({
      found: true,
      targetHash: 'b',
      distance: 1,
      level: 'direct',
    });
  });

  it('detecta risco próximo (2–3 saltos) como nearby', () => {
    expect(findNearestRisk(edges, 'a', new Set(['c']), 3)).toEqual({
      found: true,
      targetHash: 'c',
      distance: 2,
      level: 'nearby',
    });
  });

  it('ignora risco além de maxHops', () => {
    expect(findNearestRisk(edges, 'a', new Set(['e']), 3)).toEqual({
      found: false,
      targetHash: null,
      distance: 0,
      level: 'none',
    });
  });

  it('escolhe o arriscado mais próximo quando há vários', () => {
    const r = findNearestRisk(edges, 'a', new Set(['c', 'd']), 3);
    expect(r.targetHash).toBe('c');
    expect(r.distance).toBe(2);
  });

  it('o próprio centro arriscado não dispara (distance 0 não conta)', () => {
    expect(findNearestRisk(edges, 'a', new Set(['a']), 3)).toEqual({
      found: false,
      targetHash: null,
      distance: 0,
      level: 'none',
    });
  });

  it('sem arriscados → none', () => {
    expect(findNearestRisk(edges, 'a', new Set(), 3).level).toBe('none');
  });
});
```

- [ ] **Step 1.2: Rodar e confirmar falha**

Run: `pnpm test -- lib/graph/nearest-risk`
Expected: FAIL — `Failed to resolve import "./nearest-risk"`.

- [ ] **Step 1.3: Implementar**

Create `lib/graph/nearest-risk.ts`:

```ts
// lib/graph/nearest-risk.ts
type EdgeLike = { source: string; target: string };

export type RiskLevel = 'direct' | 'nearby' | 'none';

export type NearestRisk = {
  found: boolean;
  targetHash: string | null;
  distance: number;
  level: RiskLevel;
};

const NOT_FOUND: NearestRisk = { found: false, targetHash: null, distance: 0, level: 'none' };

/**
 * BFS por nível a partir de `centerHash` sobre uma lista de arestas não-direcionada,
 * retornando o primeiro nó em `riskyHashes` alcançado dentro de `maxHops` saltos.
 * O próprio centro (distância 0) nunca conta — só vizinhança alcançável.
 * level: 1 salto = 'direct'; 2..maxHops = 'nearby'; nada = 'none'.
 */
export function findNearestRisk(
  edges: EdgeLike[],
  centerHash: string,
  riskyHashes: Set<string>,
  maxHops: number,
): NearestRisk {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source)?.push(e.target);
    adj.get(e.target)?.push(e.source);
  }

  const visited = new Set<string>([centerHash]);
  let frontier: string[] = [centerHash];
  for (let distance = 1; distance <= maxHops; distance++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const neighbor of adj.get(node) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        if (riskyHashes.has(neighbor)) {
          return {
            found: true,
            targetHash: neighbor,
            distance,
            level: distance === 1 ? 'direct' : 'nearby',
          };
        }
        next.push(neighbor);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return NOT_FOUND;
}
```

- [ ] **Step 1.4: Rodar e confirmar verde**

Run: `pnpm test -- lib/graph/nearest-risk`
Expected: PASS (6 tests).

- [ ] **Step 1.5: Typecheck + lint + commit**

```bash
pnpm typecheck && pnpm lint:fix
git add lib/graph/nearest-risk.ts lib/graph/nearest-risk.test.ts
git commit -m "feat(graph): findNearestRisk — nó arriscado mais próximo por BFS de nível

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## FASE 2 — Verdicto de risco na tela de resultado (Tela 1)

**Por quê:** entrega o "alerta automático" — o operador vê o risco sem abrir o grafo. Independente da Fase 3/4.

**Files:**
- Create: `lib/graph/risk-verdict.ts` (loader server-only, sem decifrar labels)
- Create: `components/antifraude/risk-verdict-banner.tsx`
- Modify: `app/(app)/search/result/[hash]/page.tsx` (calcular + renderizar)

---

- [ ] **Step 2.1: Loader do verdicto**

Create `lib/graph/risk-verdict.ts`:

```ts
// lib/graph/risk-verdict.ts
import { findNearestRisk, type RiskLevel } from '@/lib/graph/nearest-risk';
import { createClient } from '@/lib/supabase/server';

export const RISK_MAX_HOPS = 3;

export type RiskVerdict = {
  level: RiskLevel;
  distance: number;
  targetHash: string | null;
  /** flags do nó arriscado-alvo, para a copy (PEP vs sanção) */
  isPep: boolean;
  hasSanction: boolean;
};

const NO_RISK: RiskVerdict = {
  level: 'none',
  distance: 0,
  targetHash: null,
  isPep: false,
  hasSanction: false,
};

type EdgeRow = { source_hash: string; target_hash: string };
type RiskyRow = { node_hash: string; is_pep: boolean; has_sanction: boolean };

/**
 * Calcula o verdicto de risco por proximidade no grafo inteiro a partir de um
 * documento central. Nunca decifra labels — trafega só hashes e flags booleanas.
 * Carrega todas as arestas (MVP; sem paginação — espelha findPathBetween).
 */
export async function getRiskVerdict(centerHash: string): Promise<RiskVerdict> {
  const supabase = await createClient();

  const { data: riskyRows } = await supabase
    .from('graph_nodes')
    .select('node_hash, is_pep, has_sanction')
    .or('is_pep.eq.true,has_sanction.eq.true')
    .returns<RiskyRow[]>();
  const risky = riskyRows ?? [];
  if (risky.length === 0) return NO_RISK;

  const riskyByHash = new Map(risky.map((r) => [r.node_hash, r] as const));
  const riskyHashes = new Set(riskyByHash.keys());

  const { data: edgeRows } = await supabase
    .from('graph_edges')
    .select('source_hash, target_hash')
    .returns<EdgeRow[]>();
  const edges = (edgeRows ?? []).map((e) => ({ source: e.source_hash, target: e.target_hash }));

  const nearest = findNearestRisk(edges, centerHash, riskyHashes, RISK_MAX_HOPS);
  if (!nearest.found || nearest.targetHash === null) return NO_RISK;

  const target = riskyByHash.get(nearest.targetHash);
  return {
    level: nearest.level,
    distance: nearest.distance,
    targetHash: nearest.targetHash,
    isPep: target?.is_pep ?? false,
    hasSanction: target?.has_sanction ?? false,
  };
}
```

- [ ] **Step 2.2: Componente do banner**

Create `components/antifraude/risk-verdict-banner.tsx`:

```tsx
// components/antifraude/risk-verdict-banner.tsx
import { buttonVariants } from '@/components/ui/button';
import type { RiskVerdict } from '@/lib/graph/risk-verdict';
import { AlertTriangleIcon, ArrowRightIcon, ShieldAlertIcon } from 'lucide-react';
import Link from 'next/link';

function riskNoun(v: RiskVerdict): string {
  if (v.isPep && v.hasSanction) return 'pessoa PEP e sancionada';
  if (v.isPep) return 'pessoa PEP';
  return 'pessoa/empresa sancionada';
}

export function RiskVerdictBanner({
  verdict,
  networkHash,
}: {
  verdict: RiskVerdict;
  networkHash: string | null;
}) {
  if (verdict.level === 'none' || !networkHash) return null;

  const direct = verdict.level === 'direct';
  const tone = direct
    ? 'border-destructive/40 bg-destructive/10 text-destructive'
    : 'border-warning/40 bg-warning/10 text-warning-foreground';
  const Icon = direct ? ShieldAlertIcon : AlertTriangleIcon;
  const title = direct
    ? `Relação direta com ${riskNoun(verdict)}`
    : `A ${verdict.distance} saltos de ${riskNoun(verdict)}`;

  const href = verdict.targetHash
    ? `/network/${encodeURIComponent(networkHash)}?caminho=${encodeURIComponent(verdict.targetHash)}`
    : `/network/${encodeURIComponent(networkHash)}`;

  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${tone}`} role="alert">
      <Icon className="size-5 shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs opacity-80">
          Vínculo identificado na rede de relacionamentos.
        </p>
      </div>
      <Link
        href={href}
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        Ver caminho
        <ArrowRightIcon className="ml-1 size-3.5" />
      </Link>
    </div>
  );
}
```

> `warning` já é usado no projeto (ver `expand-button.tsx` `border-warning/40 bg-warning/10`). `ShieldAlertIcon`/`AlertTriangleIcon`/`ArrowRightIcon` existem no lucide-react.

- [ ] **Step 2.3: Calcular o verdicto na página**

Em `app/(app)/search/result/[hash]/page.tsx`, adicionar o import (junto dos imports de `@/lib/graph/...`, perto da linha 16):

```ts
import { getRiskVerdict, type RiskVerdict } from '@/lib/graph/risk-verdict';
import { RiskVerdictBanner } from '@/components/antifraude/risk-verdict-banner';
```

Logo após o bloco `networkStats` (depois da linha 439), adicionar:

```ts
  let riskVerdict: RiskVerdict = {
    level: 'none',
    distance: 0,
    targetHash: null,
    isPep: false,
    hasSanction: false,
  };
  if (networkHash && canSeeNetwork) {
    try {
      riskVerdict = await getRiskVerdict(networkHash);
    } catch (e) {
      console.warn('result page: risk verdict failed', e);
    }
  }
```

- [ ] **Step 2.4: Renderizar o banner**

Em `app/(app)/search/result/[hash]/page.tsx`, dentro da coluna principal, logo após a abertura `<div className="flex flex-col gap-6">` (linha 497) e **antes** do `IdentityHero` (linha 498):

```tsx
          <RiskVerdictBanner verdict={riskVerdict} networkHash={networkHash} />
```

- [ ] **Step 2.5: Typecheck + build + commit**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck limpo; testes ≥ 364 (Fase 1 somou 6).

```bash
pnpm lint:fix
git add lib/graph/risk-verdict.ts components/antifraude/risk-verdict-banner.tsx "app/(app)/search/result/[hash]/page.tsx"
git commit -m "feat(result): banner de verdicto de risco por proximidade na rede

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> Verificação manual (fora do TDD): com grafo populado e um vizinho PEP, o banner deve aparecer vermelho; sem risco a ≤3 saltos, não renderiza.

---

## FASE 3 — Risk flags no DTO + canvas enxuto (Tela 2 visual)

**Por quê:** simplifica o canvas (corta comunidades/hubs) e adiciona a coloração de risco no nó. Entrega o "mais simples" e a leitura de risco no grafo.

**Files:**
- Modify: `app/(app)/network/[hash]/actions.ts` (NodeRow + GraphNodeDto + rowToDto)
- Modify: `app/(app)/network/[hash]/network-canvas.tsx` (coloração de risco; remover Louvain/hubs; recolher Filtros)
- Modify: `app/(app)/network/[hash]/node-detail-panel.tsx` (remover aba Comunidade)

---

- [ ] **Step 3.1: `GraphNodeDto` carrega flags de risco**

Em `app/(app)/network/[hash]/actions.ts`:

1. No tipo `GraphNodeDto` (linha 28), adicionar após `maskedPreview: string;`:
```ts
  isPep: boolean;
  hasSanction: boolean;
```

2. No tipo `NodeRow` (linha 51), adicionar após `masked_preview: string;`:
```ts
  is_pep: boolean;
  has_sanction: boolean;
```

3. Em **todos** os `.select(...)` de `graph_nodes` que produzem `NodeRow` — `fetchNodesInChunks` (linha 77), `getSubgraph` centerRow (linha 150) — trocar a string de select para:
```ts
'node_hash, node_type, encrypted_label, masked_preview, last_seen_at, is_pep, has_sanction'
```

4. Em `rowToDto` (linha 119, objeto retornado), adicionar:
```ts
    isPep: row.is_pep,
    hasSanction: row.has_sanction,
```

- [ ] **Step 3.2: Typecheck**

Run: `pnpm typecheck`
Expected: limpo (o `expandNode` select de `node_hash, node_type, encrypted_label` na linha 228 NÃO produz `NodeRow`, então não precisa mudar).

- [ ] **Step 3.3: Coloração de risco no nó (canvas)**

Em `app/(app)/network/[hash]/network-canvas.tsx`, na função `nodeBoxShadow` (linha 71), o risco tem prioridade sobre hub (que será removido na sequência). Substituir o corpo por:

```ts
function nodeBoxShadow(data: NodeData): string | undefined {
  if (data.isPathStart) return `0 0 0 3px ${PATH_HIGHLIGHT}, 0 0 18px ${PATH_HIGHLIGHT}55`;
  if (data.onPath) return `0 0 0 2.5px ${PATH_HIGHLIGHT}`;
  // Risco do próprio nó: anel vermelho. É a única sinalização de risco no canvas
  // (a camada "âmbar a 2–3 saltos" vive no verdicto/cabeçalho, não por nó).
  if (data.dto.isPep || data.dto.hasSanction) return '0 0 0 3px #ef4444, 0 0 14px #ef444455';
  return undefined;
}
```

- [ ] **Step 3.4: Remover comunidades (Louvain) e hubs**

Em `app/(app)/network/[hash]/network-canvas.tsx`:

1. Remover imports não usados no topo: `import louvain from 'graphology-communities-louvain';` (linha 4).
2. Remover as constantes `COMMUNITY_COLORS` (linhas 51-62) e a função `communityColor` (linhas 64-67).
3. Remover `MAX_HUBS` (linha 195) e `hubBudget` (linhas 201-204).
4. Em `NodeData` (linha 34), remover os campos `isHub`, `community`.
5. Em `computeLayout` (linha 211): remover o retorno de `communityById` e `hubSet` e todo o cálculo deles — o bloco Louvain (linhas 262-270), o bloco `weightedDegree`/`budget`/`ranked` (linhas 309-324). A assinatura passa a:
```ts
function computeLayout(
  center: GraphNodeDto,
  visibleNeighbors: GraphNodeDto[],
  visibleEdges: GraphEdgeDto[],
): { positions: Map<string, { x: number; y: number }> } {
```
e o `return` final vira `return { positions };`.
6. Em `InnerCanvas`: o `useMemo` que chama `computeLayout` (linhas 421-430) passa a desestruturar só `{ positions }`; remover `communityById`/`hubSet` do estado derivado. Remover `selectedCommunity` (linha 482) e `membersInSameCommunity` (linhas 483-493).
7. Em `finalNodes` (linha 523), remover `isHub` e `community` do objeto `data`.
8. No JSX da toolbar, remover o `<span className="ml-auto ...">{hubSet.size > 0 ? ...}</span>` (linhas 638-640).
9. No `<NodeDetailPanel .../>` (linha 710), remover as props `community={selectedCommunity}` e `membersInSameCommunity={membersInSameCommunity}`.

- [ ] **Step 3.5: Recolher slider + filtro de relação atrás de "Filtros"**

Em `network-canvas.tsx`, adicionar estado no topo de `InnerCanvas` (perto da linha 346):
```ts
  const [showAdvanced, setShowAdvanced] = useState(false);
```
Envolver o bloco do slider (linhas 643-663) e o botão "Societário" (linhas 622-637) num container condicional. Adicionar um botão toggle na primeira linha da toolbar (após o grupo de Tipos), e renderizar o slider/relação só quando `showAdvanced`:
```tsx
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full border border-foreground/20 bg-foreground/5 px-2.5 py-1 text-foreground"
          >
            <Filter className="size-3" />
            Filtros {showAdvanced ? '▾' : '▸'}
          </button>
```
> Manter a legenda (linhas 665-687) como está, porém só renderizá-la quando `showAdvanced` também (compacta por padrão). Manter o filtro de Tipos sempre visível.

- [ ] **Step 3.6: Remover a aba Comunidade do painel**

Em `app/(app)/network/[hash]/node-detail-panel.tsx`:

1. Em `Tab` (linha 23), trocar para: `type Tab = 'visao' | 'caminhos';`
2. Remover `'comunidade'` de `TAB_LABEL` (linha 25) e `TAB_ICON` (linha 31); remover o import `Layers` (linha 7).
3. Remover a função `ComunidadeTab` inteira (linhas 152-201).
4. No `NodeDetailPanel`, remover as props `community` e `membersInSameCommunity` da assinatura (linhas 354-355) e do tipo (linhas 339-340).
5. No render das abas (linha 394), trocar o array para `(['visao', 'caminhos'] as const)`.
6. Remover o bloco `{tab === 'comunidade' ? (...) : null}` (linhas 416-423).

- [ ] **Step 3.7: Typecheck + build + commit**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck limpo; testes ≥ 364 (sem novos testes; nada deve quebrar).

```bash
pnpm lint:fix
git add "app/(app)/network/[hash]/actions.ts" "app/(app)/network/[hash]/network-canvas.tsx" "app/(app)/network/[hash]/node-detail-panel.tsx"
git commit -m "feat(network): coloração de risco no nó + corta comunidades/hubs + recolhe filtros

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> Verificação manual: canvas sem anéis de comunidade/hub; nó PEP/sancionado com anel vermelho; slider e legenda só sob "Filtros"; painel com 2 abas.

---

## FASE 4 — Cabeçalho de investigação: verdicto + busca de destino + caminho

**Por quê:** expõe o `findPathBetween` na UI (carro-chefe do pedido). Liga o deep-link de risco da Fase 2 e o campo de destino.

**Files:**
- Modify: `app/(app)/network/[hash]/actions.ts` (action `findPathToDocument` — hash server-side)
- Create: `app/(app)/network/[hash]/path-result-panel.tsx` (lista ordenada do caminho)
- Modify: `app/(app)/network/[hash]/network-header.tsx` (verdicto + campo "traçar caminho")
- Create: `app/(app)/network/[hash]/network-shell.tsx` (estado do caminho + deep-link)
- Modify: `app/(app)/network/[hash]/page.tsx` (passar verdicto + ler `?caminho=`)

---

- [ ] **Step 4.1: Server Action que hash-eia o destino (LGPD: hash só no servidor)**

> `hashDocument` usa `node:crypto` (`createHash`) — **não roda no cliente**. O header valida CPF/CNPJ (validators são puros, client-safe) e envia `type` + valor cru a esta action, que hash-eia no servidor e delega ao `findPathBetween` existente. O valor cru é transiente (como numa busca) — não logar.

Em `app/(app)/network/[hash]/actions.ts`, ao final do arquivo (o import `hashDocument` já existe na linha 8):

```ts
export async function findPathToDocument(
  centerHash: string,
  type: 'cpf' | 'cnpj',
  rawValue: string,
): Promise<PathBetweenDto> {
  await requirePermission('search_network');
  const targetHash = hashDocument(type, rawValue);
  return findPathBetween(centerHash, targetHash);
}
```

- [ ] **Step 4.2: Componente de resultado de caminho (lista)**

> O caminho do grafo inteiro pode incluir nós **fora** da ego-rede de 1 salto carregada no canvas; por isso o resultado é mostrado como **lista ordenada clicável** (cada nó com "ver rede deste nó"), não exigindo que o canvas renderize a rota inteira.

Create `app/(app)/network/[hash]/path-result-panel.tsx`:

```tsx
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRightIcon, RouteIcon, XIcon } from 'lucide-react';
import Link from 'next/link';
import type { PathBetweenDto } from './actions';

export function PathResultPanel({
  result,
  onClear,
}: {
  result: PathBetweenDto | null;
  onClear: () => void;
}) {
  if (!result) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <RouteIcon className="size-4" />
          {result.found ? `Caminho — ${result.hops} salto(s)` : 'Sem caminho'}
        </CardTitle>
        <button type="button" onClick={onClear} aria-label="Limpar caminho">
          <XIcon className="size-4 text-muted-foreground hover:text-foreground" />
        </button>
      </CardHeader>
      <CardContent>
        {!result.found ? (
          <p className="text-xs text-muted-foreground">
            Não há conexão conhecida entre os dois documentos no grafo atual.
          </p>
        ) : (
          <ol className="space-y-1">
            {result.nodes.map((n, idx) => (
              <li key={n.hash} className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{idx + 1}</span>
                <Link
                  href={`/network/${encodeURIComponent(n.hash)}`}
                  className="flex flex-1 items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 text-xs transition-colors hover:bg-muted"
                >
                  <span className="truncate font-medium">{n.label.name ?? n.maskedPreview}</span>
                  <span className="text-[0.65rem] uppercase text-muted-foreground">{n.type}</span>
                </Link>
                {idx < result.nodes.length - 1 ? (
                  <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground" />
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4.3: Cabeçalho com verdicto + campo "traçar caminho"**

Reescrever `app/(app)/network/[hash]/network-header.tsx`. O campo de destino valida CPF/CNPJ no cliente (validators são puros, client-safe) e chama a action `findPathToDocument` (hash no servidor); o resultado sobe via callback. O verdicto vem do server (prop). O deep-link `?caminho=` é disparado no mount pela shell (Step 4.4) — aqui só exibimos o campo manual e o verdicto. O botão do verdicto chama `findPathBetween` direto (o `targetHash` já é hash).

```tsx
'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { RiskVerdict } from '@/lib/graph/risk-verdict';
import { isValid as isCnpjValid } from '@/lib/validators/cnpj';
import { isValid as isCpfValid } from '@/lib/validators/cpf';
import { AlertTriangleIcon, ShieldAlertIcon } from 'lucide-react';
import { useState, useTransition } from 'react';
import { findPathBetween, findPathToDocument, type PathBetweenDto } from './actions';

export function NetworkHeader({
  centerName,
  centerHash,
  verdict,
  onPath,
}: {
  centerName: string | null;
  centerHash: string;
  verdict: RiskVerdict;
  onPath: (result: PathBetweenDto) => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function runPath(targetHash: string) {
    startTransition(async () => {
      const result = await findPathBetween(centerHash, targetHash);
      onPath(result);
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const raw = value.trim();
    const type = isCpfValid(raw) ? 'cpf' : isCnpjValid(raw) ? 'cnpj' : null;
    if (!type) {
      setError('Informe um CPF ou CNPJ válido.');
      return;
    }
    startTransition(async () => {
      const result = await findPathToDocument(centerHash, type, raw);
      onPath(result);
    });
  }

  const showVerdict = verdict.level !== 'none';
  const direct = verdict.level === 'direct';

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
          Visão de rede
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          {centerName ? `Rede de ${centerName}` : 'Rede'}
        </h1>
      </div>

      {showVerdict ? (
        <div
          role="alert"
          className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
            direct
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : 'border-warning/40 bg-warning/10 text-warning-foreground'
          }`}
        >
          {direct ? (
            <ShieldAlertIcon className="size-5 shrink-0" />
          ) : (
            <AlertTriangleIcon className="size-5 shrink-0" />
          )}
          <div className="flex-1">
            <p className="text-sm font-semibold">
              {direct
                ? 'Relação direta com PEP/sancionado'
                : `A ${verdict.distance} saltos de PEP/sancionado`}
            </p>
          </div>
          {verdict.targetHash ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => verdict.targetHash && runPath(verdict.targetHash)}
            >
              {pending ? 'Traçando…' : 'Ver caminho até o risco'}
            </Button>
          ) : null}
        </div>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3"
      >
        <Input
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Traçar caminho até CPF ou CNPJ"
          className="w-full max-w-xs font-mono"
          autoComplete="off"
        />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Traçando…' : 'Traçar caminho'}
        </Button>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </form>
    </header>
  );
}
```

> Removeu o antigo `navigateToNetwork` do header (navegar pra outra rede). Continua possível navegar via "ver rede deste nó" no painel/lista. `findPathBetween` já tem `requirePermission('search_network')` no servidor.

- [ ] **Step 4.4: Page passa verdicto, segura o estado do caminho e lê `?caminho=`**

> `NetworkHeader` agora recebe `onPath` e o `PathResultPanel` precisa de estado compartilhado → introduzir um wrapper client `NetworkShell` que segura o `pathResult`, renderiza header + canvas + painel de caminho, e dispara o deep-link `?caminho=` no mount.

Create `app/(app)/network/[hash]/network-shell.tsx`:

```tsx
'use client';

import type { RiskVerdict } from '@/lib/graph/risk-verdict';
import { useEffect, useState } from 'react';
import { findPathBetween, type PathBetweenDto, type SubgraphDto } from './actions';
import { NetworkCanvas } from './network-canvas';
import { NetworkHeader } from './network-header';
import { PathResultPanel } from './path-result-panel';

export function NetworkShell({
  subgraph,
  verdict,
  centerHash,
  deepLinkTarget,
}: {
  subgraph: SubgraphDto;
  verdict: RiskVerdict;
  centerHash: string;
  deepLinkTarget: string | null;
}) {
  const [pathResult, setPathResult] = useState<PathBetweenDto | null>(null);

  // Deep-link "ver caminho até o risco" vindo da tela de resultado (?caminho=hash).
  // biome-ignore lint/correctness/useExhaustiveDependencies: dispara uma vez no mount
  useEffect(() => {
    if (!deepLinkTarget) return;
    let active = true;
    findPathBetween(centerHash, deepLinkTarget).then((r) => {
      if (active) setPathResult(r);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <NetworkHeader
        centerName={subgraph.center?.label.name ?? null}
        centerHash={centerHash}
        verdict={verdict}
        onPath={setPathResult}
      />
      <PathResultPanel result={pathResult} onClear={() => setPathResult(null)} />
      <NetworkCanvas subgraph={subgraph} />
    </>
  );
}
```

Reescrever `app/(app)/network/[hash]/page.tsx`:

```tsx
import { requirePermission } from '@/lib/auth/permissions';
import { getRiskVerdict } from '@/lib/graph/risk-verdict';
import { getSubgraph } from './actions';
import { NetworkShell } from './network-shell';

export const metadata = {
  title: 'Rede — Radar PX',
};

export default async function NetworkPage({
  params,
  searchParams,
}: {
  params: Promise<{ hash: string }>;
  searchParams: Promise<{ caminho?: string }>;
}) {
  await requirePermission('search_network');
  const { hash } = await params;
  const { caminho } = await searchParams;
  const decoded = decodeURIComponent(hash);
  const subgraph = await getSubgraph(decoded);
  const verdict = await getRiskVerdict(decoded);

  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-6 py-8">
      <NetworkShell
        subgraph={subgraph}
        verdict={verdict}
        centerHash={decoded}
        deepLinkTarget={caminho ? decodeURIComponent(caminho) : null}
      />
    </main>
  );
}
```

- [ ] **Step 4.5: Typecheck + build + commit**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck limpo; testes ≥ 364.

```bash
pnpm lint:fix
git add "app/(app)/network/[hash]/actions.ts" "app/(app)/network/[hash]/path-result-panel.tsx" "app/(app)/network/[hash]/network-shell.tsx" "app/(app)/network/[hash]/network-header.tsx" "app/(app)/network/[hash]/page.tsx"
git commit -m "feat(network): cabeçalho de investigação — verdicto, busca de destino e caminho (findPathBetween)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> Verificação manual: campo "traçar caminho até [doc]" desenha a lista de saltos; botão "ver caminho até o risco" e o deep-link `?caminho=` da tela de resultado abrem a rede com a rota já calculada.

---

## Self-review (cobertura × spec)

- **Job risco automático (Tela 1)** → Fase 2 (loader + banner + wire). ✓
- **Risco em camadas (direto/próximo ≤3)** → Fase 1 (`findNearestRisk` níveis) + `RISK_MAX_HOPS=3`. ✓
- **findPathBetween na UI (busca destino + dirigido por risco)** → Fase 4 (campo + botão verdicto + deep-link). ✓
- **Coloração de risco no nó** → Fase 3 (DTO flags + `nodeBoxShadow`). ✓
- **Simplificar: cortar comunidades/hubs, recolher filtros, 2 abas** → Fase 3. ✓
- **Investigação em foco (verdicto no topo)** → Fase 4 (cabeçalho). ✓
- **LGPD (sem decifrar label no verdicto, só hashes/flags)** → Fase 2 `getRiskVerdict`. ✓
- **Sem otimização prematura (BFS em memória)** → Fases 1/2 carregam arestas como `findPathBetween`. ✓

Consistência de tipos: `findNearestRisk → NearestRisk{level,distance,targetHash}` (1.3) consumido por `getRiskVerdict → RiskVerdict` (2.1); `RiskVerdict` usado em `RiskVerdictBanner` (2.2) e `NetworkHeader` (4.2)/`NetworkShell` (4.3). `GraphNodeDto.isPep/hasSanction` (3.1) lido em `nodeBoxShadow` via `data.dto` (3.3). `PathBetweenDto` (existente) consumido por `PathResultPanel` (4.1) e `NetworkShell` (4.3). Nomes batem.

## Riscos & notas de execução

1. **Edge Functions não afetadas** — esta entrega é só leitura/UI; nenhum redeploy de função necessário. A migration de risco (`20260526140000`) já deve estar aplicada (pré-requisito da Fase 2 dar verdicto não-vazio).
2. **`getRiskVerdict` carrega todas as arestas por chamada** — aceitável no MVP; revisitar se `graph_edges` crescer.
3. **Caminho do grafo inteiro vs ego-rede** — o `PathResultPanel` mostra a rota como lista; o canvas não re-renderiza nós fora do 1-salto (decisão consciente, sem otimização prematura).
4. **`app/**` é wiring fino** — sem testes unitários novos (convenção do repo); validação por `pnpm build` + smoke manual. Os testes que crescem são os de `lib/**` (Fase 1).
5. Cada fase é independente: dá pra parar, mergear e retomar entre fases.
```
