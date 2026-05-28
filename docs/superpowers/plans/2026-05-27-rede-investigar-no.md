# Investigar a partir de um nó da rede — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir disparar uma investigação completa (Predictus async + Netrin antifraude) a partir de qualquer nó CPF/CNPJ na visão de rede, substituindo o botão "Expandir" — que hoje é parcial (só Predictus síncrono, sem enrichment) e vaza copy de cache/fornecedor — por uma ação "Investigar" que reusa a pipeline real e leva à página de resultado.

**Architecture:** Uma função pura `planNodeInvestigation` (TDD) decide, por tipo de nó, o que buscar e valida o documento. Uma Server Action fina `investigateNode` recupera o documento em claro **no servidor** a partir do `encrypted_label` (via `decryptLabel`), aplica `requirePermission`, e delega para os já-testados `runCpfSearch`/`runCnpjSearch` (pipeline async completa: insere row `pending` em `searches`, dispara Predictus via pg_net **e** o job Netrin em paralelo, densificando o grafo compartilhado), e então redireciona para `/search/result/[hash]`. A UI troca `ExpandButton` por `InvestigateButton`. O `expandNode` / `expand-button.tsx` mortos são removidos.

**Tech Stack:** Next.js 16 (App Router) + React 19 + TypeScript strict, Supabase (Postgres 16), Vitest (TDD), Biome. Sem migration e sem mudança de Edge Function.

---

## Contexto crítico (ler antes de tocar código)

### Por que "aprofundar" não funcionava na rede

- O painel do nó (`app/(app)/network/[hash]/node-detail-panel.tsx`, `VisaoTab`, ~linhas 136-145) só oferece, para nós CPF/CNPJ:
  1. `ExpandButton` → `expandNode(hash)` (`actions.ts:226`), que **só chama Predictus síncrono** (`searchByCpf`/`searchByCnpj` + `setCachedResults`) — descobre co-partes/advogados de processos, mas **não dispara o enrichment Netrin** (zero relações societárias/família/risco) e **não cria row em `searches`** (sem histórico, sem página de resultado navegável). Também **viola** o invariante do CLAUDE.md "Never chamar Predictus síncrono num Server Action".
  2. "Ver rede deste nó" → `<Link>` que só re-centra o grafo (não busca nada).
- A pipeline completa (`runCpfSearch`/`runCnpjSearch`, Predictus async + Netrin) só está ligada em `app/(app)/search/deepen/actions.ts`, acionada pelas cards antifraude da **página de resultado** — nunca na rede.

### Fatos que o plano reusa (já verificados no código)

- Os nós **carregam o documento em claro** no `encrypted_label`: `lib/graph/extractor.ts:54,66` (`label: { name, document: cpfRaw }`) e `lib/netrin/graph-bridge.ts:43,52`. Então `decryptLabel` recupera o CPF/CNPJ — não é preciso resolver via `netrin_cache` (mais simples que o deepen da página de resultado).
- `runCpfSearch(raw, ctx)` / `runCnpjSearch(raw, ctx)` em `lib/predictus/run-search.ts:34,45` recebem `RunSearchContext = { userId, admin, supabase, ip, userAgent }` e retornam `{ ok: true, documentHash, termPreview } | { ok: false, error }`. Eles já fazem audit (`search_single`), cache lookup, INSERT `searches` e fan-out Netrin. Validam o documento internamente (`isCpfValid`/`isCnpjValid`).
- `requirePermission('search_person' | 'search_company')` (`lib/auth/permissions.ts:67`) redireciona para `/access-denied` em falha (admin sempre passa). Mesmo padrão usado em `deepenDocument`.
- `NodeType = 'cpf' | 'cnpj' | 'lawyer'` (`lib/graph/types.ts`). `GraphNodeLabel = { name?, document?, oab? }`.
- `expandNode` e `expand-button.tsx` são referenciados **somente** entre si e pelo painel (confirmado por grep). Removê-los não quebra mais nada. O literal de audit `'expand_network_node'` em `lib/supabase/types.ts` (3 ocorrências) fica como está — é só um membro de union para inserts; nenhum código novo o usa, e removê-lo é churn desnecessário.

### Baseline

