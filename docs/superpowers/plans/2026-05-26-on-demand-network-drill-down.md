# On-demand network drill-down — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refatorar Hop2/Hop3 do enriquecimento Netrin para virarem buscas explícitas sob demanda (CPF e CNPJ simétricas), com drill-down recursivo na rede societária via páginas dedicadas e breadcrumb.

**Architecture:** Cada job de enriquecimento passa a fazer 1 chamada Netrin (CPF ou CNPJ). Botão "Aprofundar" em cada pivô (CNPJ relacionado ou CPF sócio) dispara nova busca completa daquele documento (Predictus + Netrin). Navegação via `/search/result/<hash>?path=<h1>,<h2>,...` com breadcrumb. Página de resultado branchia entre cards CPF e cards CNPJ.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Supabase (Postgres + Edge Functions), Vitest, Tailwind 4 + shadcn/ui.

**Referência:** [Spec](../specs/2026-05-26-on-demand-network-drill-down-design.md)

**Pré-requisitos antes de começar:**
- Branch `feature/nextjs-rewrite` checked out
- `pnpm install` rodado
- `pnpm exec supabase start` rodando (Docker)
- Vault keys bootstrapadas (`scripts/bootstrap-vault.sql`)
- `.env.local` populado com `NETRIN_TOKEN`
- `pnpm test` verde no baseline (270 testes)

---

## Task 1: Renomear slug constants e ajustar imports

**Files:**
- Modify: `lib/netrin/types.ts`
- Modify: `lib/netrin/hops/hop1.ts`
- Modify: `lib/netrin/hops/hop1.test.ts`
- Modify: `lib/netrin/hops/hop2.ts`
- Modify: `lib/netrin/hops/hop2.test.ts`
- Modify: `lib/netrin/hops/hop3.ts`
- Modify: `lib/netrin/hops/hop3.test.ts`

- [ ] **Step 1: Editar `lib/netrin/types.ts`**

Substituir o conteúdo do arquivo por:

```typescript
// lib/netrin/types.ts

export type NetrinDocumentType = 'cpf' | 'cnpj';

export const CPF_SLUGS = [
  'pep-kyc-cpf',
  'empresas-relacionadas-cpf',
  'receita-federal-cpf-data-nascimento',
  'midias-consolidado',
] as const;

export const CNPJ_SLUGS = [
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

export type NetrinSlug = (typeof CPF_SLUGS)[number] | (typeof CNPJ_SLUGS)[number];

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
  pepAcuracia?: number;
};
```

- [ ] **Step 2: Atualizar imports em `lib/netrin/hops/hop1.ts`**

Substituir `import { HOP1_SLUGS, ... } from '../types.ts';` por `import { CPF_SLUGS, ... } from '../types.ts';` e substituir todas as referências `HOP1_SLUGS` por `CPF_SLUGS` no arquivo.

- [ ] **Step 3: Idem em `lib/netrin/hops/hop1.test.ts`**

- [ ] **Step 4: Atualizar imports em `lib/netrin/hops/hop2.ts`**

Substituir `HOP2_SLUGS` por `CNPJ_SLUGS` (mesma constante após renomear). Manter `HOP3_SLUGS` import por enquanto (Task 2 deleta hop3).

- [ ] **Step 5: Idem em `lib/netrin/hops/hop2.test.ts`**

- [ ] **Step 6: Atualizar imports em `lib/netrin/hops/hop3.ts`**

Em `hop3.ts` e `hop3.test.ts`, substituir `HOP3_SLUGS` por um array local temporário (esse arquivo vai ser deletado em Task 2; aqui é só pra build não quebrar). Adicionar no topo de cada um:

```typescript
const HOP3_SLUGS = [
  'esp-cpf',
  'pep-kyc-cpf',
  'midias-consolidado',
  'processos-cpf',
  'empresas-relacionadas-cpf',
] as const;
```

E remover a linha `import { HOP3_SLUGS } from '../types';`.

> Nota: esse array temporário inclui `esp-cpf` e `processos-cpf` que **não estão** no novo NetrinSlug union. Cast-as `as unknown as readonly NetrinSlug[]` na chamada `fetchComposta` em hop3.ts para o build passar. É código morto — sai inteiro em Task 2.

- [ ] **Step 7: Rodar typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 8: Rodar testes**

Run: `pnpm test`
Expected: PASS (270 testes verdes; renames são compatíveis em runtime)

- [ ] **Step 9: Commit**

```bash
git add lib/netrin/types.ts lib/netrin/hops/
git commit -m "refactor(netrin): rename HOP1/HOP2 slug consts to CPF/CNPJ"
```

---

## Task 2: Deletar hop3 e seus tests

**Files:**
- Delete: `lib/netrin/hops/hop3.ts`
- Delete: `lib/netrin/hops/hop3.test.ts`

- [ ] **Step 1: Deletar arquivos**

```bash
git rm lib/netrin/hops/hop3.ts lib/netrin/hops/hop3.test.ts
```

- [ ] **Step 2: Verificar que ninguém mais importa**

Run: `grep -rn "hops/hop3" lib app supabase 2>/dev/null || echo "no references"`
Expected: encontra ainda em `lib/netrin/processor.ts` (import de `RunHop3Result`) e em `supabase/functions/process-enrichment-job/index.ts` (deps). Esses são corrigidos em Tasks 3 e 6 — typecheck vai falhar até lá. **Não rodar typecheck agora.**

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(netrin): drop hop3 module (merged into cpf-search in next task)"
```

---

## Task 3: Renomear hop1.ts → cpf-search.ts (com slug set já corrigido)

**Files:**
- Rename: `lib/netrin/hops/hop1.ts` → `lib/netrin/hops/cpf-search.ts`
- Rename: `lib/netrin/hops/hop1.test.ts` → `lib/netrin/hops/cpf-search.test.ts`
- Modify: `lib/netrin/processor.ts` (apenas imports e tipos)

- [ ] **Step 1: Rename files via git mv**

```bash
git mv lib/netrin/hops/hop1.ts lib/netrin/hops/cpf-search.ts
git mv lib/netrin/hops/hop1.test.ts lib/netrin/hops/cpf-search.test.ts
```

- [ ] **Step 2: Renomear funções e tipos exportados**

Em `lib/netrin/hops/cpf-search.ts`:
- Renomear `runHop1` → `runCpfSearch`
- Renomear `RunHop1Result` → `RunCpfSearchResult`
- Renomear `Hop1Deps` → `CpfSearchDeps` (se existir)

Em `lib/netrin/hops/cpf-search.test.ts`:
- Atualizar `import { runHop1 } from './hop1'` → `import { runCpfSearch } from './cpf-search'`
- Atualizar uso da função nas chamadas de teste

- [ ] **Step 3: Em `lib/netrin/processor.ts`, atualizar apenas imports e tipos**

Substituir:
```typescript
import type { RunHop1Result } from './hops/hop1.ts';
import type { RunHop3Result } from './hops/hop3.ts';
```
por:
```typescript
import type { RunCpfSearchResult } from './hops/cpf-search.ts';
```

E em `ProcessorDeps`, trocar `runHop1: () => Promise<RunHop1Result>;` por `runCpfSearch: () => Promise<RunCpfSearchResult>;`. Também remover `runHop3: ...` linha. **A linha `runHop2: ...` fica intacta até Task 4.**

No corpo de `processEnrichmentJob`, substituir todas as ocorrências de `deps.runHop1()` por `deps.runCpfSearch()`.

> Nota: o processor ainda referencia `runHop3` no corpo da função; isso quebra o build. Próxima task remove a referência. Não rodar typecheck.

- [ ] **Step 4: Atualizar `pnpm test` baseline para o novo nome**

Run: `pnpm test -- lib/netrin/hops/cpf-search`
Expected: 4 testes (do antigo hop1.test.ts) passando

- [ ] **Step 5: Commit**

```bash
git add lib/netrin/hops/ lib/netrin/processor.ts
git commit -m "refactor(netrin): rename hop1 → cpf-search"
```

---

## Task 4: Renomear hop2.ts → cnpj-search.ts

**Files:**
- Rename: `lib/netrin/hops/hop2.ts` → `lib/netrin/hops/cnpj-search.ts`
- Rename: `lib/netrin/hops/hop2.test.ts` → `lib/netrin/hops/cnpj-search.test.ts`
- Modify: `lib/netrin/processor.ts` (imports)

- [ ] **Step 1: Rename**

```bash
git mv lib/netrin/hops/hop2.ts lib/netrin/hops/cnpj-search.ts
git mv lib/netrin/hops/hop2.test.ts lib/netrin/hops/cnpj-search.test.ts
```

- [ ] **Step 2: Renomear funções e tipos**

Em `lib/netrin/hops/cnpj-search.ts`:
- `runHop2` → `runCnpjSearch`
- `RunHop2Result` → `RunCnpjSearchResult`

Em `cnpj-search.test.ts`: atualizar import e chamadas.

- [ ] **Step 3: Em `processor.ts`, atualizar import**

Substituir:
```typescript
import type { RunHop2Result } from './hops/hop2.ts';
```
por:
```typescript
import type { RunCnpjSearchResult } from './hops/cnpj-search.ts';
```

Em `ProcessorDeps`, trocar `runHop2: (cnpjRaw: string) => Promise<RunHop2Result>;` por `runCnpjSearch: (cnpjRaw: string) => Promise<RunCnpjSearchResult>;`.

No corpo, substituir `deps.runHop2(cnpjRaw)` por `deps.runCnpjSearch(cnpjRaw)`.

- [ ] **Step 4: Rodar testes do módulo renomeado**

Run: `pnpm test -- lib/netrin/hops/cnpj-search`
Expected: testes do antigo hop2 passando

- [ ] **Step 5: Commit**

```bash
git add lib/netrin/hops/ lib/netrin/processor.ts
git commit -m "refactor(netrin): rename hop2 → cnpj-search"
```

---

## Task 5: Reescrever processor.test.ts com novo modelo

**Files:**
- Modify: `lib/netrin/processor.test.ts`

- [ ] **Step 1: Substituir o conteúdo de `lib/netrin/processor.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { processEnrichmentJob } from './processor';

