# Reestruturação da tela de resultado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Repo policy:** Este repositório commita **só quando o usuário pede**. Ignore os passos de "commit" do template padrão — em vez disso cada task termina com `pnpm typecheck` + (se houver `lib/`) `pnpm test`. O commit final é feito pelo orquestrador ao fim, após `pnpm build`.

**Goal:** Reestruturar `/search/result/[hash]` para focar na identidade (hero), tornar a rede sempre presente (trilho sticky com stats), expor todos os dados via collapses, integrar `RelatedPeople`, e remover ruído (cache/arquivo/timestamp/nome de fornecedor).

**Architecture:** Mudança puramente de apresentação. A página vira um grid de 2 colunas: coluna principal (hero + seções colapsáveis) + trilho de rede sticky. Lógica de extração de payload permanece em `page.tsx`. Novos: 1 loader de stats do grafo (`lib/graph/subgraph-stats.ts`, TDD), 1 módulo de labels de parentesco (`lib/netrin/relationship-labels.ts`, TDD), e 3 componentes (`IdentityHero`, `NetworkRail`, `ResultSection`) + `FamilyChips`. Cards existentes ganham modo `bare` para encaixar nos collapses sem aninhar `<Card>`.

**Tech Stack:** Next.js 16 App Router, React 19 (server + client components), TypeScript strict, Tailwind 4, shadcn/ui, Vitest, Biome.

**Convenções obrigatórias (CLAUDE.md):** pt-BR em toda copy; **nunca** citar fornecedor (Predictus/Netrin); **nunca** CPF/CNPJ/nome em log; sem `as any` (use `as never` com comentário); imports absolutos `@/`; `import type`; TDD para `lib/**`.

---

## File Structure

| Arquivo | Responsabilidade | Ação |
|---------|------------------|------|
| `lib/graph/subgraph-stats.ts` | `deriveSubgraphStats` (puro) + `getSubgraphStats` (loader) | Criar |
| `lib/graph/subgraph-stats.test.ts` | Testa `deriveSubgraphStats` | Criar |
| `lib/netrin/relationship-labels.ts` | `RELATIONSHIP_LABELS`, `relationshipLabel`, `isFirstDegree` | Criar |
| `lib/netrin/relationship-labels.test.ts` | Testa labels + `isFirstDegree` | Criar |
| `components/antifraude/result-section.tsx` | Wrapper colapsável genérico (client) | Criar |
| `components/antifraude/family-chips.tsx` | Chips clicáveis do núcleo familiar (client) | Criar |
| `components/antifraude/identity-hero.tsx` | Hero unificado CPF/CNPJ (server) | Criar |
| `components/antifraude/network-rail.tsx` | Trilho de rede sticky (server) | Criar |
| `components/antifraude/related-people.tsx` | Usar labels compartilhados + modo `bare` | Modificar |
| `components/antifraude/pep-card.tsx` | Modo `bare` | Modificar |
| `components/antifraude/media-card.tsx` | Modo `bare` | Modificar |
| `components/antifraude/sancoes-card-cnpj.tsx` | Modo `bare` | Modificar |
| `components/antifraude/related-companies.tsx` | Modo `bare` | Modificar |
| `components/antifraude/socios-card.tsx` | Modo `bare` | Modificar |
| `app/(app)/search/result/[hash]/page.tsx` | Novo layout + composição + remoções + copy | Modificar |

---

## Task 1: `deriveSubgraphStats` + loader (TDD)

**Files:**
- Create: `lib/graph/subgraph-stats.ts`
- Test: `lib/graph/subgraph-stats.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/graph/subgraph-stats.test.ts
import { describe, expect, it } from 'vitest';
import { deriveSubgraphStats } from './subgraph-stats';

describe('deriveSubgraphStats', () => {
  it('counts neighbors by type and edges by kind, ignoring the center', () => {
    const stats = deriveSubgraphStats(
      'CENTER',
      [
        { node_hash: 'CENTER', node_type: 'cpf' },
        { node_hash: 'A', node_type: 'cpf' },
        { node_hash: 'B', node_type: 'cnpj' },
        { node_hash: 'A', node_type: 'cpf' }, // duplicate neighbor
        { node_hash: 'L', node_type: 'lawyer' },
      ],
      [
        { kind: 'family_relation' },
        { kind: 'corporate_relation' },
        { kind: 'co_party' },
        { kind: 'client_lawyer' },
        { kind: 'lawyer_lawyer' },
      ],
    );
    expect(stats).toEqual({
      nodes: 3, // A, B, L (CENTER excluded, A deduped)
      edges: 5,
      people: 1, // A
      companies: 1, // B
      familyEdges: 1,
      corporateEdges: 1,
      processEdges: 3, // co_party + client_lawyer + lawyer_lawyer
    });
  });

  it('returns all-zero stats for an empty subgraph', () => {
    expect(deriveSubgraphStats('CENTER', [], [])).toEqual({
      nodes: 0,
      edges: 0,
      people: 0,
      companies: 0,
      familyEdges: 0,
      corporateEdges: 0,
      processEdges: 0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- lib/graph/subgraph-stats`
Expected: FAIL — "Failed to resolve import './subgraph-stats'".

- [ ] **Step 3: Write implementation**