Rodar `pnpm test` **antes de começar** e anotar o número de testes passando (o CLAUDE.md cita 270; o plano de grafo cita 342+; use o número real da sua árvore). Cada fase deve manter a suíte verde; a Task 1 adiciona testes novos. Nunca commitar com `pnpm typecheck` ou `pnpm test` vermelho.

---

## File structure

- **Create** `lib/graph/investigate-plan.ts` — função pura `planNodeInvestigation` (decisão tipo→busca + validação).
- **Create** `lib/graph/investigate-plan.test.ts` — Vitest do planner.
- **Create** `app/(app)/network/[hash]/investigate-button.tsx` — botão cliente "Investigar".
- **Modify** `app/(app)/network/[hash]/actions.ts` — adiciona `investigateNode`; remove `expandNode`.
- **Modify** `app/(app)/network/[hash]/node-detail-panel.tsx` — troca `ExpandButton` por `InvestigateButton`; ajusta copy do link secundário.
- **Delete** `app/(app)/network/[hash]/expand-button.tsx` — morto após a troca.

---

## Task 1: Planner puro `planNodeInvestigation` (TDD)

**Files:**
- Create: `lib/graph/investigate-plan.ts`
- Test: `lib/graph/investigate-plan.test.ts`

- [ ] **Step 1.1: Escrever o teste (falhando)**

Create `lib/graph/investigate-plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { planNodeInvestigation } from './investigate-plan';

describe('planNodeInvestigation', () => {
  it('planeja busca de CPF a partir de documento de 11 dígitos', () => {
    expect(planNodeInvestigation({ type: 'cpf', document: '12345678909' })).toEqual({
      ok: true,
      type: 'cpf',
      document: '12345678909',
    });
  });

  it('planeja busca de CNPJ e remove a formatação', () => {
    expect(planNodeInvestigation({ type: 'cnpj', document: '12.345.678/0001-90' })).toEqual({
      ok: true,
      type: 'cnpj',
      document: '12345678000190',
    });
  });

  it('rejeita nós de advogado', () => {
    expect(planNodeInvestigation({ type: 'lawyer' })).toEqual({
      ok: false,
      error: 'Advogados não podem ser investigados por documento.',
    });
  });

  it('rejeita nó sem documento ou com documento malformado', () => {
    expect(planNodeInvestigation({ type: 'cpf' }).ok).toBe(false);
    expect(planNodeInvestigation({ type: 'cnpj', document: '123' }).ok).toBe(false);
  });
});
```

- [ ] **Step 1.2: Rodar e confirmar que falha**

Run: `pnpm test -- lib/graph/investigate-plan`
Expected: FAIL — `Failed to resolve import "./investigate-plan"`.

- [ ] **Step 1.3: Implementar o planner**

Create `lib/graph/investigate-plan.ts`:

```ts
import type { NodeType } from './types.ts';

export type InvestigatePlan =
  | { ok: true; type: 'cpf' | 'cnpj'; document: string }
  | { ok: false; error: string };

const MALFORMED = 'Não foi possível recuperar o documento deste nó.';

/**
 * Decide, a partir de um nó do grafo, qual busca disparar. Puro e testável:
 * a Server Action `investigateNode` só recupera o documento (decrypt) e delega
 * a decisão aqui antes de chamar a pipeline real.
 */
export function planNodeInvestigation(node: {
  type: NodeType;
  document?: string;
}): InvestigatePlan {
  if (node.type === 'lawyer') {
    return { ok: false, error: 'Advogados não podem ser investigados por documento.' };
  }
  const document = (node.document ?? '').replace(/\D/g, '');
  if (node.type === 'cpf' && document.length !== 11) return { ok: false, error: MALFORMED };
  if (node.type === 'cnpj' && document.length !== 14) return { ok: false, error: MALFORMED };
  return { ok: true, type: node.type, document };
}
```

- [ ] **Step 1.4: Rodar e confirmar verde**

Run: `pnpm test -- lib/graph/investigate-plan`
Expected: PASS (4 testes).

- [ ] **Step 1.5: Commit**