describe('processEnrichmentJob', () => {
  it('CPF root: roda cpf-search e marca completed', async () => {
    const calls: string[] = [];
    const result = await processEnrichmentJob('job1', {
      job: { rootType: 'cpf', rootRaw: '12345678909', rootHash: 'cpf:abc', userId: 'u1' },
      setJobStatus: async (_id, status) => {
        calls.push(`status:${status}`);
      },
      setNetrinStatus: async (_id, s) => {
        calls.push(`netrin:${s}`);
      },
      recordCall: async (input) => {
        calls.push(`record:${input.hop}:${input.status}`);
      },
      runCpfSearch: async () => ({ payload: {}, pivotCnpjs: [], cached: false }),
      runCnpjSearch: async () => {
        throw new Error('should not be called for CPF root');
      },
      finalize: async () => {
        calls.push('finalize');
      },
    });

    expect(result.status).toBe('completed');
    expect(calls).toEqual([
      'status:running',
      'record:1:success',
      'netrin:success',
      'finalize',
      'status:completed',
    ]);
  });

  it('CNPJ root: roda cnpj-search e marca completed', async () => {
    const calls: string[] = [];
    const result = await processEnrichmentJob('job1', {
      job: { rootType: 'cnpj', rootRaw: '12345678000190', rootHash: 'cnpj:abc', userId: 'u1' },
      setJobStatus: async (_id, status) => {
        calls.push(`status:${status}`);
      },
      setNetrinStatus: async (_id, s) => {
        calls.push(`netrin:${s}`);
      },
      recordCall: async (input) => {
        calls.push(`record:${input.hop}:${input.status}`);
      },
      runCpfSearch: async () => {
        throw new Error('should not be called for CNPJ root');
      },
      runCnpjSearch: async () => ({ payload: {}, pivotCpfs: [], cached: false }),
      finalize: async () => {
        calls.push('finalize');
      },
    });

    expect(result.status).toBe('completed');
    expect(calls).toEqual([
      'status:running',
      'record:2:success',
      'netrin:success',
      'finalize',
      'status:completed',
    ]);
  });

  it('cache hit: status cache_hit, ainda completed', async () => {
    const calls: string[] = [];
    const result = await processEnrichmentJob('job1', {
      job: { rootType: 'cpf', rootRaw: '12345678909', rootHash: 'cpf:abc', userId: 'u1' },
      setJobStatus: async () => {},
      setNetrinStatus: async (_id, s) => {
        calls.push(`netrin:${s}`);
      },
      recordCall: async (input) => {
        calls.push(`record:${input.cached ? 'cached' : 'fresh'}`);
      },
      runCpfSearch: async () => ({ payload: {}, pivotCnpjs: [], cached: true }),
      runCnpjSearch: async () => ({ payload: {}, pivotCpfs: [], cached: false }),
      finalize: async () => {},
    });

    expect(result.status).toBe('completed');
    expect(calls).toContain('netrin:cache_hit');
    expect(calls).toContain('record:cached');
  });

  it('netrin call falha: marca failed e propaga error', async () => {
    let recordedError: string | undefined;
    const result = await processEnrichmentJob('job1', {
      job: { rootType: 'cpf', rootRaw: '12345678909', rootHash: 'cpf:abc', userId: 'u1' },
      setJobStatus: async (_id, _status, opts) => {
        if (opts?.error) recordedError = opts.error;
      },
      setNetrinStatus: async () => {},
      recordCall: async () => {},
      runCpfSearch: async () => {
        throw new Error('netrin upstream 502');
      },
      runCnpjSearch: async () => ({ payload: {}, pivotCpfs: [], cached: false }),
      finalize: async () => {},
    });

    expect(result.status).toBe('failed');
    expect(recordedError).toBe('netrin upstream 502');
  });

  it('finalize falha não muda status final', async () => {
    const result = await processEnrichmentJob('job1', {
      job: { rootType: 'cpf', rootRaw: '12345678909', rootHash: 'cpf:abc', userId: 'u1' },
      setJobStatus: async () => {},
      setNetrinStatus: async () => {},
      recordCall: async () => {},
      runCpfSearch: async () => ({ payload: {}, pivotCnpjs: [], cached: false }),
      runCnpjSearch: async () => ({ payload: {}, pivotCpfs: [], cached: false }),
      finalize: async () => {
        throw new Error('graph write failed');
      },
    });

    expect(result.status).toBe('completed');
  });
});
```

- [ ] **Step 2: Rodar — deve falhar (signature mudou)**

Run: `pnpm test -- lib/netrin/processor.test`
Expected: FAIL — `setNetrinStatus` não existe no ProcessorDeps atual, `runCpfSearch` / `runCnpjSearch` não existem como deps.

- [ ] **Step 3: Sem commit ainda — processor.ts será reescrito em Task 6**

---

## Task 6: Reescrever processor.ts

**Files:**
- Modify: `lib/netrin/processor.ts`

- [ ] **Step 1: Substituir o conteúdo de `lib/netrin/processor.ts`**

```typescript
import type { RunCpfSearchResult } from './hops/cpf-search.ts';
import type { RunCnpjSearchResult } from './hops/cnpj-search.ts';
import type { EnrichmentCallStatus, EnrichmentJobStatus, RecordCallInput } from './job-store.ts';
import type { NetrinCompositePayload } from './types.ts';

export type ProcessorJob = {
  rootType: 'cpf' | 'cnpj';
  rootRaw: string;
  rootHash: string;
  userId: string;
};

export type ProcessorDeps = {
  job: ProcessorJob;
  setJobStatus: (
    jobId: string,
    status: EnrichmentJobStatus,
    opts?: { error?: string; finished?: boolean },
  ) => Promise<void>;
  setNetrinStatus: (
    jobId: string,
    status: 'success' | 'error' | 'cache_hit',
  ) => Promise<void>;
  recordCall: (input: RecordCallInput) => Promise<void>;
  runCpfSearch: () => Promise<RunCpfSearchResult>;
  runCnpjSearch: (cnpjRaw: string) => Promise<RunCnpjSearchResult>;
  finalize: (collected: {
    payload: NetrinCompositePayload | null;
    docType: 'cpf' | 'cnpj';
  }) => Promise<void>;
};

export type ProcessorResult = { status: 'completed' | 'failed' };

function statusFromCache(cached: boolean): EnrichmentCallStatus {
  return cached ? 'cache_hit' : 'success';
}

export async function processEnrichmentJob(
  jobId: string,
  deps: ProcessorDeps,
): Promise<ProcessorResult> {
  await deps.setJobStatus(jobId, 'running');

  let payload: NetrinCompositePayload | null = null;
  const docType = deps.job.rootType;
  const hopNumber: 1 | 2 = docType === 'cpf' ? 1 : 2;

  try {
    const result =
      docType === 'cpf'
        ? await deps.runCpfSearch()
        : await deps.runCnpjSearch(deps.job.rootRaw);
    payload = result.payload;
    await deps.recordCall({
      jobId,
      hop: hopNumber,
      documentHash: deps.job.rootHash,
      documentType: docType,
      slugs: [],
      status: statusFromCache(result.cached),
      cached: result.cached,
    });
    await deps.setNetrinStatus(jobId, result.cached ? 'cache_hit' : 'success');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await deps.recordCall({
      jobId,
      hop: hopNumber,
      documentHash: deps.job.rootHash,
      documentType: docType,
      slugs: [],
      status: 'error',
      cached: false,
      error: message,
    });
    await deps.setNetrinStatus(jobId, 'error');
    await deps.setJobStatus(jobId, 'failed', { error: message, finished: true });
    return { status: 'failed' };
  }

  try {
    await deps.finalize({ payload, docType });
  } catch (e) {
    console.warn('finalize failed:', e);
  }

  await deps.setJobStatus(jobId, 'completed', { finished: true });
  return { status: 'completed' };
}
```

- [ ] **Step 2: Rodar testes**

Run: `pnpm test -- lib/netrin/processor.test`
Expected: PASS (5 testes)

- [ ] **Step 3: Verificar que outros consumers ainda compilam**

Run: `pnpm typecheck`
Expected: FAIL ainda — Edge Function (`supabase/functions/process-enrichment-job/index.ts`) usa as deps antigas. Será corrigido em Task 7.

- [ ] **Step 4: Commit**

```bash
git add lib/netrin/processor.ts lib/netrin/processor.test.ts
git commit -m "refactor(netrin): processor agora roda 1 call por job (sem cascata)"
```

---

## Task 7: Atualizar Edge Function process-enrichment-job

**Files:**
- Modify: `supabase/functions/process-enrichment-job/index.ts`
- Modify: `lib/netrin/job-store.ts` (renomeia setHop1Status → setNetrinStatus se aplicável; ou adiciona alias)

- [ ] **Step 1: Inspecionar `lib/netrin/job-store.ts`**

Procurar a função `setHop1Status` (ou similar). Renomeá-la para `setNetrinStatus` mantendo a mesma assinatura. Atualizar import em qualquer consumidor.

> Se a função grava em `enrichment_jobs.hop1_status`, mantém o nome da coluna (sem migration) — só a função TS renomeia.

- [ ] **Step 2: Adicionar funções stub se faltar `setHopTotals` foi removido**

A nova `ProcessorDeps` não usa `setHopTotals` nem `bumpHopDone`. Se essas funções continuarem exportadas em job-store.ts, ok deixar (não-breaking). Se quiser limpar, deletar — mas só em ticket futuro (YAGNI).

- [ ] **Step 3: Editar `supabase/functions/process-enrichment-job/index.ts`**

Localizar o objeto `deps` passado para `processEnrichmentJob` e substituir os campos antigos por:

```typescript
const deps: Parameters<typeof processEnrichmentJob>[1] = {
  job: { rootType, rootRaw, rootHash, userId },
  setJobStatus,
  setNetrinStatus,
  recordCall,
  runCpfSearch: () => runCpfSearch({
    rootRaw,
    rootHash,
    userId,
    client,
    admin,
  }),
  runCnpjSearch: (cnpjRaw: string) => runCnpjSearch({
    cnpjRaw,
    userId,
    client,
    admin,
  }),
  finalize: async ({ payload, docType }) => {
    if (!payload) return;
    const graph = buildNetrinGraph({
      rootDocument: { type: docType, raw: rootRaw },
      cpfPayload: docType === 'cpf' ? payload : null,
      cnpjPayloads: docType === 'cnpj' ? { [rootRaw]: payload } : {},
    });
    await upsertGraph(admin, graph);
  },
};
```

> Adapte os imports: `runCpfSearch` vem de `lib/netrin/hops/cpf-search.ts`, `runCnpjSearch` de `lib/netrin/hops/cnpj-search.ts`.

> **Cuidado:** `buildNetrinGraph` ainda tem signature antiga (`hop1Payload`, `hop2Payloads`, `hop3Payloads`). Task 8 ajusta.

- [ ] **Step 4: Não rodar typecheck/test ainda — graph-bridge será ajustado em Task 8**

- [ ] **Step 5: Commit (parcial, com aviso no body)**

```bash
git add supabase/functions/process-enrichment-job/ lib/netrin/job-store.ts
git commit -m "refactor(edge): inject runCpfSearch/runCnpjSearch into processor