```ts
// lib/graph/subgraph-stats.ts
import { createClient } from '@/lib/supabase/server';
import type { EdgeKind, NodeType } from './types';

export type SubgraphStats = {
  nodes: number;
  edges: number;
  people: number;
  companies: number;
  familyEdges: number;
  corporateEdges: number;
  processEdges: number;
};

export function deriveSubgraphStats(
  centerHash: string,
  neighbors: { node_hash: string; node_type: NodeType }[],
  edges: { kind: EdgeKind }[],
): SubgraphStats {
  const uniqueNeighbors = new Map<string, NodeType>();
  for (const n of neighbors) {
    if (n.node_hash !== centerHash) uniqueNeighbors.set(n.node_hash, n.node_type);
  }

  let people = 0;
  let companies = 0;
  for (const type of uniqueNeighbors.values()) {
    if (type === 'cpf') people++;
    else if (type === 'cnpj') companies++;
  }

  let familyEdges = 0;
  let corporateEdges = 0;
  let processEdges = 0;
  for (const e of edges) {
    if (e.kind === 'family_relation') familyEdges++;
    else if (e.kind === 'corporate_relation') corporateEdges++;
    else processEdges++; // co_party | client_lawyer | lawyer_lawyer
  }

  return {
    nodes: uniqueNeighbors.size,
    edges: edges.length,
    people,
    companies,
    familyEdges,
    corporateEdges,
    processEdges,
  };
}

type EdgeRow = { source_hash: string; target_hash: string; kind: EdgeKind };
type NodeRow = { node_hash: string; node_type: NodeType };

/**
 * Lightweight 1-hop stats for the result-page network rail. Unlike getSubgraph,
 * it never decrypts labels — only counts node types and edge kinds. RLS allows
 * any authenticated operator to read graph_nodes/graph_edges, so it uses the
 * cookie-aware server client.
 */
export async function getSubgraphStats(centerHash: string): Promise<SubgraphStats> {
  const supabase = await createClient();

  const { data: edgeRows } = await supabase
    .from('graph_edges')
    .select('source_hash, target_hash, kind')
    .or(`source_hash.eq.${centerHash},target_hash.eq.${centerHash}`)
    .returns<EdgeRow[]>();

  const edges = edgeRows ?? [];
  const neighborHashes = Array.from(
    new Set(edges.flatMap((e) => [e.source_hash, e.target_hash]).filter((h) => h !== centerHash)),
  );

  let neighbors: NodeRow[] = [];
  if (neighborHashes.length > 0) {
    const { data } = await supabase
      .from('graph_nodes')
      .select('node_hash, node_type')
      .in('node_hash', neighborHashes)
      .returns<NodeRow[]>();
    neighbors = data ?? [];
  }

  return deriveSubgraphStats(
    centerHash,
    neighbors,
    edges.map((e) => ({ kind: e.kind })),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- lib/graph/subgraph-stats`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

---

## Task 2: `relationship-labels` shared module (TDD)

**Files:**
- Create: `lib/netrin/relationship-labels.ts`
- Test: `lib/netrin/relationship-labels.test.ts`
- Modify: `components/antifraude/related-people.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// lib/netrin/relationship-labels.test.ts
import { describe, expect, it } from 'vitest';
import { isFirstDegree, relationshipLabel } from './relationship-labels';

describe('relationshipLabel', () => {
  it('maps known codes to pt-BR labels', () => {
    expect(relationshipLabel('MOTHER')).toBe('Mãe');
    expect(relationshipLabel('SPOUSE')).toBe('Cônjuge');
  });
  it('falls back to a generic label for unknown or missing codes', () => {
    expect(relationshipLabel('SOMETHING_ELSE')).toBe('Vínculo familiar');
    expect(relationshipLabel(undefined)).toBe('Vínculo familiar');
  });
});

describe('isFirstDegree', () => {
  it('returns true for parents, spouse and children', () => {
    expect(isFirstDegree('MOTHER')).toBe(true);
    expect(isFirstDegree('SPOUSE')).toBe(true);
    expect(isFirstDegree('SON')).toBe(true);
  });
  it('returns false for distant or missing relationships', () => {
    expect(isFirstDegree('COUSIN')).toBe(false);
    expect(isFirstDegree(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- lib/netrin/relationship-labels`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// lib/netrin/relationship-labels.ts
export const RELATIONSHIP_LABELS: Record<string, string> = {
  MOTHER: 'Mãe',
  FATHER: 'Pai',
  PARENT: 'Pai/Mãe',
  GRANDPARENT: 'Avô/Avó',
  GRANDCHILD: 'Neto(a)',
  SON: 'Filho',
  DAUGHTER: 'Filha',
  CHILD: 'Filho(a)',
  SIBLING: 'Irmão/Irmã',
  BROTHER: 'Irmão',
  SISTER: 'Irmã',
  UNCLE: 'Tio/Tia',
  AUNT: 'Tia',
  NEPHEW: 'Sobrinho(a)',
  NIECE: 'Sobrinho(a)',
  COUSIN: 'Primo(a)',
  SPOUSE: 'Cônjuge',
  PARTNER: 'Companheiro(a)',
  IN_LAW: 'Parente por afinidade',
};

export function relationshipLabel(tipo?: string): string {
  if (!tipo) return 'Vínculo familiar';
  return RELATIONSHIP_LABELS[tipo] ?? 'Vínculo familiar';
}