```bash
pnpm lint:fix
git add lib/graph/investigate-plan.ts lib/graph/investigate-plan.test.ts
git commit -m "feat(graph): planNodeInvestigation — decisão pura tipo de nó → busca

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Server Action `investigateNode` + remover `expandNode`

**Files:**
- Modify: `app/(app)/network/[hash]/actions.ts`

> Camada `app/**` é wiring fino sobre `lib/**` (CLAUDE.md: testes unitários opcionais aqui). A lógica testável vive em `planNodeInvestigation` (Task 1) e em `runCpfSearch`/`runCnpjSearch` (já cobertos). A verificação desta task é typecheck + build + smoke manual (Task 4).

- [ ] **Step 2.1: Adicionar os imports no topo de `actions.ts`**

Logo após os imports existentes de lib (perto de `import { buildPathResult } from '@/lib/graph/path-result';`), adicionar:

```ts
import { planNodeInvestigation } from '@/lib/graph/investigate-plan';
import { runCnpjSearch, runCpfSearch } from '@/lib/predictus/run-search';
```

E, junto dos imports de `next/*` (já existe `import { headers } from 'next/headers';`), adicionar:

```ts
import { redirect } from 'next/navigation';
```

> `decryptLabel`, `createAdminClient`, `createClient`, `extractRequestContext`, `requirePermission`, e os tipos `NodeType`/`GraphNodeLabel` já estão importados no arquivo — não reimportar.

- [ ] **Step 2.2: Adicionar a Server Action `investigateNode`**

Adicionar ao final de `app/(app)/network/[hash]/actions.ts`:

```ts
export type InvestigateResult = { ok: false; error: string };

/**
 * Dispara a investigação completa (Predictus async + Netrin) a partir de um nó
 * da rede. O documento em claro é recuperado do `encrypted_label` no servidor —
 * nunca confiando em input do cliente. Em sucesso, redireciona para a página de
 * resultado (que renderiza skeleton + realtime enquanto a busca está pending) e
 * a função não retorna. Só retorna em caso de erro.
 */
export async function investigateNode(hash: string): Promise<InvestigateResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado.' };

  const admin = createAdminClient();
  const { data: row } = await supabase
    .from('graph_nodes')
    .select('node_hash, node_type, encrypted_label')
    .eq('node_hash', hash)
    .maybeSingle()
    .returns<{ node_hash: string; node_type: NodeType; encrypted_label: string }>();
  if (!row) return { ok: false, error: 'Nó não encontrado na rede.' };

  let document: string | undefined;
  try {
    const label = JSON.parse(await decryptLabel(admin, row.encrypted_label)) as GraphNodeLabel;
    document = label.document;
  } catch (e) {
    console.warn('investigateNode label decrypt failed:', e);
  }

  const plan = planNodeInvestigation({ type: row.node_type, document });
  if (!plan.ok) return plan;

  await requirePermission(plan.type === 'cpf' ? 'search_person' : 'search_company');

  const requestContext = extractRequestContext(await headers());
  const ctx = {
    userId: user.id,
    admin,
    supabase,
    ip: requestContext.ip ?? null,
    userAgent: requestContext.userAgent ?? null,
  };
  const result =
    plan.type === 'cpf'
      ? await runCpfSearch(plan.document, ctx)
      : await runCnpjSearch(plan.document, ctx);
  if (!result.ok) return result;
  redirect(`/search/result/${encodeURIComponent(result.documentHash)}`);
}
```

- [ ] **Step 2.3: Remover o `expandNode` morto**

Em `app/(app)/network/[hash]/actions.ts`, apagar a função `expandNode` inteira (de `export async function expandNode(` até o `}` que a fecha — atualmente ~linhas 226-297). Apagar também os imports que ficaram órfãos **somente após confirmar que nada mais os usa no arquivo**:

- `import { setCachedResults } from '@/lib/predictus/cache';`
- `import { createServerPredictusClient } from '@/lib/predictus/server-client';`

> Verificar antes de apagar: `grep -n "setCachedResults\|createServerPredictusClient" "app/(app)/network/[hash]/actions.ts"`. Se a única ocorrência (além do import) estava em `expandNode`, remover os dois imports. `getSubgraph`, `findPathBetween`, `findPathToDocument` e os helpers permanecem.

- [ ] **Step 2.4: Typecheck**

Run: `pnpm typecheck`
Expected: limpo. (Se acusar import não usado, é o Biome no Step 2.6; o `tsc` deve passar.)

- [ ] **Step 2.5: Suíte completa continua verde**

Run: `pnpm test`
Expected: PASS — mesmo número da baseline + 4 (Task 1).

- [ ] **Step 2.6: Lint + commit**

```bash
pnpm lint:fix
git add "app/(app)/network/[hash]/actions.ts"
git commit -m "feat(network): investigateNode — investigação completa a partir do nó (remove expandNode parcial)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Trocar a UI — `InvestigateButton` no painel; deletar `expand-button.tsx`