Build temporarily broken: graph-bridge signature updates in next commit."
```

---

## Task 8: Atualizar graph-bridge.ts para nova signature

**Files:**
- Modify: `lib/netrin/graph-bridge.ts`
- Modify: `lib/netrin/graph-bridge.test.ts`

- [ ] **Step 1: Atualizar `lib/netrin/graph-bridge.test.ts` para nova signature**

Substituir os testes existentes que usam `hop1Payload` / `hop2Payloads` / `hop3Payloads` pela nova API:

```typescript
// Exemplo de um teste — adaptar os existentes mantendo cobertura:
it('CPF root + cpfPayload com empresas extrai nós CNPJ', () => {
  const graph = buildNetrinGraph({
    rootDocument: { type: 'cpf', raw: '12345678909' },
    cpfPayload: {
      'empresas-relacionadas-cpf': {
        negociosRelacionados: [
          { cnpj: '11111111000111', razaoSocial: 'ACME', tipoVinculo: 'SOCIO' },
        ],
      },
    },
    cnpjPayloads: {},
  });
  expect(graph.nodes.map((n) => n.nodeType).sort()).toEqual(['cnpj', 'cpf']);
  expect(graph.edges).toHaveLength(1);
  expect(graph.edges[0]?.kind).toBe('corporate_relation');
});
```

Manter no mínimo: 1 teste por caminho (CPF root só, CNPJ root só, ambos vazios).

- [ ] **Step 2: Atualizar `lib/netrin/graph-bridge.ts`**

Mudar a signature de `GraphBridgeInput`:

```typescript
export type GraphBridgeInput = {
  rootDocument: { type: NetrinDocumentType; raw: string; name?: string };
  cpfPayload?: NetrinCompositePayload | null;       // payload Netrin de uma busca CPF
  cnpjPayloads?: Record<string, NetrinCompositePayload>; // key: cnpj raw 14 dígitos
};
```

No corpo:
- Trocar `input.hop1Payload` por `input.cpfPayload`
- Trocar `input.hop2Payloads` por `input.cnpjPayloads`
- Remover toda a lógica que lê `input.hop3Payloads` e a enrichment de `partnerName` via `esp-cpf` (esp-cpf não está mais nos slugs CPF, e drill-down de sócio agora vira uma busca CPF separada que contribui seu próprio nó com nome do `receita-federal-cpf-data-nascimento`)
- A iteração sobre `cnpjPayloads` continua, gerando nós CPF para sócios e arestas — mas sem o enrichment de nome via hop3

```typescript
// Bloco atualizado — substituir o "Hop 2" da versão atual:
for (const [cnpjRaw, payload] of Object.entries(input.cnpjPayloads ?? {})) {
  if (cnpjRaw.length !== 14) continue;
  const cnpjHash = hashDocument('cnpj', cnpjRaw);
  if (!nodeMap.has(cnpjHash)) {
    nodeMap.set(cnpjHash, makeCnpjNode(cnpjRaw));
  }
  const slug = payload['pessoas-relacionadas-cnpj'] as
    | { entidadesRelacionadas?: unknown }
    | null
    | undefined;
  const list = Array.isArray(slug?.entidadesRelacionadas)
    ? (slug?.entidadesRelacionadas as Entidade[])
    : [];
  for (const item of list) {
    const cpfRaw = typeof item.cpf === 'string' ? item.cpf.replace(/\D/g, '') : '';
    if (cpfRaw.length !== 11) continue;
    const partnerName = typeof item.nome === 'string' ? item.nome : undefined;
    const socioNode = makeCpfNode(cpfRaw, partnerName);
    nodeMap.set(socioNode.nodeHash, socioNode);
    edges.push({
      sourceHash: cnpjHash,
      targetHash: socioNode.nodeHash,
      kind: 'corporate_relation',
      evidence: corporateEvidenceFromEntidade(item),
    });
  }
}
```

- [ ] **Step 3: Rodar testes**

Run: `pnpm test -- lib/netrin/graph-bridge`
Expected: PASS

- [ ] **Step 4: Rodar typecheck completo**

Run: `pnpm typecheck`
Expected: PASS (Edge Function agora compatível)

- [ ] **Step 5: Rodar suite completa**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/netrin/graph-bridge.ts lib/netrin/graph-bridge.test.ts
git commit -m "refactor(netrin): graph-bridge usa cpfPayload/cnpjPayloads (sem hop3)"
```

---

## Task 9: Atualizar result-loader.ts para também decifrar caches de pivôs

**Files:**
- Modify: `lib/netrin/result-loader.test.ts`
- Modify: `lib/netrin/result-loader.ts`

Hoje, `loadEnrichmentForRoot` decifra apenas caches associadas a `enrichment_job_calls` do job atual. Com drill-down explícito, um operador pode ter aprofundado o CNPJ X em sessão anterior — esse cache existe em `netrin_cache` mas não tem call no job atual. Precisamos olhar o payload raiz para descobrir pivôs e tentar carregar seus caches também.

- [ ] **Step 1: Adicionar teste ao `result-loader.test.ts`**

Adicionar um teste que mocka:
- Um job CPF root (1 call, cached payload com `empresas-relacionadas-cpf.negociosRelacionados` contendo 2 CNPJs)
- 1 dos CNPJs tem entry em `netrin_cache` (foi aprofundado antes)
- O outro CNPJ não tem
- Verifica que `result.payloads.byCnpj` contém o hash do CNPJ aprofundado

Esse teste vai falhar inicialmente — a implementação atual não busca caches além das calls do job.

```typescript
// Adicionar dentro do describe existente:
it('decifra cache de CNPJ pivô do payload raiz mesmo sem call no job', async () => {
  // setup mocks: jobRow (CPF root, completed), calls (1 call hop=1),
  // netrin_cache rows (3): root CPF, CNPJ-aprofundado-antes, CNPJ-novo-não-existe-em-cache
  // payload do root tem empresas-relacionadas-cpf com 2 CNPJs
  // Verificar que byCnpj[cnpjAprofundadoHash] está populado
  // e que byCnpj[cnpjNovoHash] está ausente
  // (mock detalhado — seguir padrão dos testes existentes em result-loader.test.ts)
  // ...assert...
});
```

> O teste detalhado depende do shape exato dos mocks existentes no arquivo. Seguir o padrão atual de stubbing do `SupabaseClient` para `from('netrin_cache').select(...)`.

- [ ] **Step 2: Rodar — deve falhar**

Run: `pnpm test -- lib/netrin/result-loader.test`
Expected: FAIL no novo teste

- [ ] **Step 3: Implementar a extensão em `lib/netrin/result-loader.ts`**

Após o passo 4 atual ("Bulk-fetch netrin_cache rows for those hashes"), antes do return:

1. Se `hop1Payload` foi decifrado E `rootType === 'cpf'`, extrair pivôs CNPJ via `extractPivotCnpjs(hop1Payload)`.
2. Para cada pivô, calcular `hashDocument('cnpj', cnpjRaw)`.
3. Filtrar hashes que ainda não estão em `payloads.byCnpj`.
4. Buscar esses hashes adicionais em `netrin_cache` (mesma query, expira_at > now()).
5. Decifrar e adicionar em `payloads.byCnpj`.