const FIRST_DEGREE = new Set([
  'MOTHER',
  'FATHER',
  'PARENT',
  'SPOUSE',
  'PARTNER',
  'SON',
  'DAUGHTER',
  'CHILD',
]);

/** Parentes do núcleo próximo, exibidos no hero de identidade. */
export function isFirstDegree(tipo?: string): boolean {
  return !!tipo && FIRST_DEGREE.has(tipo);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- lib/netrin/relationship-labels`
Expected: PASS (4 tests).

- [ ] **Step 5: Update `related-people.tsx` to use the shared module**

In `components/antifraude/related-people.tsx`: delete the local `RELATIONSHIP_LABELS` const and the local `relationshipLabel` function (lines defining them), and add this import near the other imports:

```ts
import { relationshipLabel } from '@/lib/netrin/relationship-labels';
```

The JSX call `relationshipLabel(p.tipoRelacionamento)` stays unchanged.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

---

## Task 3: `ResultSection` collapsible wrapper

**Files:**
- Create: `components/antifraude/result-section.tsx`

- [ ] **Step 1: Verify the `cn` helper exists**

Run: `grep -n "export function cn" lib/utils.ts`
Expected: a match. (If absent, find the existing `cn` import path used by other components in `components/ui/` and use that instead.)

- [ ] **Step 2: Write the component**

```tsx
'use client';

// components/antifraude/result-section.tsx
import { cn } from '@/lib/utils';
import { ChevronDownIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';

export type ResultSectionProps = {
  title: string;
  icon?: ReactNode;
  /** Veredito/contagem sempre visível no cabeçalho, ao lado do chevron. */
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
};

export function ResultSection({
  title,
  icon,
  summary,
  defaultOpen = false,
  children,
}: ResultSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <span className="flex items-center gap-2 font-medium text-foreground">
          {icon ? <span className="text-muted-foreground">{icon}</span> : null}
          {title}
        </span>
        <span className="flex items-center gap-3 text-sm text-muted-foreground">
          {summary}
          <ChevronDownIcon
            className={cn('size-4 shrink-0 transition-transform duration-200', open && 'rotate-180')}
          />
        </span>
      </button>
      {open ? <div className="border-t border-border/60 px-4 py-4">{children}</div> : null}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

---

## Task 4: `bare` mode for the info cards (PEP, Mídia, Sanções)

These cards must render *without* their own `<Card>` wrapper when placed inside a `ResultSection`. Add an optional `bare?: boolean` prop; when true, return only the inner content.

**Files:**
- Modify: `components/antifraude/pep-card.tsx`
- Modify: `components/antifraude/media-card.tsx`
- Modify: `components/antifraude/sancoes-card-cnpj.tsx`

- [ ] **Step 1: `pep-card.tsx`**

Add `bare?: boolean` to `PepCardProps` in `components/antifraude/types.ts`:

```ts
export type PepCardProps = {
  status: AntifraudeStatus;
  currentlyPEP?: boolean;
  currentlySanctioned?: boolean;
  previouslySanctioned?: boolean;
  historicoCount?: number;
  bare?: boolean;
};
```

Refactor `pep-card.tsx` to extract the inner JSX into a `body` constant and branch on `bare`:

```tsx
// components/antifraude/pep-card.tsx
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { PepCardProps } from './types';

export function PepCard({
  status,
  currentlyPEP,
  currentlySanctioned,
  previouslySanctioned,
  historicoCount,
  bare,
}: PepCardProps) {
  const skeleton = status === 'pending' || status === 'running';
  const body = skeleton ? (
    <>
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-1/3" />
    </>
  ) : status === 'error' ? (
    <p className="text-muted-foreground">Indisponível.</p>
  ) : (
    <>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">PEP atual:</span>
        {currentlyPEP ? <Badge variant="destructive">Sim</Badge> : <Badge variant="secondary">Não</Badge>}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Sancionado atual:</span>
        {currentlySanctioned ? (
          <Badge variant="destructive">Sim</Badge>
        ) : (
          <Badge variant="secondary">Não</Badge>
        )}
      </div>
      {previouslySanctioned ? (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Sanção pregressa:</span>
          <Badge variant="outline">Sim</Badge>
        </div>
      ) : null}
      <div>
        <span className="text-muted-foreground">Histórico:</span> {historicoCount ?? 0} registros
      </div>
    </>
  );

  if (bare) return <div className="space-y-2 text-sm">{body}</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">PEP / Sanções</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">{body}</CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: `media-card.tsx`**

Add `bare?: boolean` to `MediaCardProps` in `components/antifraude/types.ts` (append the field). Then refactor `media-card.tsx` the same way — extract `body`, branch on `bare`:

```tsx
// components/antifraude/media-card.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { MediaCardProps } from './types';

export function MediaCard({ status, mencoes, qtdMidias, qtdListas, qtdGov, qtdAmb, bare }: MediaCardProps) {
  const skeleton = status === 'pending' || status === 'running';
  const body = skeleton ? (
    <Skeleton className="h-4 w-1/3" />
  ) : status === 'error' ? (
    <p className="text-muted-foreground">Indisponível.</p>
  ) : (
    <>
      <div className="text-base font-medium">
        {mencoes ?? 0} <span className="text-muted-foreground text-sm">menções</span>
      </div>
      <ul className="space-y-1 text-xs text-muted-foreground">
        <li>Mídias: {qtdMidias ?? 0}</li>
        <li>Listas restritivas: {qtdListas ?? 0}</li>
        <li>Governamentais: {qtdGov ?? 0}</li>
        <li>Socioambientais: {qtdAmb ?? 0}</li>
      </ul>
    </>
  );

  if (bare) return <div className="space-y-2 text-sm">{body}</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mídia &amp; risco reputacional</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">{body}</CardContent>
    </Card>
  );
}
```

Update `MediaCardProps` in `types.ts`:

```ts
export type MediaCardProps = {
  status: AntifraudeStatus;
  mencoes?: number;
  qtdMidias?: number;
  qtdListas?: number;
  qtdGov?: number;
  qtdAmb?: number;
  bare?: boolean;
};
```

- [ ] **Step 3: `sancoes-card-cnpj.tsx`**

Add `bare?: boolean` to its inline `SancoesCardCnpjProps`, extract `body`, branch:

```tsx
// components/antifraude/sancoes-card-cnpj.tsx
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export type SancoesCardCnpjProps = {
  status: 'missing' | 'running' | 'success' | 'error';
  sancionado?: boolean;
  ceis?: { ativo: boolean; descricao?: string }[];
  cnep?: { ativo: boolean; descricao?: string }[];
  trabalhoEscravo?: boolean;
  bare?: boolean;
};

export function SancoesCardCnpj({ status, sancionado, ceis, cnep, trabalhoEscravo, bare }: SancoesCardCnpjProps) {
  const ceisAtivos = (ceis ?? []).filter((c) => c.ativo).length;
  const cnepAtivos = (cnep ?? []).filter((c) => c.ativo).length;
  const algumProblema = sancionado || ceisAtivos > 0 || cnepAtivos > 0 || trabalhoEscravo;

  const body =
    status === 'running' ? (
      <>
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
      </>
    ) : status === 'error' ? (
      <p className="text-muted-foreground">Indisponível.</p>
    ) : status === 'missing' ? (
      <p className="text-muted-foreground">Sem dados.</p>
    ) : !algumProblema ? (
      <Badge variant="success">Sem restrições</Badge>
    ) : (
      <div className="flex flex-wrap gap-1">
        {sancionado ? <Badge variant="destructive">Sancionado</Badge> : null}
        {ceisAtivos > 0 ? <Badge variant="destructive">CEIS: {ceisAtivos} ativo(s)</Badge> : null}
        {cnepAtivos > 0 ? <Badge variant="destructive">CNEP: {cnepAtivos} ativo(s)</Badge> : null}
        {trabalhoEscravo ? <Badge variant="destructive">Trabalho escravo</Badge> : null}
      </div>
    );

  if (bare) return <div className="space-y-2 text-sm">{body}</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sanções e restrições</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">{body}</CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

---

## Task 5: `bare` mode for the relationship lists

Same pattern for the three lists. Each currently wraps a `<Card>` with title `… (N)`; in `bare` mode drop the `<Card>`/`<CardHeader>` and render only the list body (the count moves to the `ResultSection` summary in `page.tsx`).

**Files:**
- Modify: `components/antifraude/related-companies.tsx`
- Modify: `components/antifraude/related-people.tsx`
- Modify: `components/antifraude/socios-card.tsx`

- [ ] **Step 1: `related-companies.tsx`**

Add `bare?: boolean` to `RelatedCompaniesProps` in `types.ts`:

```ts
export type RelatedCompaniesProps = {
  status: AntifraudeStatus;
  items: RelatedCompanyEntry[];
  currentPath?: string;
  bare?: boolean;
};
```

In `related-companies.tsx`, extract the current `<CardContent>` children into a `body` constant and branch:

```tsx
export function RelatedCompanies({ status, items, currentPath, bare }: RelatedCompaniesProps) {
  const skeleton = status === 'pending' || status === 'running';
  const body = skeleton ? (
    <>
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-5 w-2/3" />
    </>
  ) : items.length === 0 ? (
    <p className="text-muted-foreground">Nenhuma empresa vinculada.</p>
  ) : (
    items.map((c) => (
      /* …unchanged existing per-company JSX… */
    ))
  );

  if (bare) return <div className="space-y-3 text-sm">{body}</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Empresas relacionadas ({items.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">{body}</CardContent>
    </Card>
  );
}
```

Keep the existing `handleDeepen` server action and the per-company JSX block exactly as-is — only move it inside `body`.

- [ ] **Step 2: `related-people.tsx`**

Add `bare?: boolean` to `RelatedPeopleProps` (defined inline in the file). Extract the `<CardContent>` children into `body`, branch identically:

```tsx
  if (bare) return <div className="space-y-2 text-sm">{body}</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pessoas relacionadas ({people.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">{body}</CardContent>
    </Card>
  );
```

(Keep the `relationshipLabel` import from Task 2 and the existing `deepenDocument` onClick logic.)

- [ ] **Step 3: `socios-card.tsx`**

Add `bare?: boolean` to `SociosCardProps`. Extract `<CardContent>` children into `body`, branch:

```tsx
  if (bare) return <div className="space-y-2 text-sm">{body}</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sócios ({socios.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">{body}</CardContent>
    </Card>
  );
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

---

## Task 6: `FamilyChips` (núcleo familiar clicável)

**Files:**
- Create: `components/antifraude/family-chips.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client';

// components/antifraude/family-chips.tsx
import { deepenDocument } from '@/app/(app)/search/deepen/actions';
import { relationshipLabel } from '@/lib/netrin/relationship-labels';
import { useTransition } from 'react';
import type { RelatedPersonEntry } from './types';

export type FamilyChipsProps = {
  /** Já filtrado para 1º grau pelo chamador. */
  people: RelatedPersonEntry[];
  parentCpfHash: string;
  currentPath?: string;
};

export function FamilyChips({ people, parentCpfHash, currentPath }: FamilyChipsProps) {
  const [isPending, startTransition] = useTransition();
  if (people.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Núcleo familiar
      </span>
      {people.map((p) => (
        <button
          key={p.cpfHash}
          type="button"
          disabled={isPending}
          onClick={() => {
            startTransition(async () => {
              await deepenDocument({
                docType: 'cpf-relacionado',
                cpfHash: p.cpfHash,
                parentCpfHash,
                currentPath,
              });
            });
          }}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background px-3 py-1 text-xs transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50"
          title={`${relationshipLabel(p.tipoRelacionamento)} · ${p.maskedPreview}`}
        >
          <span className="font-medium">{p.nome ?? 'Sem nome'}</span>
          <span className="text-muted-foreground">{relationshipLabel(p.tipoRelacionamento)}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

---

## Task 7: `IdentityHero` (hero unificado)

**Files:**
- Create: `components/antifraude/identity-hero.tsx`

- [ ] **Step 1: Write the component**

```tsx
// components/antifraude/identity-hero.tsx
import { FamilyChips } from '@/components/antifraude/family-chips';
import { Badge } from '@/components/ui/badge';
import { Loader2Icon } from 'lucide-react';
import type { RelatedPersonEntry } from './types';

type RiskDot = { label: string; active: boolean };

type CommonProps = {
  termPreview: string;
  situacaoCadastral?: string;
  jobRunning: boolean;
  risk: RiskDot[];
};

export type IdentityHeroProps =
  | (CommonProps & {
      tipo: 'cpf';
      nome?: string;
      idade?: number;
      genero?: string;
      nomeMae?: string;
      nucleo: RelatedPersonEntry[];
      parentCpfHash: string;
      currentPath?: string;
    })
  | (CommonProps & {
      tipo: 'cnpj';
      razaoSocial?: string;
      nomeFantasia?: string;
      capitalSocial?: number;
      atividadePrincipal?: string;
      dataAbertura?: string;
    });

function SituacaoPill({ situacao }: { situacao?: string }) {
  if (!situacao) return null;
  const ativa = situacao.toLowerCase().includes('ativa') || situacao.toLowerCase().includes('regular');
  return <Badge variant={ativa ? 'success' : 'destructive'}>{situacao}</Badge>;
}

function RiskRow({ risk }: { risk: RiskDot[] }) {
  if (risk.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      {risk.map((r) => (
        <span key={r.label} className="flex items-center gap-1.5">
          <span
            className={`size-2 rounded-full ${r.active ? 'bg-destructive' : 'bg-emerald-500/70'}`}
            aria-hidden
          />
          <span className={r.active ? 'font-medium text-destructive' : 'text-muted-foreground'}>
            {r.label}
          </span>
        </span>
      ))}
    </div>
  );
}

export function IdentityHero(props: IdentityHeroProps) {
  const title =
    props.tipo === 'cpf'
      ? (props.nome ?? props.termPreview)
      : (props.razaoSocial ?? props.termPreview);

  const meta =
    props.tipo === 'cpf'
      ? [
          typeof props.idade === 'number' ? `${props.idade} anos` : null,
          props.genero,
          props.termPreview,
        ].filter(Boolean)
      : [
          props.nomeFantasia,
          typeof props.capitalSocial === 'number'
            ? props.capitalSocial.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
            : null,
          props.termPreview,
        ].filter(Boolean);

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground">{meta.join(' · ')}</p>
        </div>
        <div className="flex items-center gap-3">
          {props.jobRunning ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" />
              Analisando…
            </span>
          ) : null}
          <SituacaoPill situacao={props.situacaoCadastral} />
        </div>
      </div>

      <RiskRow risk={props.risk} />

      {props.tipo === 'cpf' && props.nomeMae ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground/70">Mãe:</span> {props.nomeMae}
        </p>
      ) : null}

      {props.tipo === 'cnpj' && props.atividadePrincipal ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground/70">Atividade:</span>{' '}
          {props.atividadePrincipal}
          {props.dataAbertura ? ` · desde ${props.dataAbertura}` : ''}
        </p>
      ) : null}

      {props.tipo === 'cpf' ? (
        <div className="border-t border-border/60 pt-4">
          <FamilyChips
            people={props.nucleo}
            parentCpfHash={props.parentCpfHash}
            currentPath={props.currentPath}
          />
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

---

## Task 8: `NetworkRail` (trilho sticky)

**Files:**
- Create: `components/antifraude/network-rail.tsx`

- [ ] **Step 1: Write the component**

```tsx
// components/antifraude/network-rail.tsx
import type { SubgraphStats } from '@/lib/graph/subgraph-stats';
import { buttonVariants } from '@/components/ui/button';
import { ArrowRightIcon, BuildingIcon, ScaleIcon, UsersIcon } from 'lucide-react';
import Link from 'next/link';

export type NetworkRailProps = {
  stats: SubgraphStats;
  networkHash: string | null;
  canSeeNetwork: boolean;
};

// Snapshot ilustrativo: anel determinístico de nós ao redor do centro.
// Não mapeia arestas reais (apenas conta) — é decorativo, os números abaixo
// são a informação precisa.
function Preview({ stats }: { stats: SubgraphStats }) {
  const total = Math.min(stats.nodes, 8);
  const cx = 110;
  const cy = 70;
  const radius = 48;
  const dots = Array.from({ length: total }, (_, i) => {
    const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    // Primeiros = pessoas (azul), depois empresas (âmbar), resto neutro.
    const fill = i < stats.people ? '#3b82f6' : i < stats.people + stats.companies ? '#f59e0b' : '#94a3b8';
    return { x, y, fill, key: i };
  });
  return (
    <svg viewBox="0 0 220 140" className="h-32 w-full" role="img" aria-label="Prévia da rede">
      {dots.map((d) => (
        <line key={`l${d.key}`} x1={cx} y1={cy} x2={d.x} y2={d.y} stroke="currentColor" strokeOpacity={0.18} strokeWidth={1} />
      ))}
      {dots.map((d) => (
        <circle key={`c${d.key}`} cx={d.x} cy={d.y} r={5} fill={d.fill} />
      ))}
      <circle cx={cx} cy={cy} r={9} fill="hsl(var(--primary))" />
    </svg>
  );
}

function StatRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function NetworkRail({ stats, networkHash, canSeeNetwork }: NetworkRailProps) {
  if (!networkHash || !canSeeNetwork) return null;

  const empty = stats.nodes === 0 && stats.edges === 0;

  return (
    <aside className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card p-5 lg:sticky lg:top-8 lg:self-start">
      <h2 className="font-heading text-base font-semibold tracking-tight">Rede de relacionamentos</h2>

      {empty ? (
        <p className="rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
          A rede ainda está sendo construída. Esta área atualiza conforme a análise avança.
        </p>
      ) : (
        <>
          <div className="rounded-xl border border-border/50 bg-muted/20 text-muted-foreground">
            <Preview stats={stats} />
          </div>
          <p className="text-sm">
            <span className="font-semibold tabular-nums">{stats.nodes}</span> nós ·{' '}
            <span className="font-semibold tabular-nums">{stats.edges}</span> conexões
          </p>
          <div className="flex flex-col gap-1.5">
            <StatRow icon={<UsersIcon className="size-4" />} label="Pessoas (família)" value={stats.familyEdges} />
            <StatRow icon={<BuildingIcon className="size-4" />} label="Empresas" value={stats.companies} />
            <StatRow icon={<ScaleIcon className="size-4" />} label="Vínculos processuais" value={stats.processEdges} />
          </div>
        </>
      )}

      <Link
        href={`/network/${encodeURIComponent(networkHash)}`}
        className={buttonVariants({ variant: 'default', size: 'sm' })}
      >
        Abrir rede completa
        <ArrowRightIcon className="ml-1 size-3.5" />
      </Link>
    </aside>
  );
}
```

- [ ] **Step 2: Verify icon names exist in lucide-react**

Run: `node -e "const i=require('lucide-react'); for (const n of ['BuildingIcon','ScaleIcon','UsersIcon','ArrowRightIcon']) if(!i[n]) console.log('MISSING',n)"`
Expected: no output. (If any is MISSING, substitute a present equivalent, e.g. `Building2Icon`, `Users2Icon`.)

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

---

## Task 9: Recompose `page.tsx`

This is the integration task. It rewires the JSX in `app/(app)/search/result/[hash]/page.tsx` (lines 469–657, the `return`) and trims now-unused imports/helpers. **All extraction helpers above the component stay unchanged.**

**Files:**
- Modify: `app/(app)/search/result/[hash]/page.tsx`

- [ ] **Step 1: Update imports**

Replace the antifraude/ui import block (lines 1–27) so that:
- Remove: `IdentityCard`, `IdentityCardCnpj`, `NetworkCta`, `ClockIcon`.
- Add: `IdentityHero` from `@/components/antifraude/identity-hero`, `NetworkRail` from `@/components/antifraude/network-rail`, `ResultSection` from `@/components/antifraude/result-section`, `getSubgraphStats` from `@/lib/graph/subgraph-stats`, and the icons `FileTextIcon`, `MegaphoneIcon`, `ShieldAlertIcon`, `BuildingIcon`, `UsersIcon` from `lucide-react` (verify names exist as in Task 8 Step 2).
- Keep: `PepCard`, `MediaCard`, `SancoesCardCnpj`, `RelatedCompanies`, `RelatedPeople`, `SociosCard`, `ProcessResultsTable`, `BreadcrumbNetwork`, `EnrichmentRealtime`, `SearchRowRealtime`, `Badge`, the `Card*` set (still used by the Processos empty/pending states), `AlertCircleIcon`, `Loader2Icon`, `SearchIcon`.

- [ ] **Step 2: Remove the `formatDateTime` helper**

Delete the `formatDateTime` function (lines 39–47) — it's only used by the removed timestamp.

- [ ] **Step 3: Load network stats**

After computing `networkHash` (line 432), add:

```ts
  let networkStats = { nodes: 0, edges: 0, people: 0, companies: 0, familyEdges: 0, corporateEdges: 0, processEdges: 0 };
  if (networkHash && canSeeNetwork) {
    try {
      networkStats = await getSubgraphStats(networkHash);
    } catch (e) {
      console.warn('result page: subgraph stats failed', e);
    }
  }
```

- [ ] **Step 4: Compute first-degree núcleo and risk dots**

After `relatedPeople` is built (line 447), add the first-degree filter, and build risk-dot arrays. Add the import at top: `import { isFirstDegree } from '@/lib/netrin/relationship-labels';`

```ts
  const nucleoFamiliar = relatedPeople.filter((p) => isFirstDegree(p.tipoRelacionamento));

  const cpfRisk = [
    { label: 'PEP', active: !!pepProps?.currentlyPEP },
    { label: 'Sanções', active: !!pepProps?.currentlySanctioned || !!pepProps?.previouslySanctioned },
  ];
  const cnpjRisk = [{ label: 'Sanções', active: !!cnpjSancoesProps?.sancionado }];
```

- [ ] **Step 5: Replace the `return (...)` JSX**

Replace the entire `return (` block (lines 469–656) with:

```tsx
  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-12">
      <SearchRowRealtime documentHash={documentHash} />
      {job ? <EnrichmentRealtime jobId={job.id} /> : null}

      <BreadcrumbNetwork pathParam={currentPath} currentHash={documentHash} />

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ── Coluna principal ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-6">
          {searchRow.search_type === 'cnpj' ? (
            <IdentityHero
              tipo="cnpj"
              termPreview={searchRow.term_preview}
              situacaoCadastral={cnpjIdentityProps?.situacaoCadastral}
              jobRunning={jobRunning}
              risk={cnpjRisk}
              razaoSocial={cnpjIdentityProps?.razaoSocial}
              nomeFantasia={cnpjIdentityProps?.nomeFantasia}
              capitalSocial={cnpjIdentityProps?.capitalSocial}
              atividadePrincipal={cnpjIdentityProps?.atividadePrincipal}
              dataAbertura={cnpjIdentityProps?.dataAbertura}
            />
          ) : (
            <IdentityHero
              tipo="cpf"
              termPreview={searchRow.term_preview}
              situacaoCadastral={identityProps?.situacaoCadastral}
              jobRunning={jobRunning}
              risk={cpfRisk}
              nome={identityProps?.nome}
              idade={identityProps?.idade}
              genero={identityProps?.genero}
              nomeMae={identityProps?.nomeMae}
              nucleo={nucleoFamiliar}
              parentCpfHash={documentHash}
              currentPath={currentPath || documentHash}
            />
          )}

          {/* Rede no mobile (o trilho sticky some abaixo de lg) */}
          <div className="lg:hidden">
            <NetworkRail stats={networkStats} networkHash={networkHash} canSeeNetwork={canSeeNetwork} />
          </div>

          {/* Processos judiciais */}
          <ResultSection
            title="Processos judiciais"
            icon={<FileTextIcon className="size-4" />}
            defaultOpen
            summary={`${searchRow.result_count} processo${searchRow.result_count === 1 ? '' : 's'}`}
          >
            {searchRow.error_message ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                <span>{searchRow.error_message}</span>
              </div>
            ) : searchRow.status === 'pending' ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/70 bg-muted/30 py-10">
                <Loader2Icon className="size-8 animate-spin text-muted-foreground/60" />
                <p className="text-sm font-medium">Consultando processos…</p>
                <p className="text-xs text-muted-foreground">
                  A consulta está em andamento. Esta tela atualiza automaticamente.
                </p>
              </div>
            ) : !cached ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/30 py-10">
                <SearchIcon className="size-8 text-muted-foreground/60" />
                <p className="text-sm font-medium">Resultados indisponíveis</p>
                <p className="text-xs text-muted-foreground">Refaça a busca para ver os processos atualizados.</p>
              </div>
            ) : cached.results.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/30 py-10">
                <SearchIcon className="size-8 text-muted-foreground/60" />
                <p className="text-sm font-medium">Nenhum processo encontrado</p>
                <p className="text-xs text-muted-foreground">O documento aparentava estar limpo na fonte de dados.</p>
              </div>
            ) : (
              <ProcessResultsTable results={cached.results} />
            )}
          </ResultSection>

          {/* Seções antifraude — só quando há job de enriquecimento */}
          {job ? (
            searchRow.search_type === 'cpf' ? (
              <>
                <ResultSection
                  title="Mídia & risco reputacional"
                  icon={<MegaphoneIcon className="size-4" />}
                  summary={`${mediaProps?.mencoes ?? 0} menções`}
                >
                  <MediaCard
                    bare
                    status={cardStatus}
                    mencoes={mediaProps?.mencoes}
                    qtdMidias={mediaProps?.qtdMidias}
                    qtdListas={mediaProps?.qtdListas}
                    qtdGov={mediaProps?.qtdGov}
                    qtdAmb={mediaProps?.qtdAmb}
                  />
                </ResultSection>

                <ResultSection
                  title="PEP / Sanções"
                  icon={<ShieldAlertIcon className="size-4" />}
                  summary={pepProps?.currentlyPEP ? 'PEP' : 'Sem PEP'}
                >
                  <PepCard
                    bare
                    status={cardStatus}
                    currentlyPEP={pepProps?.currentlyPEP}
                    currentlySanctioned={pepProps?.currentlySanctioned}
                    previouslySanctioned={pepProps?.previouslySanctioned}
                    historicoCount={pepProps?.historicoCount}
                  />
                </ResultSection>

                <div className="flex flex-col gap-3">
                  <h2 className="px-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Vínculos
                  </h2>
                  <ResultSection
                    title="Pessoas relacionadas"
                    icon={<UsersIcon className="size-4" />}
                    summary={`${relatedPeople.length}`}
                  >
                    <RelatedPeople
                      bare
                      status={cardStatus}
                      parentCpfHash={documentHash}
                      currentPath={currentPath || documentHash}
                      people={relatedPeople}
                    />
                  </ResultSection>
                  <ResultSection
                    title="Empresas relacionadas"
                    icon={<BuildingIcon className="size-4" />}
                    summary={`${relatedItems.length}`}
                  >
                    <RelatedCompanies
                      bare
                      status={cardStatus}
                      items={relatedItems}
                      currentPath={currentPath || documentHash}
                    />
                  </ResultSection>
                </div>
              </>
            ) : (
              <>
                <ResultSection
                  title="Mídia & risco reputacional"
                  icon={<MegaphoneIcon className="size-4" />}
                  summary={`${cnpjMediaProps?.mencoes ?? 0} menções`}
                >
                  <MediaCard
                    bare
                    status={cardStatus}
                    mencoes={cnpjMediaProps?.mencoes}
                    qtdMidias={cnpjMediaProps?.qtdMidias}
                    qtdListas={cnpjMediaProps?.qtdListas}
                    qtdGov={cnpjMediaProps?.qtdGov}
                    qtdAmb={cnpjMediaProps?.qtdAmb}
                  />
                </ResultSection>

                <ResultSection
                  title="Sanções e restrições"
                  icon={<ShieldAlertIcon className="size-4" />}
                  summary={cnpjSancoesProps?.sancionado ? 'Sancionado' : 'Sem restrições'}
                >
                  <SancoesCardCnpj
                    bare
                    status={cardStatus}
                    sancionado={cnpjSancoesProps?.sancionado}
                    ceis={cnpjSancoesProps?.ceis}
                    cnep={cnpjSancoesProps?.cnep}
                    trabalhoEscravo={cnpjSancoesProps?.trabalhoEscravo}
                  />
                </ResultSection>

                <ResultSection
                  title="Sócios"
                  icon={<UsersIcon className="size-4" />}
                  summary={`${socios.length}`}
                >
                  <SociosCard
                    bare
                    status={cardStatus}
                    parentCnpjHash={documentHash}
                    currentPath={currentPath || documentHash}
                    socios={socios}
                  />
                </ResultSection>
              </>
            )
          ) : null}
        </div>

        {/* ── Trilho de rede (sticky, desktop) ─────────────────────────── */}
        <div className="hidden lg:block">
          <NetworkRail stats={networkStats} networkHash={networkHash} canSeeNetwork={canSeeNetwork} />
        </div>
      </div>
    </main>
  );
```

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint:fix`
Expected: no type errors; Biome auto-fixes import order. Resolve any "unused import" by removing the leftover symbol.

---

## Task 10: Full verification

- [ ] **Step 1: Run the full suite**

Run: `pnpm test`
Expected: all green, count ≥ previous (270) + the new pure tests.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `pnpm build`
Expected: build succeeds (catches `page.tsx`/server-component wiring issues).

- [ ] **Step 4: Manual smoke (orchestrator + user)**

Confirm the migration `20260526130000_family_relation_edges.sql` is applied locally (`pnpm exec supabase db reset` if needed), then open the result URL for a CPF and a CNPJ. Verify: hero shows name + risk + núcleo familiar; collapses open/close and reveal detail; network rail shows stats + preview + working "Abrir rede completa"; no "Em cache"/"Consulta arquivada"/timestamp/fornecedor strings remain.

---

## Self-Review (executado ao escrever o plano)

- **Spec coverage:** hero unificado (T7), núcleo familiar no hero (T6+T9), rede sticky com stats discriminadas (T1+T8+T9), collapses resumo+detalhe (T3+T4+T5+T9), remoções de cache/arquivo/timestamp/badge de job (T9), rename "Resultados Predictus"→"Processos judiciais" (T9), integração RelatedPeople (T2/T5/T6/T9). ✔ Todos os requisitos do spec têm task.
- **Placeholder scan:** sem TBD/TODO; todo passo tem código ou comando concreto.
- **Type consistency:** `SubgraphStats` (T1) consumido em `NetworkRail` (T8) e `page.tsx` (T9) com os mesmos 7 campos; `bare?: boolean` adicionado em `types.ts` para os props compartilhados (T4/T5); `RelatedPersonEntry` reusado em `FamilyChips`/`IdentityHero` (T6/T7).
- **Itens a verificar (não-bloqueantes):** nomes de ícones lucide (T8 S2, T9 S1); presença de `cn` em `@/lib/utils` (T3 S1); migration de família aplicada (T10 S4).