**Files:**
- Create: `app/(app)/network/[hash]/investigate-button.tsx`
- Modify: `app/(app)/network/[hash]/node-detail-panel.tsx`
- Delete: `app/(app)/network/[hash]/expand-button.tsx`

- [ ] **Step 3.1: Criar o `InvestigateButton`**

Create `app/(app)/network/[hash]/investigate-button.tsx`:

```tsx
'use client';

import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { useState, useTransition } from 'react';
import { investigateNode } from './actions';

export function InvestigateButton({ hash }: { hash: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function doInvestigate() {
    setError(null);
    startTransition(async () => {
      // Em sucesso a Server Action redireciona no servidor (lança NEXT_REDIRECT)
      // e este callback não chega a inspecionar `result`. Só caímos no else em erro.
      const result = await investigateNode(hash);
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button size="sm" disabled={pending} onClick={doInvestigate} className="w-full">
        <Search className="size-3.5" />
        {pending ? 'Investigando…' : 'Investigar este documento'}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 3.2: Trocar o import no painel**

Em `app/(app)/network/[hash]/node-detail-panel.tsx`, substituir a linha 21:

```ts
import { ExpandButton } from './expand-button';
```

por:

```ts
import { InvestigateButton } from './investigate-button';
```

- [ ] **Step 3.3: Trocar o botão e clarear a copy do link secundário**

No `VisaoTab`, substituir o bloco (~linhas 136-145):

```tsx
      {node.type !== 'lawyer' ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <ExpandButton hash={node.hash} inCache={node.inCache} />
          <Link href={`/network/${encodeURIComponent(node.hash)}`}>
            <Button variant="outline" size="sm" className="w-full">
              Ver rede deste nó
            </Button>
          </Link>
        </div>
      ) : null}
```

por:

```tsx
      {node.type !== 'lawyer' ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <InvestigateButton hash={node.hash} />
          <Link href={`/network/${encodeURIComponent(node.hash)}`}>
            <Button variant="outline" size="sm" className="w-full">
              Centralizar a rede neste nó
            </Button>
          </Link>
          <p className="text-[0.65rem] text-muted-foreground">
            Investigar dispara uma nova consulta e antifraude; centralizar apenas reposiciona a rede
            já mapeada.
          </p>
        </div>
      ) : null}
```

> "Centralizar a rede neste nó" deixa claro que o link só navega (não busca), eliminando a confusão com a investigação. A copy nova não cita fornecedor nem cache.

- [ ] **Step 3.4: Deletar o `expand-button.tsx` morto**

```bash
git rm "app/(app)/network/[hash]/expand-button.tsx"
```

- [ ] **Step 3.5: Confirmar que não restou referência a `ExpandButton`/`expandNode`/`inCache`-no-painel**

Run: `grep -rn "ExpandButton\|expandNode\|expand-button" "app/(app)/network"`
Expected: nenhuma saída.

> `node.inCache` (campo do `GraphNodeDto`) era usado só pelo `ExpandButton`; o DTO mantém o campo (sem custo) e nada mais quebra. Não remover o campo do DTO.

- [ ] **Step 3.6: Typecheck + build + lint**

Run: `pnpm typecheck && pnpm build`
Expected: typecheck limpo; build conclui sem erro (valida `proxy.ts`, rotas e tipos do App Router).

```bash
pnpm lint:fix
git add "app/(app)/network/[hash]/investigate-button.tsx" "app/(app)/network/[hash]/node-detail-panel.tsx"
git commit -m "feat(network): botão Investigar no painel do nó (substitui Expandir) + copy sem cache/fornecedor

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Verificação end-to-end (smoke manual)

**Files:** nenhum (verificação).

> Use a skill `superpowers:verification-before-completion`. A camada `app/**` é validada por build + smoke, não por unit test.