Análogo para `rootType === 'cnpj'`: usar `extractPivotCpfs` no payload root (que está em `byCnpj[rootHash]`) e popular `byCpf`.

```typescript
// Após o atual "6. Decrypt each cache row..." (linha ~236 do arquivo atual):

// 7. Pivot lookup: descobrir hashes de docs relacionados via payload root
const pivotHashes: { hash: string; type: 'cpf' | 'cnpj' }[] = [];

if (input.rootType === 'cpf' && payloads.hop1) {
  for (const cnpjRaw of extractPivotCnpjs(payloads.hop1)) {
    const h = hashDocument('cnpj', cnpjRaw);
    if (!payloads.byCnpj[h]) pivotHashes.push({ hash: h, type: 'cnpj' });
  }
} else if (input.rootType === 'cnpj') {
  const rootCnpjPayload = payloads.byCnpj[input.rootHash];
  if (rootCnpjPayload) {
    for (const { cpf } of extractPivotCpfs(rootCnpjPayload)) {
      const h = hashDocument('cpf', cpf);
      if (!payloads.byCpf[h]) pivotHashes.push({ hash: h, type: 'cpf' });
    }
  }
}

if (pivotHashes.length > 0) {
  const { data: pivotRows, error: pivotError } = await admin
    .from('netrin_cache')
    .select('document_hash, document_type, encrypted_payload')
    .in('document_hash', pivotHashes.map((p) => p.hash))
    .gt('expires_at', now)
    .returns<CacheRow[]>();

  if (pivotError) {
    console.warn('loadEnrichmentForRoot: pivot cache query failed', pivotError.message);
  } else {
    await Promise.all(
      (pivotRows ?? []).map(async (row) => {
        try {
          const plaintext = await decryptNetrinText(admin, row.encrypted_payload);
          const parsed = JSON.parse(plaintext) as NetrinCompositePayload;
          if (row.document_type === 'cnpj') {
            payloads.byCnpj[row.document_hash] = parsed;
          } else {
            payloads.byCpf[row.document_hash] = parsed;
          }
        } catch (e) {
          console.warn('pivot decrypt failed', row.document_hash.slice(0, 8), e);
        }
      }),
    );
  }
}
```

Adicionar import no topo:
```typescript
import { hashDocument } from '@/lib/hash.ts';
import { extractPivotCnpjs } from './parsers/pivot-cnpjs.ts';
import { extractPivotCpfs } from './parsers/pivot-cpfs.ts';
```

- [ ] **Step 4: Rodar — deve passar**

Run: `pnpm test -- lib/netrin/result-loader.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/netrin/result-loader.ts lib/netrin/result-loader.test.ts
git commit -m "feat(netrin): result-loader decifra caches de pivôs além das calls do job"
```

---

## Task 10: Extrair helper compartilhado runCpfSearch / runCnpjSearch para Server Actions

**Files:**
- Create: `lib/predictus/run-search.ts`
- Create: `lib/predictus/run-search.test.ts`
- Modify: `app/(app)/search/person/actions.ts`
- Modify: `app/(app)/search/company/actions.ts`

> Esse helper é a "fonte única" da lógica de busca completa (audit + cache + predictus + searches + enrichment_job). Server Actions ficam thin. **Atenção: não confundir com `lib/netrin/hops/cpf-search.ts`** — esse é o cliente Netrin de baixo nível; o helper aqui é o orquestrador de busca completa em nível Server Action.

- [ ] **Step 1: Escrever testes em `lib/predictus/run-search.test.ts`**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { runCpfSearch, runCnpjSearch } from './run-search';

describe('runCpfSearch', () => {
  it('valida CPF e retorna hash + termPreview', async () => {
    // mock supabase admin, predictus client, audit writer, cache fns, jobStore
    // garantir que retorna { documentHash, termPreview } e NÃO chama redirect
    // ...
  });

  it('cache hit não chama predictus mas insere searches row', async () => {
    // mock getCachedResults retornando resultados
    // mock client com searchByCpf que falharia se chamado
    // assert: searches.insert chamado 1x, predictus client não invocado
    // ...
  });

  it('erro do predictus retorna { error } sem inserir searches success', async () => {
    // mock client.searchByCpf throw
    // assert: searches insert com error_message preenchido, retorno { ok: false, error: ... }
    // ...
  });

  it('rejeita CPF inválido sem nenhuma side effect', async () => {
    const result = await runCpfSearch('111', { /* deps */ });
    expect(result.ok).toBe(false);
  });
});

describe('runCnpjSearch', () => {
  it('valida CNPJ e cria enrichment job', async () => { /* análogo */ });
  it('cache hit retorna hash sem nova chamada', async () => { /* análogo */ });
  it('rejeita CNPJ inválido', async () => { /* análogo */ });
});
```

> O detalhe dos mocks segue o padrão usado em outros testes do projeto (vi.fn, stubs de SupabaseClient). Implementar com cuidado para evitar tocar o filesystem ou network.

- [ ] **Step 2: Rodar — deve falhar (arquivo ainda não existe)**

Run: `pnpm test -- lib/predictus/run-search.test`
Expected: FAIL

- [ ] **Step 3: Criar `lib/predictus/run-search.ts`**

```typescript
import { extractRequestContext, writeAuditLog } from '@/lib/audit';
import { encryptText } from '@/lib/crypto/vault';
import { hashDocument } from '@/lib/hash';
import { findOrCreateJob } from '@/lib/netrin/job-store';
import { getCachedResults, setCachedResults } from '@/lib/predictus/cache';
import { createServerPredictusClient } from '@/lib/predictus/server-client';
import type { PredictusProcess } from '@/lib/predictus/types';
import type { createAdminClient } from '@/lib/supabase/admin';
import type { createClient } from '@/lib/supabase/server';
import { isValid as isCnpjValid, mask as maskCnpj } from '@/lib/validators/cnpj';
import { isValid as isCpfValid, mask as maskCpf } from '@/lib/validators/cpf';

type Admin = ReturnType<typeof createAdminClient>;
type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type RunSearchContext = {
  userId: string;
  admin: Admin;
  supabase: ServerClient;
  ip: string | null;
  userAgent: string | null;
};

export type RunSearchSuccess = {
  ok: true;
  documentHash: string;
  termPreview: string;
};

export type RunSearchFailure = { ok: false; error: string };

export type RunSearchResult = RunSearchSuccess | RunSearchFailure;

export async function runCpfSearch(
  rawInput: string,
  ctx: RunSearchContext,
): Promise<RunSearchResult> {
  const trimmed = rawInput.trim();
  if (!trimmed) return { ok: false, error: 'Termo de busca vazio.' };
  if (!isCpfValid(trimmed)) return { ok: false, error: 'CPF inválido.' };

  const documentHash = hashDocument('cpf', trimmed);
  const termPreview = maskCpf(trimmed);

  await writeAuditLog(
    {
      userId: ctx.userId,
      action: 'search_single',
      searchType: 'cpf',
      documentHash,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
    ctx.admin,
    { allowFailure: true },
  );

  let cached: { results: PredictusProcess[]; fetchedAt: string } | null = null;
  try {
    cached = await getCachedResults(ctx.admin, documentHash);
  } catch (e) {
    console.warn('cache lookup failed:', e);
  }

  if (cached) {
    await ctx.supabase.from('searches').insert({
      user_id: ctx.userId,
      search_type: 'cpf',
      document_hash: documentHash,
      term_preview: termPreview,
      result_count: cached.results.length,
    } as never);
    await ensureEnrichmentJob(ctx.admin, ctx.userId, documentHash, 'cpf', trimmed);
    return { ok: true, documentHash, termPreview };
  }

  let results: PredictusProcess[];
  try {
    const client = await createServerPredictusClient();
    results = await client.searchByCpf(trimmed.replace(/\D/g, ''));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro na consulta.';
    await ctx.supabase.from('searches').insert({
      user_id: ctx.userId,
      search_type: 'cpf',
      document_hash: documentHash,
      term_preview: termPreview,
      result_count: 0,
      error_message: message,
    } as never);
    return { ok: false, error: message };
  }

  try {
    await setCachedResults(ctx.admin, documentHash, 'cpf', results);
  } catch (e) {
    console.warn('cache write failed:', e);
  }

  await ctx.supabase.from('searches').insert({
    user_id: ctx.userId,
    search_type: 'cpf',
    document_hash: documentHash,
    term_preview: termPreview,
    result_count: results.length,
  } as never);

  await ensureEnrichmentJob(ctx.admin, ctx.userId, documentHash, 'cpf', trimmed);

  return { ok: true, documentHash, termPreview };
}

export async function runCnpjSearch(
  rawInput: string,
  ctx: RunSearchContext,
): Promise<RunSearchResult> {
  const trimmed = rawInput.trim();
  if (!trimmed) return { ok: false, error: 'Termo de busca vazio.' };
  if (!isCnpjValid(trimmed)) return { ok: false, error: 'CNPJ inválido.' };

  const documentHash = hashDocument('cnpj', trimmed);
  const termPreview = maskCnpj(trimmed);

  await writeAuditLog(
    {
      userId: ctx.userId,
      action: 'search_single',
      searchType: 'cnpj',
      documentHash,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
    ctx.admin,
    { allowFailure: true },
  );

  let cached: { results: PredictusProcess[]; fetchedAt: string } | null = null;
  try {
    cached = await getCachedResults(ctx.admin, documentHash);
  } catch (e) {
    console.warn('cache lookup failed:', e);
  }

  if (cached) {
    await ctx.supabase.from('searches').insert({
      user_id: ctx.userId,
      search_type: 'cnpj',
      document_hash: documentHash,
      term_preview: termPreview,
      result_count: cached.results.length,
    } as never);
    await ensureEnrichmentJob(ctx.admin, ctx.userId, documentHash, 'cnpj', trimmed);
    return { ok: true, documentHash, termPreview };
  }

  let results: PredictusProcess[];
  try {
    const client = await createServerPredictusClient();
    results = await client.searchByCnpj(trimmed.replace(/\D/g, ''));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro na consulta.';
    await ctx.supabase.from('searches').insert({
      user_id: ctx.userId,
      search_type: 'cnpj',
      document_hash: documentHash,
      term_preview: termPreview,
      result_count: 0,
      error_message: message,
    } as never);
    return { ok: false, error: message };
  }

  try {
    await setCachedResults(ctx.admin, documentHash, 'cnpj', results);
  } catch (e) {
    console.warn('cache write failed:', e);
  }

  await ctx.supabase.from('searches').insert({
    user_id: ctx.userId,
    search_type: 'cnpj',
    document_hash: documentHash,
    term_preview: termPreview,
    result_count: results.length,
  } as never);

  await ensureEnrichmentJob(ctx.admin, ctx.userId, documentHash, 'cnpj', trimmed);

  return { ok: true, documentHash, termPreview };
}

async function ensureEnrichmentJob(
  admin: Admin,
  userId: string,
  rootHash: string,
  rootType: 'cpf' | 'cnpj',
  rawDoc: string,
): Promise<void> {
  try {
    const documentEncrypted = await encryptText(admin, rawDoc.replace(/\D/g, ''));
    await findOrCreateJob(admin, {
      userId,
      rootHash,
      rootType,
      documentEncrypted,
    });
  } catch (e) {
    console.warn('enrichment job creation failed:', e);
  }
}
```

- [ ] **Step 4: Rodar testes**

Run: `pnpm test -- lib/predictus/run-search.test`
Expected: PASS

- [ ] **Step 5: Reescrever `app/(app)/search/person/actions.ts`**

```typescript
'use server';

import { requirePermission } from '@/lib/auth/permissions';
import { extractRequestContext } from '@/lib/audit';
import { runCpfSearch } from '@/lib/predictus/run-search';
import { hashDocument } from '@/lib/hash';
import { getCachedResults, setCachedResults } from '@/lib/predictus/cache';
import { createServerPredictusClient } from '@/lib/predictus/server-client';
import type { PredictusProcess } from '@/lib/predictus/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { writeAuditLog } from '@/lib/audit';
import { maskName } from '@/lib/validators/name';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export type PersonSearchType = 'cpf' | 'name';

export type SearchPersonInput = { type: PersonSearchType; rawInput: string };

export type SearchPersonResult = { ok: false; error: string };

export async function searchPerson(input: SearchPersonInput): Promise<SearchPersonResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado.' };

  await requirePermission('search_person');

  const admin = createAdminClient();
  const requestContext = extractRequestContext(await headers());

  if (input.type === 'cpf') {
    const result = await runCpfSearch(input.rawInput, {
      userId: user.id,
      admin,
      supabase,
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
    });
    if (!result.ok) return result;
    redirect(`/search/result/${encodeURIComponent(result.documentHash)}`);
  }

  // Busca por nome — mantém fluxo legado inline (não há "Aprofundar" em nome)
  const trimmed = input.rawInput.trim();
  if (!trimmed) return { ok: false, error: 'Termo de busca vazio.' };
  if (trimmed.length < 3) {
    return { ok: false, error: 'O nome precisa ter ao menos 3 caracteres.' };
  }
  const documentHash = hashDocument('name', trimmed);
  const termPreview = maskName(trimmed);

  await writeAuditLog(
    {
      userId: user.id,
      action: 'search_single',
      searchType: 'name',
      documentHash,
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
    },
    admin,
    { allowFailure: true },
  );

  let cached: { results: PredictusProcess[]; fetchedAt: string } | null = null;
  try { cached = await getCachedResults(admin, documentHash); } catch (e) {
    console.warn('cache lookup failed:', e);
  }

  if (cached) {
    await supabase.from('searches').insert({
      user_id: user.id, search_type: 'name', document_hash: documentHash,
      term_preview: termPreview, result_count: cached.results.length,
    } as never);
    redirect(`/search/result/${encodeURIComponent(documentHash)}`);
  }

  let results: PredictusProcess[];
  try {
    const client = await createServerPredictusClient();
    results = await client.searchByName(trimmed);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro na consulta.';
    await supabase.from('searches').insert({
      user_id: user.id, search_type: 'name', document_hash: documentHash,
      term_preview: termPreview, result_count: 0, error_message: message,
    } as never);
    return { ok: false, error: message };
  }

  try { await setCachedResults(admin, documentHash, 'name', results); } catch (e) {
    console.warn('cache write failed:', e);
  }

  await supabase.from('searches').insert({
    user_id: user.id, search_type: 'name', document_hash: documentHash,
    term_preview: termPreview, result_count: results.length,
  } as never);

  redirect(`/search/result/${encodeURIComponent(documentHash)}`);
}
```

- [ ] **Step 6: Reescrever `app/(app)/search/company/actions.ts`**

```typescript
'use server';

import { extractRequestContext } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/permissions';
import { runCnpjSearch } from '@/lib/predictus/run-search';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export type SearchByCnpjInput = { rawInput: string };

export type SearchByCnpjResult = { ok: false; error: string };

export async function searchByCnpj(input: SearchByCnpjInput): Promise<SearchByCnpjResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado.' };

  await requirePermission('search_company');

  const admin = createAdminClient();
  const requestContext = extractRequestContext(await headers());

  const result = await runCnpjSearch(input.rawInput, {
    userId: user.id,
    admin,
    supabase,
    ip: requestContext.ip,
    userAgent: requestContext.userAgent,
  });
  if (!result.ok) return result;
  redirect(`/search/result/${encodeURIComponent(result.documentHash)}`);
}
```

- [ ] **Step 7: Rodar typecheck + testes**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add lib/predictus/run-search.ts lib/predictus/run-search.test.ts app/\(app\)/search/person/actions.ts app/\(app\)/search/company/actions.ts
git commit -m "refactor(search): extrai runCpfSearch/runCnpjSearch helpers compartilhados"
```

---

## Task 11: Criar resolver de CPF sócio (parent cache lookup)

**Files:**
- Create: `lib/netrin/resolve-socio.ts`
- Create: `lib/netrin/resolve-socio.test.ts`

Necessário pra drill-down de CPF sócio: o cliente só conhece o `cpfHash` + `parentCnpjHash`; o server resolve o plaintext do cache do parent.

- [ ] **Step 1: Escrever teste primeiro**

```typescript
// lib/netrin/resolve-socio.test.ts
import { describe, expect, it, vi } from 'vitest';
import { resolveSocioCpf } from './resolve-socio';

describe('resolveSocioCpf', () => {
  it('encontra o CPF cujo hash bate dentro do payload do parent CNPJ', async () => {
    const admin = {
      // mock: from('netrin_cache').select(...).eq('document_hash', parentHash) → cached row
      // mock: rpc('decrypt_netrin', ...) → JSON com pessoas-relacionadas-cnpj
    } as unknown as Parameters<typeof resolveSocioCpf>[0];
    // ... setup mocks de payload contendo um CPF cujo hashDocument('cpf', X) === input.cpfHash
    const result = await resolveSocioCpf(admin, {
      parentCnpjHash: 'cnpj:abc',
      cpfHash: 'cpf:expected-hash',
    });
    expect(result).toBe('11111111111');
  });

  it('retorna null se parent cache não existir', async () => {
    const admin = { /* from(...) retorna null */ } as never;
    const result = await resolveSocioCpf(admin, {
      parentCnpjHash: 'cnpj:abc',
      cpfHash: 'cpf:any',
    });
    expect(result).toBeNull();
  });

  it('retorna null se nenhum CPF no payload bater', async () => {
    // payload tem CPFs, mas nenhum cujo hash === cpfHash
    // assert null
  });
});
```

- [ ] **Step 2: Rodar — falha (arquivo não existe)**

Run: `pnpm test -- lib/netrin/resolve-socio.test`
Expected: FAIL

- [ ] **Step 3: Criar `lib/netrin/resolve-socio.ts`**

```typescript
import { decryptNetrinText } from '@/lib/crypto/vault';
import { hashDocument } from '@/lib/hash';
import type { Database } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractPivotCpfs } from './parsers/pivot-cpfs';
import type { NetrinCompositePayload } from './types';

export type ResolveSocioInput = {
  parentCnpjHash: string;
  cpfHash: string;
};

export async function resolveSocioCpf(
  admin: SupabaseClient<Database>,
  input: ResolveSocioInput,
): Promise<string | null> {
  const { data: row, error } = await admin
    .from('netrin_cache')
    .select('encrypted_payload')
    .eq('document_hash', input.parentCnpjHash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
    .returns<{ encrypted_payload: string }>();

  if (error || !row) return null;

  let payload: NetrinCompositePayload;
  try {
    const plaintext = await decryptNetrinText(admin, row.encrypted_payload);
    payload = JSON.parse(plaintext) as NetrinCompositePayload;
  } catch {
    return null;
  }

  for (const { cpf } of extractPivotCpfs(payload)) {
    if (cpf.length !== 11) continue;
    try {
      if (hashDocument('cpf', cpf) === input.cpfHash) return cpf;
    } catch {
      continue;
    }
  }

  return null;
}
```