- [ ] **Step 4.1: Suíte + typecheck final**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck limpo; testes verdes (baseline + 4).

- [ ] **Step 4.2: Smoke local**

1. `pnpm dev` (com Supabase local up — ver "Bootstrap a fresh environment" no CLAUDE.md).
2. Como operador com `search_network` **e** `search_person`/`search_company` (ou admin), abrir `/network/<hash>` de um documento que já tenha rede mapeada.
3. Clicar num nó CPF que seja co-parte/sócio. Confirmar no painel "Visão":
   - Botão primário **"Investigar este documento"** (sem "cache", sem nome de fornecedor).
   - Link secundário **"Centralizar a rede neste nó"** + a frase explicativa.
4. Clicar "Investigar". Esperado: redireciona para `/search/result/<novoHash>` mostrando o skeleton de `pending`; a row aparece em `/history`; ao completar, os cards antifraude (sócios/família/empresas) renderizam e o grafo compartilhado ganha as novas arestas (visível ao reabrir a rede).
5. Selecionar um nó **advogado**: confirmar que o botão "Investigar" **não** aparece (o gate `node.type !== 'lawyer'` permanece).
6. (Opcional) Com um operador sem `search_person`: clicar "Investigar" num nó CPF deve redirecionar para `/access-denied` (defesa em profundidade do `requirePermission`).

- [ ] **Step 4.3: Verificar LGPD nos logs**

Durante o smoke, observar o console do servidor: nenhum CPF/CNPJ em claro deve aparecer (o único ponto onde o plaintext vive é o stack frame de `investigateNode`/`runCpfSearch`, nunca logado). Confirmar que nenhum `console.warn`/`error` introduzido imprime documento.

---

## Self-review (cobertura × spec)

- **"Aprofundar" não disparava busca completa na rede** → Task 2 (`investigateNode` chama `runCpfSearch`/`runCnpjSearch` = Predictus async + Netrin) + Task 3 (UI). ✓
- **Cria nós novos na rede** → herdado de `runCpfSearch`/`runCnpjSearch` (fan-out Netrin + extractGraph alimentam o grafo append-only compartilhado). ✓
- **Label de cache não deveria estar lá** → Task 3 remove `expand-button.tsx` (que tinha "Expandir (cache)" / "Expandir (chamar Predictus)" — este último também violava a regra de não citar fornecedor). ✓
- **Copy sem fornecedor/inglês, pt-BR** → "Investigar este documento", "Centralizar a rede neste nó", "Investigando…". ✓
- **Não chamar Predictus síncrono em Server Action** → Task 2 remove o `expandNode` que violava isso; `investigateNode` usa a pipeline async. ✓
- **Defesa em profundidade de permissão** → `requirePermission` por tipo de nó na Task 2. ✓

**Consistência de tipos:** `planNodeInvestigation` retorna `{ ok: true; type: 'cpf'|'cnpj'; document } | { ok: false; error }` (Task 1) — consumido em Task 2 (`plan.type`, `plan.document`). `investigateNode(hash): Promise<InvestigateResult>` (Task 2) — chamado por `InvestigateButton({ hash })` (Task 3) que trata `{ ok: false }`. `RunSearchContext` montado na Task 2 bate com `lib/predictus/run-search.ts:15`. Nomes batem.

**Placeholder scan:** sem TBD/TODO; todo step com código mostra o código completo.

---

## Riscos & notas de execução

1. **Sem migration, sem Edge Function** — mudança puramente Next.js; não precisa `db push` nem `functions deploy`.
2. **Permissão dupla** — o operador precisa de `search_network` (pra ver a rede) **e** `search_person`/`search_company` (pra investigar). Quem só tem rede será mandado pra `/access-denied` ao investigar. Se isso for indesejável no produto, trocar `requirePermission` por uma checagem não-redirecionante que devolve `{ ok: false, error }` — decisão de produto, fora do escopo deste plano.
3. **Custo Netrin** — cada "Investigar" num documento novo gera uma consulta paga (igual a qualquer busca single). O cache de 30d evita refetch. Esperado e aceitável.
4. **`expand_network_node`** continua no union de `audit_log.action` em `lib/supabase/types.ts` (morto, inofensivo) — não tocar.