- [ ] **Step 4: Rodar — passa**

Run: `pnpm test -- lib/netrin/resolve-socio.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/netrin/resolve-socio.ts lib/netrin/resolve-socio.test.ts
git commit -m "feat(netrin): resolveSocioCpf — recupera raw CPF via parent CNPJ cache"
```

---

## Task 12: Criar Server Action `deepenDocument`

**Files:**
- Create: `app/(app)/search/deepen/actions.ts`

- [ ] **Step 1: Criar o arquivo**

```typescript
'use server';

import { extractRequestContext } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/permissions';
import { resolveSocioCpf } from '@/lib/netrin/resolve-socio';
import { runCnpjSearch, runCpfSearch } from '@/lib/predictus/run-search';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isValid as isCnpjValid } from '@/lib/validators/cnpj';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export type DeepenInput =
  | { docType: 'cnpj'; cnpjRaw: string; currentPath?: string }
  | { docType: 'cpf-socio'; cpfHash: string; parentCnpjHash: string; currentPath?: string };

export type DeepenResult = { ok: false; error: string };

export async function deepenDocument(input: DeepenInput): Promise<DeepenResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado.' };

  const admin = createAdminClient();
  const requestContext = extractRequestContext(await headers());

  if (input.docType === 'cnpj') {
    await requirePermission('search_company');
    if (!isCnpjValid(input.cnpjRaw)) {
      return { ok: false, error: 'CNPJ inválido.' };
    }
    const result = await runCnpjSearch(input.cnpjRaw, {
      userId: user.id,
      admin,
      supabase,
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
    });
    if (!result.ok) return result;
    redirect(buildResultUrl(result.documentHash, input.currentPath));
  }

  // cpf-socio path
  await requirePermission('search_person');
  const rawCpf = await resolveSocioCpf(admin, {
    parentCnpjHash: input.parentCnpjHash,
    cpfHash: input.cpfHash,
  });
  if (!rawCpf) {
    return {
      ok: false,
      error: 'Não foi possível resolver o sócio. Refaça a consulta da empresa.',
    };
  }
  const result = await runCpfSearch(rawCpf, {
    userId: user.id,
    admin,
    supabase,
    ip: requestContext.ip,
    userAgent: requestContext.userAgent,
  });
  if (!result.ok) return result;
  redirect(buildResultUrl(result.documentHash, input.currentPath));
}

function buildResultUrl(newHash: string, currentPath?: string): string {
  const parts = currentPath ? currentPath.split(',').filter(Boolean) : [];
  const nextPath = [...parts, newHash].join(',');
  return `/search/result/${encodeURIComponent(newHash)}?path=${encodeURIComponent(nextPath)}`;
}
```

> Naming: o hash novo entra no path. A página em si lê o `?path=` e renderiza breadcrumb. Não duplica o hash atual (o último item do path é o documento atualmente visualizado).

- [ ] **Step 2: Rodar typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/search/deepen/actions.ts
git commit -m "feat(search): deepenDocument action — drill-down recursivo na rede"
```

---

## Task 13: Criar componente BreadcrumbNetwork

**Files:**
- Create: `components/breadcrumb-network.tsx`

- [ ] **Step 1: Criar `components/breadcrumb-network.tsx`**

```tsx
import { createAdminClient } from '@/lib/supabase/admin';
import { ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';

export type BreadcrumbNetworkProps = {
  pathParam: string | undefined;
  currentHash: string;
};

type SearchRow = {
  document_hash: string;
  term_preview: string;
  search_type: 'cpf' | 'cnpj' | 'name';
};

export async function BreadcrumbNetwork({ pathParam, currentHash }: BreadcrumbNetworkProps) {
  if (!pathParam) return null;

  const hashes = pathParam.split(',').filter(Boolean);
  if (hashes.length < 2) return null;

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from('searches')
    .select('document_hash, term_preview, search_type')
    .in('document_hash', hashes)
    .returns<SearchRow[]>();

  const byHash = new Map((rows ?? []).map((r) => [r.document_hash, r] as const));

  // Render breadcrumb up to 5 items; collapse middle if longer
  const items = hashes.map((h) => byHash.get(h) ?? { document_hash: h, term_preview: '…', search_type: 'cpf' as const });
  const displayed = items.length <= 5
    ? items
    : [items[0]!, { document_hash: '…', term_preview: '…', search_type: 'cpf' as const }, ...items.slice(-3)];

  return (
    <nav aria-label="Caminho na rede" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {displayed.map((item, idx) => {
        const isCurrent = item.document_hash === currentHash;
        const isLast = idx === displayed.length - 1;
        const subpath = hashes.slice(0, hashes.indexOf(item.document_hash) + 1).join(',');
        return (
          <span key={`${item.document_hash}-${idx}`} className="flex items-center gap-1">
            {isCurrent || item.document_hash === '…' ? (
              <span className={isCurrent ? 'font-semibold text-foreground' : ''}>{item.term_preview}</span>
            ) : (
              <Link
                href={`/search/result/${encodeURIComponent(item.document_hash)}?path=${encodeURIComponent(subpath)}`}
                className="hover:text-foreground hover:underline"
              >
                {item.term_preview}
              </Link>
            )}
            {!isLast ? <ChevronRightIcon className="size-3" /> : null}
          </span>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Rodar typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add components/breadcrumb-network.tsx
git commit -m "feat(ui): BreadcrumbNetwork — trilha de drill-down na rede"
```

---

## Task 14: Card de identidade CNPJ

**Files:**
- Create: `components/antifraude/identity-card-cnpj.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2Icon } from 'lucide-react';

export type IdentityCardCnpjProps = {
  status: 'missing' | 'running' | 'success' | 'error';
  razaoSocial?: string;
  nomeFantasia?: string;
  situacaoCadastral?: string;
  capitalSocial?: number;
  atividadePrincipal?: string;
  dataAbertura?: string;
};

function formatCurrency(v: number | undefined): string | undefined {
  if (typeof v !== 'number') return undefined;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function IdentityCardCnpj(props: IdentityCardCnpjProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-3">
        <Building2Icon className="size-4 text-muted-foreground" />
        <CardTitle className="text-sm font-medium">Identidade da empresa</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-xs">
        {props.status === 'running' ? (
          <p className="text-muted-foreground">Carregando…</p>
        ) : props.status === 'error' || props.status === 'missing' ? (
          <p className="text-muted-foreground">Dados indisponíveis.</p>
        ) : (
          <>
            <Row label="Razão social" value={props.razaoSocial} />
            <Row label="Nome fantasia" value={props.nomeFantasia} />
            <Row
              label="Situação"
              value={
                props.situacaoCadastral ? (
                  <Badge variant={props.situacaoCadastral.toLowerCase().includes('ativa') ? 'success' : 'destructive'}>
                    {props.situacaoCadastral}
                  </Badge>
                ) : undefined
              }
            />
            <Row label="Capital social" value={formatCurrency(props.capitalSocial)} />
            <Row label="Atividade" value={props.atividadePrincipal} />
            <Row label="Abertura" value={props.dataAbertura} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
```

- [ ] **Step 2: Verificar import**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add components/antifraude/identity-card-cnpj.tsx
git commit -m "feat(ui): IdentityCardCnpj"
```

---

## Task 15: Card de sanções/restrições CNPJ

**Files:**
- Create: `components/antifraude/sancoes-card-cnpj.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldAlertIcon } from 'lucide-react';

export type SancoesCardCnpjProps = {
  status: 'missing' | 'running' | 'success' | 'error';
  sancionado?: boolean;
  ceis?: { ativo: boolean; descricao?: string }[];
  cnep?: { ativo: boolean; descricao?: string }[];
  trabalhoEscravo?: boolean;
};

export function SancoesCardCnpj(props: SancoesCardCnpjProps) {
  const ceisAtivos = (props.ceis ?? []).filter((c) => c.ativo).length;
  const cnepAtivos = (props.cnep ?? []).filter((c) => c.ativo).length;
  const algumProblema = props.sancionado || ceisAtivos > 0 || cnepAtivos > 0 || props.trabalhoEscravo;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-3">
        <ShieldAlertIcon className="size-4 text-muted-foreground" />
        <CardTitle className="text-sm font-medium">Sanções e restrições</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-xs">
        {props.status === 'running' ? (
          <p className="text-muted-foreground">Carregando…</p>
        ) : props.status === 'error' || props.status === 'missing' ? (
          <p className="text-muted-foreground">Dados indisponíveis.</p>
        ) : !algumProblema ? (
          <Badge variant="success">Sem restrições</Badge>
        ) : (
          <>
            {props.sancionado ? <Badge variant="destructive">Sancionado</Badge> : null}
            {ceisAtivos > 0 ? <Badge variant="destructive">CEIS: {ceisAtivos} ativo(s)</Badge> : null}
            {cnepAtivos > 0 ? <Badge variant="destructive">CNEP: {cnepAtivos} ativo(s)</Badge> : null}
            {props.trabalhoEscravo ? <Badge variant="destructive">Trabalho escravo</Badge> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add components/antifraude/sancoes-card-cnpj.tsx
git commit -m "feat(ui): SancoesCardCnpj"
```

---

## Task 16: Card de sócios com "Aprofundar"

**Files:**
- Create: `components/antifraude/socios-card.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
'use client';

import { deepenDocument } from '@/app/(app)/search/deepen/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRightIcon, UsersIcon } from 'lucide-react';
import { useTransition } from 'react';

export type SocioEntry = {
  cpfHash: string;
  maskedPreview: string;
  nome?: string;
  vinculo?: string;
  percentual?: number;
  hasCached: boolean;
};

export type SociosCardProps = {
  status: 'missing' | 'running' | 'success' | 'error';
  parentCnpjHash: string;
  currentPath?: string;
  socios: SocioEntry[];
};

export function SociosCard(props: SociosCardProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-3">
        <UsersIcon className="size-4 text-muted-foreground" />
        <CardTitle className="text-sm font-medium">Sócios ({props.socios.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {props.status === 'running' ? (
          <p className="text-xs text-muted-foreground">Carregando…</p>
        ) : props.socios.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum sócio identificado.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {props.socios.map((s) => (
              <li key={s.cpfHash} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{s.nome ?? 'Nome não informado'}</span>
                  <span className="text-xs text-muted-foreground">{s.maskedPreview}</span>
                  <div className="flex flex-wrap gap-1 text-[0.65rem]">
                    {s.vinculo ? <Badge variant="outline">{s.vinculo}</Badge> : null}
                    {typeof s.percentual === 'number' ? <Badge variant="outline">{s.percentual}%</Badge> : null}
                  </div>
                </div>
                <Button
                  variant={s.hasCached ? 'outline' : 'default'}
                  size="sm"
                  disabled={isPending}
                  onClick={() => {
                    startTransition(async () => {
                      await deepenDocument({
                        docType: 'cpf-socio',
                        cpfHash: s.cpfHash,
                        parentCnpjHash: props.parentCnpjHash,
                        currentPath: props.currentPath,
                      });
                    });
                  }}
                >
                  {s.hasCached ? 'Ver detalhes' : 'Aprofundar'}
                  <ArrowRightIcon className="ml-1 size-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add components/antifraude/socios-card.tsx
git commit -m "feat(ui): SociosCard com drill-down de CPF sócio"
```

---

## Task 17: Estender RelatedCompanies com botão "Aprofundar" / "Ver detalhes"

**Files:**
- Modify: `components/antifraude/related-companies.tsx`
- Modify: `components/antifraude/types.ts` (se necessário expandir o tipo `RelatedCompanyEntry`)

- [ ] **Step 1: Inspecionar `components/antifraude/types.ts` e `related-companies.tsx`**

Confirmar o tipo `RelatedCompanyEntry` que vem da página. Esperado: já tem `cnpj` (raw), `hop2?` (data inline quando cache disponível). Adicionar opcional `hasCached: boolean` se ainda não existir; e adicionar prop `currentPath?: string` ao componente.

- [ ] **Step 2: Adicionar import e botão por linha em `related-companies.tsx`**

No render de cada linha, adicionar:

```tsx
{/* dentro do <li> ou row, ao final */}
<form
  action={async (formData) => {
    const cnpj = formData.get('cnpj') as string;
    await deepenDocument({
      docType: 'cnpj',
      cnpjRaw: cnpj,
      currentPath: props.currentPath,
    });
  }}
>
  <input type="hidden" name="cnpj" value={item.cnpj} />
  <Button type="submit" size="sm" variant={item.hop2 ? 'outline' : 'default'}>
    {item.hop2 ? 'Ver detalhes' : 'Aprofundar'}
    <ArrowRightIcon className="ml-1 size-3" />
  </Button>
</form>
```

> Form-action server-side é OK aqui — CNPJ não é dado pessoal. Não precisa de `'use client'`.

- [ ] **Step 3: Adicionar import no topo do arquivo:**

```tsx
import { deepenDocument } from '@/app/(app)/search/deepen/actions';
import { Button } from '@/components/ui/button';
import { ArrowRightIcon } from 'lucide-react';
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/antifraude/related-companies.tsx components/antifraude/types.ts
git commit -m "feat(ui): RelatedCompanies — botão Aprofundar / Ver detalhes por linha"
```

---

## Task 18: Atualizar página de resultado para branch CPF vs CNPJ + breadcrumb

**Files:**
- Modify: `app/(app)/search/result/[hash]/page.tsx`

- [ ] **Step 1: Adicionar imports no topo**

```tsx
import { BreadcrumbNetwork } from '@/components/breadcrumb-network';
import { IdentityCardCnpj } from '@/components/antifraude/identity-card-cnpj';
import { SancoesCardCnpj } from '@/components/antifraude/sancoes-card-cnpj';
import { SociosCard, type SocioEntry } from '@/components/antifraude/socios-card';
```

- [ ] **Step 2: Adicionar searchParams ao componente**

```tsx
export default async function ResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ hash: string }>;
  searchParams: Promise<{ path?: string }>;
}) {
  // ...
  const { path: pathParam } = await searchParams;
```

- [ ] **Step 3: Após o `<header>`, antes do Card de resultados, inserir o breadcrumb**

```tsx
<BreadcrumbNetwork pathParam={pathParam} currentHash={documentHash} />
```

- [ ] **Step 4: Branchear a seção "Antifraude" por tipo de busca**

Substituir o bloco `{job ? (<section ...>)` por:

```tsx
{job ? (
  <section className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="font-heading text-xl font-semibold tracking-tight text-foreground">
        Análise antifraude
      </h2>
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant={
          job.status === 'completed' ? 'success' :
          job.status === 'failed' ? 'destructive' : 'secondary'
        }>
          {job.status === 'completed' ? 'Concluído'
            : job.status === 'failed' ? 'Erro'
            : job.status === 'running' ? 'Em andamento'
            : 'Pendente'}
        </Badge>
      </div>
    </div>

    <EnrichmentRealtime jobId={job.id} />

    {searchRow.search_type === 'cpf' ? (
      <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <IdentityCard status={cardStatus} {...identityProps} />
          <PepCard status={cardStatus} {...pepProps} />
          <MediaCard status={cardStatus} {...mediaProps} />
        </div>
        <RelatedCompanies status={cardStatus} items={relatedItems} currentPath={pathParam ?? documentHash} />
      </>
    ) : (
      <CnpjResultSection
        rootHash={documentHash}
        rootPayload={byCnpj[documentHash] ?? null}
        cardStatus={cardStatus}
        currentPath={pathParam ?? documentHash}
      />
    )}
  </section>
) : null}
```

> O `currentPath` passa a string raw (vai virar `?path=` no redirect via `deepenDocument`).

- [ ] **Step 5: Adicionar componente helper `CnpjResultSection` no mesmo arquivo (server component inline)**

```tsx
function CnpjResultSection({
  rootHash,
  rootPayload,
  cardStatus,
  currentPath,
}: {
  rootHash: string;
  rootPayload: NetrinCompositePayload | null;
  cardStatus: 'missing' | 'running' | 'success' | 'error';
  currentPath: string;
}) {
  const cnpjIdent = rootPayload ? extractCnpjIdentity(rootPayload) : null;
  const cnpjSanc = rootPayload ? extractCnpjSancoes(rootPayload) : null;
  const cnpjMedia = rootPayload ? extractMediaFromHop1(rootPayload) : null;
  const socios = rootPayload ? extractSocios(rootPayload) : [];

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <IdentityCardCnpj status={cardStatus} {...cnpjIdent} />
        <SancoesCardCnpj status={cardStatus} {...cnpjSanc} />
        <MediaCard status={cardStatus} {...cnpjMedia} />
      </div>
      <SociosCard
        status={cardStatus}
        parentCnpjHash={rootHash}
        currentPath={currentPath}
        socios={socios}
      />
    </>
  );
}
```

- [ ] **Step 6: Adicionar extractors para CNPJ payload no mesmo arquivo**

```tsx
type EspCnpjCompleto = {
  razaoSocial?: unknown;
  nomeFantasia?: unknown;
  situacaoCadastral?: unknown;
  capitalSocial?: unknown;
  atividadeEconomica?: unknown;
  dataAbertura?: unknown;
};

function extractCnpjIdentity(p: NetrinCompositePayload) {
  const slug = (p as Record<string, unknown>)['esp-cnpj-completo'] as
    | EspCnpjCompleto | null | undefined;
  return {
    razaoSocial: typeof slug?.razaoSocial === 'string' ? slug.razaoSocial : undefined,
    nomeFantasia: typeof slug?.nomeFantasia === 'string' ? slug.nomeFantasia : undefined,
    situacaoCadastral: typeof slug?.situacaoCadastral === 'string' ? slug.situacaoCadastral : undefined,
    capitalSocial: typeof slug?.capitalSocial === 'number' ? slug.capitalSocial : undefined,
    atividadePrincipal: typeof slug?.atividadeEconomica === 'string' ? slug.atividadeEconomica : undefined,
    dataAbertura: typeof slug?.dataAbertura === 'string' ? slug.dataAbertura : undefined,
  };
}

type PepKycCnpj = {
  sancionado?: unknown;
};

type CeisItem = { ativo?: unknown; descricaoSancao?: unknown };
type CnepItem = { ativo?: unknown; descricaoSancao?: unknown };
type TrabalhoEscravoSlug = { empregador?: unknown[] };

function extractCnpjSancoes(p: NetrinCompositePayload) {
  const pep = (p as Record<string, unknown>)['pep-kyc-cnpj'] as PepKycCnpj | null | undefined;
  const ceisList = (p as Record<string, unknown>)['portal-transparencia-ceis'] as
    | { sancoes?: CeisItem[] } | null | undefined;
  const cnepList = (p as Record<string, unknown>)['portal-transparencia-cnep'] as
    | { sancoes?: CnepItem[] } | null | undefined;
  const trabSlug = (p as Record<string, unknown>)['trabalho-escravo'] as
    | TrabalhoEscravoSlug | null | undefined;

  return {
    sancionado: pep?.sancionado === true || pep?.sancionado === 'S',
    ceis: (ceisList?.sancoes ?? []).map((c) => ({
      ativo: c.ativo === true,
      descricao: typeof c.descricaoSancao === 'string' ? c.descricaoSancao : undefined,
    })),
    cnep: (cnepList?.sancoes ?? []).map((c) => ({
      ativo: c.ativo === true,
      descricao: typeof c.descricaoSancao === 'string' ? c.descricaoSancao : undefined,
    })),
    trabalhoEscravo: Array.isArray(trabSlug?.empregador) && trabSlug.empregador.length > 0,
  };
}

type PessoasRelCnpjEntity = {
  cpf?: unknown;
  nome?: unknown;
  vinculoDoRelacionamento?: unknown;
  percentualParticipacaoSociedade?: unknown;
};

function extractSocios(p: NetrinCompositePayload): SocioEntry[] {
  const slug = (p as Record<string, unknown>)['pessoas-relacionadas-cnpj'] as
    | { entidadesRelacionadas?: PessoasRelCnpjEntity[] } | null | undefined;
  const list = Array.isArray(slug?.entidadesRelacionadas) ? slug.entidadesRelacionadas : [];
  return list.reduce<SocioEntry[]>((acc, item) => {
    const cpfRaw = typeof item.cpf === 'string' ? item.cpf.replace(/\D/g, '') : '';
    if (cpfRaw.length !== 11) return acc;
    let cpfHash: string;
    try {
      cpfHash = hashDocument('cpf', cpfRaw);
    } catch {
      return acc;
    }
    acc.push({
      cpfHash,
      maskedPreview: maskCpf(cpfRaw),
      nome: typeof item.nome === 'string' ? item.nome : undefined,
      vinculo: typeof item.vinculoDoRelacionamento === 'string' ? item.vinculoDoRelacionamento : undefined,
      percentual: typeof item.percentualParticipacaoSociedade === 'number' ? item.percentualParticipacaoSociedade : undefined,
      hasCached: false, // será preenchido em Step 7
    });
    return acc;
  }, []);
}
```

Adicionar import:
```tsx
import { mask as maskCpf } from '@/lib/validators/cpf';
```

- [ ] **Step 7: Marcar socios.hasCached com base em `enrichment.payloads.byCpf`**

Após `extractSocios(...)`, mapear:
```tsx
const sociosWithCache = socios.map((s) => ({
  ...s,
  hasCached: !!(enrichment?.payloads.byCpf?.[s.cpfHash]),
}));
```

E passar `sociosWithCache` para `<SociosCard ... socios={sociosWithCache} />`.

> A função `extractSocios` está dentro do `CnpjResultSection` mas precisa do `enrichment` do escopo do ResultPage. Refactor: passar `byCpfHashes: string[]` (lista de hashes que têm cache) como prop do `CnpjResultSection`, ou mover a montagem dos `socios` para o ResultPage e passar pronto. **Mover montagem para ResultPage é mais limpo.**

Reorganizar: `extractSocios` recebe `(payload, sociosWithCacheHashes: Set<string>)` e marca `hasCached`. ResultPage faz:

```tsx
const cnpjRootPayload = searchRow.search_type === 'cnpj' ? (byCnpj[documentHash] ?? null) : null;
const cachedCpfHashes = new Set(Object.keys(enrichment?.payloads.byCpf ?? {}));
const socios = cnpjRootPayload ? extractSocios(cnpjRootPayload, cachedCpfHashes) : [];
```

E passar `socios` direto para o `CnpjResultSection`. Ajustar a definição de `CnpjResultSection` para aceitar `socios` como prop.

- [ ] **Step 8: Rodar typecheck e build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add app/\(app\)/search/result/\[hash\]/page.tsx
git commit -m "feat(ui): branch página de resultado CPF vs CNPJ + breadcrumb de drill-down"
```

---

## Task 19: Smoke test manual + suite completa

**Files:** N/A (validação)

- [ ] **Step 1: Pré-requisitos para smoke**

```bash
pnpm exec supabase start  # se não estiver rodando
pnpm dev                  # porta 3000
```

- [ ] **Step 2: Rodar suite completa**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: tudo verde. Vitest count deve ter ajustado para refletir os testes deletados (hop3.test) e adicionados (processor.test reescrito, resolve-socio.test, run-search.test, result-loader.test estendido). Esperado: ≥ 270 testes.

- [ ] **Step 3: Smoke manual — fluxo CPF**

1. Login como operador.
2. Busca CPF válido em `/search/person`.
3. Navega para `/search/result/<hash>`. Aguarda Realtime atualizar status para "Concluído".
4. **Verificar:** página mostra IdentityCard, PepCard, MediaCard, RelatedCompanies. **Sem cards hop2 inline** nas empresas relacionadas (só razão social + vínculo + botão "Aprofundar").
5. Verifica no Network DevTools: 1 chamada para Netrin (consulta-composta), 1 chamada Predictus. Sem cascata.

- [ ] **Step 4: Smoke manual — drill-down CNPJ**

1. Da página acima, clica "Aprofundar" em uma empresa relacionada.
2. **Verificar:** redirect para `/search/result/<cnpj-hash>?path=<cpf-hash>,<cnpj-hash>` (o path contém os dois hashes).
3. Página renderiza IdentityCardCnpj, SancoesCardCnpj, MediaCard, SociosCard.
4. BreadcrumbNetwork aparece no topo: "CPF José ▸ CNPJ ACME".
5. Sem mais chamadas Netrin que a do próprio CNPJ.

- [ ] **Step 5: Smoke manual — drill-down CPF sócio**

1. Da página CNPJ, clica "Aprofundar" em um sócio.
2. **Verificar:** redirect para `/search/result/<cpf-socio-hash>?path=<cpf1>,<cnpj>,<cpf-socio>`.
3. Página renderiza CPF cards normalmente.
4. BreadcrumbNetwork mostra 3 níveis: "CPF José ▸ CNPJ ACME ▸ CPF Maria".

- [ ] **Step 6: Smoke manual — cache hit + voltar**

1. Volta via breadcrumb para o CNPJ.
2. **Verificar:** botão do sócio aprofundado agora mostra "Ver detalhes" (não "Aprofundar"), pois `hasCached: true`.
3. Clica "Ver detalhes" — redireciona normalmente; deve ser instantâneo (cache hit).

- [ ] **Step 7: Verificar `/history` e `/audit`**

1. Acessa `/history`. Deve listar todas as buscas: CPF raiz, CNPJ aprofundado, CPF sócio.
2. Acessa `/audit`. Mesmas entradas, cada uma com `action='search_single'`.

- [ ] **Step 8: Verificar grafo**

1. Acessa `/network/<root-cpf-hash>`.
2. Grafo deve ter:
   - Nó CPF raiz
   - Nó CNPJ aprofundado (com aresta `corporate_relation` a partir do CPF)
   - Nó CPF sócio (com aresta `corporate_relation` a partir do CNPJ)
3. Toggle "Societário" mostra/oculta essas arestas.

- [ ] **Step 9: Commit final (se houve ajustes)**

```bash
git status
# se nada a commitar, OK; senão, commitar últimos polish
```

---

## Self-Review

Após escrever o plano, revisar contra o spec:

- **Cobertura:** Todos os pontos da seção "Mudanças por arquivo" do spec mapeados em tasks? **Sim** — types.ts (T1), hops (T2-T4), processor (T5-T6), edge function (T7), graph-bridge (T8), result-loader (T9), helper de search (T10), resolve-socio (T11), deepen action (T12), breadcrumb (T13), CNPJ cards (T14-T16), related-companies (T17), página (T18).
- **Placeholders:** Nenhum "TBD" ou "implement later". Os mocks de teste em T10 e T11 têm guidance ("seguir padrão dos testes existentes") porque o setup exato de mock depende do arquivo a ser inspecionado em runtime.
- **Consistência de tipos:** `runCpfSearch` no `lib/predictus/run-search.ts` (helper de busca completa) distinto do `runCpfSearch` de `lib/netrin/hops/cpf-search.ts` (chamada Netrin baixo nível). Documento o naming em T10 para evitar confusão.
- **Scope:** Single plan, single feature. ✓

---

## Riscos e mitigations

- **Build transientemente quebrado em Tasks 1-7.** Mitigação: cada commit tem mensagem clara indicando o próximo task que conserta; ninguém deve fazer `git bisect` no meio dessa sequência.
- **Mock de SupabaseClient em testes pode ser frágil.** Mitigação: seguir o padrão do projeto (`vi.fn` + chained `.eq.maybeSingle`); olhar `cache.test.ts` como exemplo.
- **CNPJ payload parsing pode ter campos com nomes diferentes do esperado.** Mitigação: smoke test (Task 19) é a verificação real; ajustar `extractCnpjIdentity` / `extractCnpjSancoes` se nomes divergirem da estrutura assumida.
- **Deepen action chamada por client component `SociosCard` vs server component `RelatedCompanies`.** Ambos funcionam: client usa `useTransition`, server usa `<form action>`. Padrão Next.js 16.
