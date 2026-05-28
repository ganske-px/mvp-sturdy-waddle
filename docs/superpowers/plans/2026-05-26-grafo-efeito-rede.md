# Grafo / Efeito de Rede — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Densificar e corrigir o grafo compartilhado (`graph_nodes`/`graph_edges`) para que toda relação que já pagamos vire aresta persistente, mais flags de risco no nó e travessia de caminho entre dois documentos.

**Architecture:** O grafo é append-only, compartilhado entre operadores, escrito via `service_role` pelo RPC `upsert_graph`. Hoje quem alimenta o grafo são: (1) Predictus → arestas de processo (`co_party`/`client_lawyer`/`lawyer_lawyer`) via `extractGraph` em `setCachedResults`; (2) Netrin → arestas `corporate_relation`/`family_relation` via `buildNetrinGraph` no `finalize` do Edge Function de enrichment. As 4 fases abaixo são **independentes e shippáveis em ordem** — cada uma fecha verde sozinha.

**Tech Stack:** Next.js 16 (App Router) + React 19 + TypeScript strict, Supabase (Postgres 16 + Edge Functions Deno), Vitest (TDD), Biome.

---

## Contexto crítico (ler antes de tocar código)

### Verdade canônica das chaves do payload Netrin

A página `app/(app)/search/result/[hash]/page.tsx` é o **parser autoritativo** (renderiza os cards em produção). As chaves reais do `consulta-composta` são:

| Dado | Chave do payload | Forma do item |
|------|------------------|---------------|
| Empresas relacionadas a CPF | **`empresasRelacionadasCPF`** (camelCase) | `negociosRelacionados[]` com `entidadeRelacionadaDocumento`, `entidadeRelacionadadaTipoDeDocumento` (`'CNPJ'`), `entidadeRelacionadaNome`, `tipoDeRelacionamento`, `dataInicioRelacionamento`, `dataFimRelacionamento` |
| Pessoas relacionadas a CPF (família) | **`pessoasRelacionadasCPF`** (camelCase) | `entidadesRelacionadas[]`, mesmo formato, `entidadeRelacionadadaTipoDeDocumento === 'CPF'` |
| Sócios de CNPJ | **`pessoas-relacionadas-cnpj`** (kebab) | `entidadesRelacionadas[]` com `cpf`, `nome`, `vinculoDoRelacionamento`, `percentualParticipacaoSociedade` |
| PEP (CPF) | **`pepKyc`** (camelCase) | `currentlyPEP`, `currentlySanctioned`, `previouslySanctioned` (valores `true`/`'Sim'`/`'SIM'`/`'S'`) |
| Sanções (CNPJ) | **`pep-kyc-cnpj`** (kebab) `sancionado`; **`portal-transparencia-ceis`** `{sancoes:[{ativo,descricaoSancao}]}`; **`portal-transparencia-cnep`** idem; **`trabalho-escravo`** `{empregador:[]}` |

### Bug confirmado em produção (motiva a Fase 0)

`lib/netrin/graph-bridge.ts` (o que **escreve** o grafo) lê `cpfPayload['empresas-relacionadas-cpf']` (kebab) e o campo `item.cnpj`. **Nenhum dos dois existe** no payload real (a chave é `empresasRelacionadasCPF` e o campo é `entidadeRelacionadaDocumento`). Resultado: **toda aresta CPF→empresa está silenciosamente ausente do grafo compartilhado.** A família (`pessoasRelacionadasCPF`) e os sócios de CNPJ (`pessoas-relacionadas-cnpj`) usam as chaves certas e funcionam.

### Decisões do produto (já tomadas)

- **Risco no nó:** flags booleanas em claro (`is_pep`, `has_sanction`) — sem o detalhe pessoal sensível.
- **Travessia:** `findPathBetween(hashA, hashB)` no grafo todo, mantendo leitura de vizinhança 1-hop.
- **Fora de escopo (plano futuro):** extrair `receita-federal-cnpj-qsa` / `informacoes-socios-pj` — esses slugs são pagos mas **nenhum lugar do código os parseia** e não há payload real capturado; exige capturar uma amostra real antes de escrever código exato.

### Baseline

`pnpm test` → **342 passing (38 files)**. Cada fase deve aumentar esse número. Nunca commitar com `pnpm typecheck` ou `pnpm test` vermelho.

---

## FASE 0 — Corrigir arestas CPF→empresa + sincronizar tipos

**Por quê primeiro:** restaura uma categoria inteira de relações ao grafo a custo zero de API. Maior ROI do plano.

**Files:**
- Create: `lib/netrin/parsers/related-companies.ts`
- Create: `lib/netrin/parsers/related-companies.test.ts`
- Modify: `lib/netrin/graph-bridge.ts` (bloco CPF→empresa, linhas ~116-142; remover `Negocio`/`corporateEvidenceFromNegocio` agora órfãos)
- Modify: `lib/netrin/graph-bridge.test.ts` (corrigir fixture do teste "emits corporate edges" para a chave real)
- Modify: `lib/supabase/types.ts` (union de `graph_edges.kind` em Row/Insert/Update)

---

- [ ] **Step 0.1: Escrever o teste do novo parser (falhando)**

Create `lib/netrin/parsers/related-companies.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { extractRelatedCompanies } from './related-companies';

describe('extractRelatedCompanies', () => {
  it('returns empty when slug missing', () => {
    expect(extractRelatedCompanies({})).toEqual([]);
  });

  it('reads empresasRelacionadasCPF.negociosRelacionados[] CNPJ entities', () => {
    const payload = {
      empresasRelacionadasCPF: {
        negociosRelacionados: [
          {
            entidadeRelacionadaDocumento: '12.345.678/0001-90',
            entidadeRelacionadadaTipoDeDocumento: 'CNPJ',
            entidadeRelacionadaNome: 'ACME LTDA',
            tipoDeRelacionamento: 'SOCIO',
            dataInicioRelacionamento: '2020-01-01',
            dataFimRelacionamento: '9999-12-31',
          },
        ],
      },
    } as never;
    expect(extractRelatedCompanies(payload)).toEqual([
      {
        cnpj: '12345678000190',
        razaoSocial: 'ACME LTDA',
        vinculo: 'SOCIO',
        dataInicio: '2020-01-01',
        dataFim: '9999-12-31',
      },
    ]);
  });

  it('skips CPF-typed entities and malformed CNPJs, and dedups', () => {
    const payload = {
      empresasRelacionadasCPF: {
        negociosRelacionados: [
          { entidadeRelacionadaDocumento: '08631699888', entidadeRelacionadadaTipoDeDocumento: 'CPF' },
          { entidadeRelacionadaDocumento: 'lixo', entidadeRelacionadadaTipoDeDocumento: 'CNPJ' },
          { entidadeRelacionadaDocumento: '12345678000190', entidadeRelacionadadaTipoDeDocumento: 'CNPJ' },
          { entidadeRelacionadaDocumento: '12.345.678/0001-90', entidadeRelacionadadaTipoDeDocumento: 'CNPJ' },
        ],
      },
    } as never;
    expect(extractRelatedCompanies(payload).map((c) => c.cnpj)).toEqual(['12345678000190']);
  });

  it('defaults vinculo to INDEFINIDO and handles non-array shape', () => {
    expect(extractRelatedCompanies({ empresasRelacionadasCPF: { negociosRelacionados: 'nope' } } as never)).toEqual([]);
    const payload = {
      empresasRelacionadasCPF: {
        negociosRelacionados: [{ entidadeRelacionadaDocumento: '12345678000190', entidadeRelacionadadaTipoDeDocumento: 'CNPJ' }],
      },
    } as never;
    expect(extractRelatedCompanies(payload)[0]?.vinculo).toBe('INDEFINIDO');
  });
});
```

- [ ] **Step 0.2: Rodar o teste e confirmar que falha**

Run: `pnpm test -- lib/netrin/parsers/related-companies`
Expected: FAIL — `Failed to resolve import "./related-companies"`.

- [ ] **Step 0.3: Implementar o parser**

Create `lib/netrin/parsers/related-companies.ts`:

```ts
// lib/netrin/parsers/related-companies.ts
import type { NetrinCompositePayload } from '@/lib/netrin/types.ts';

export type RelatedCompany = {
  cnpj: string;
  razaoSocial?: string;
  vinculo: string;
  dataInicio?: string;
  dataFim?: string;
};

type Negocio = {
  entidadeRelacionadaDocumento?: unknown;
  entidadeRelacionadadaTipoDeDocumento?: unknown;
  entidadeRelacionadaNome?: unknown;
  tipoDeRelacionamento?: unknown;
  dataInicioRelacionamento?: unknown;
  dataFimRelacionamento?: unknown;
};

export function extractRelatedCompanies(payload: NetrinCompositePayload): RelatedCompany[] {
  const slug = (payload as Record<string, unknown>).empresasRelacionadasCPF as
    | { negociosRelacionados?: unknown }
    | null
    | undefined;
  const list = slug?.negociosRelacionados;
  if (!Array.isArray(list)) return [];

  const seen = new Set<string>();
  const out: RelatedCompany[] = [];
  for (const item of list as Negocio[]) {
    if (item?.entidadeRelacionadadaTipoDeDocumento !== 'CNPJ') continue;
    const cnpj =
      typeof item.entidadeRelacionadaDocumento === 'string'
        ? item.entidadeRelacionadaDocumento.replace(/\D/g, '')
        : '';
    if (cnpj.length !== 14) continue;
    if (seen.has(cnpj)) continue;
    seen.add(cnpj);
    out.push({
      cnpj,
      razaoSocial:
        typeof item.entidadeRelacionadaNome === 'string' ? item.entidadeRelacionadaNome : undefined,
      vinculo:
        typeof item.tipoDeRelacionamento === 'string' ? item.tipoDeRelacionamento : 'INDEFINIDO',
      dataInicio:
        typeof item.dataInicioRelacionamento === 'string'
          ? item.dataInicioRelacionamento
          : undefined,
      dataFim:
        typeof item.dataFimRelacionamento === 'string' ? item.dataFimRelacionamento : undefined,
    });
  }
  return out;
}
```

- [ ] **Step 0.4: Rodar e confirmar verde**

Run: `pnpm test -- lib/netrin/parsers/related-companies`
Expected: PASS (4 tests).

- [ ] **Step 0.5: Corrigir a fixture do teste do bridge (passa a refletir o payload real → falha contra o código bugado)**

Em `lib/netrin/graph-bridge.test.ts`, no teste `'emits corporate edges from CPF root → CNPJs'`, substituir o objeto `cpfPayload`:

De:
```ts
      cpfPayload: {
        'pep-kyc-cpf': { nome: 'JOAO' },
        'empresas-relacionadas-cpf': {
          negociosRelacionados: [
            {
              cnpj: '12345678000190',
              razaoSocial: 'ACME LTDA',
              tipoVinculo: 'OWNERSHIP',
              dataInicioRelacionamento: '2020-01-01',
              dataFimRelacionamento: '9999-12-31',
              percentualParticipacao: 100,
            },
          ],
        },
      },
```
Para:
```ts
      cpfPayload: {
        empresasRelacionadasCPF: {
          negociosRelacionados: [
            {
              entidadeRelacionadaDocumento: '12345678000190',
              entidadeRelacionadadaTipoDeDocumento: 'CNPJ',
              entidadeRelacionadaNome: 'ACME LTDA',
              tipoDeRelacionamento: 'OWNERSHIP',
              dataInicioRelacionamento: '2020-01-01',
              dataFimRelacionamento: '9999-12-31',
            },
          ],
        },
      } as never,
```

E ajustar a asserção de evidência (remover `percentualParticipacao`, que não vem nesse nível):
```ts
    expect(corp[0]?.evidence).toMatchObject({
      vinculo: 'OWNERSHIP',
      source: 'empresas-relacionadas-cpf',
    });
```

No segundo teste (`'emits CNPJ → CPF socio edges'`) e no terceiro (`'omits malformed cnpj/cpf rows silently'`), trocar a chave `'empresas-relacionadas-cpf'` por `empresasRelacionadasCPF` e os campos `{ cnpj, razaoSocial }` por `{ entidadeRelacionadaDocumento, entidadeRelacionadadaTipoDeDocumento: 'CNPJ', entidadeRelacionadaNome }`. Exemplo para o terceiro:
```ts
      cpfPayload: {
        empresasRelacionadasCPF: {
          negociosRelacionados: [
            { entidadeRelacionadaDocumento: 'invalid', entidadeRelacionadadaTipoDeDocumento: 'CNPJ' },
            { entidadeRelacionadaDocumento: '12345678000190', entidadeRelacionadadaTipoDeDocumento: 'CNPJ' },
          ],
        },
      } as never,
```

- [ ] **Step 0.6: Rodar e confirmar que o bridge falha (prova o bug)**

Run: `pnpm test -- lib/netrin/graph-bridge`
Expected: FAIL — `corp` tem length 0 (o bridge lê a chave kebab que não existe mais na fixture).

- [ ] **Step 0.7: Reescrever o bloco CPF→empresa do bridge usando o parser**

Em `lib/netrin/graph-bridge.ts`:

1. Adicionar import no topo (junto dos outros imports):
```ts
import { extractRelatedCompanies } from './parsers/related-companies.ts';
```

2. Substituir o bloco inteiro `// CPF root → relaciona CNPJs de empresas` (do `if (input.cpfPayload) {` até o `}` que fecha esse primeiro bloco, ~linhas 116-142) por:
```ts
  // CPF root → relaciona CNPJs de empresas
  if (input.cpfPayload) {
    for (const empresa of extractRelatedCompanies(input.cpfPayload)) {
      const node = makeCnpjNode(empresa.cnpj, empresa.razaoSocial);
      nodeMap.set(node.nodeHash, node);
      if (input.rootDocument.type === 'cpf') {
        edges.push({
          sourceHash: hashDocument('cpf', input.rootDocument.raw),
          targetHash: node.nodeHash,
          kind: 'corporate_relation',
          evidence: {
            vinculo: empresa.vinculo,
            dataInicioRelacionamento: empresa.dataInicio,
            dataFimRelacionamento: empresa.dataFim,
            source: 'empresas-relacionadas-cpf',
          },
        });
      }
    }
  }
```

3. Remover agora o tipo `Negocio` (linhas ~20-28) e a função `corporateEvidenceFromNegocio` (linhas ~65-85) — ficaram órfãos. (Manter `Entidade`, `RelatedEntity`, `corporateEvidenceFromEntidade`, que o caminho CNPJ→sócio ainda usa.)

- [ ] **Step 0.8: Rodar e confirmar verde**

Run: `pnpm test -- lib/netrin/graph-bridge`
Expected: PASS (6 tests).

- [ ] **Step 0.9: Sincronizar `lib/supabase/types.ts`**

Na tabela `graph_edges`, em Row, Insert e Update, trocar o tipo de `kind` de:
```ts
          kind: 'co_party' | 'client_lawyer' | 'lawyer_lawyer';
```
para:
```ts
          kind:
            | 'co_party'
            | 'client_lawyer'
            | 'lawyer_lawyer'
            | 'corporate_relation'
            | 'family_relation';
```
(em Insert/Update a forma é `kind?: ...` — manter o `?`).

- [ ] **Step 0.10: Typecheck + suíte completa**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck limpo; testes ≥ 346 passing (342 + 4 novos).

- [ ] **Step 0.11: Lint + commit**

```bash
pnpm lint:fix
git add lib/netrin/parsers/related-companies.ts lib/netrin/parsers/related-companies.test.ts lib/netrin/graph-bridge.ts lib/netrin/graph-bridge.test.ts lib/supabase/types.ts
git commit -m "fix(graph): grava arestas CPF->empresa (chave empresasRelacionadasCPF) + sync tipos

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## FASE 1 — Bulk dispara enrichment (densificação em volume)

**Por quê:** o bulk (até 250 docs) hoje só alimenta o grafo de processos (Predictus). Não dispara Netrin → zero arestas corporativas/familiares no caminho de maior volume.

> ⚠️ **Custo:** cada item do bulk passa a disparar um job Netrin (5-11 slugs). 250 itens = até 250 jobs. `findOrCreateJob` reusa job ativo por `root_hash` e o cache Netrin (30d) evita refetch, mas o primeiro upload de N documentos novos gera N consultas pagas. Aceitável dado o objetivo de rede; manter no radar.

**Files:**
- Modify: `lib/bulk/item-processor.ts` (nova dep opcional `dispatchEnrichment`)
- Modify: `lib/bulk/item-processor.test.ts` (cobrir o dispatch)
- Modify: `supabase/functions/process-bulk-job/index.ts` (injetar `findOrCreateJob`)

---

- [ ] **Step 1.1: Escrever o teste do dispatch no item-processor (falhando)**

Em `lib/bulk/item-processor.test.ts`, adicionar um teste. Reusar o padrão de `deps` já existente no arquivo (copiar o objeto `deps` de um teste vizinho e acrescentar `dispatchEnrichment`):

```ts
  it('dispatches enrichment with the item ciphertext on cache miss', async () => {
    const dispatchEnrichment = vi.fn(async () => {});
    const item = {
      id: 'item-1',
      job_id: 'job-1',
      document_hash: 'h1',
      document_type: 'cpf',
      document_encrypted: 'CIPHER',
    } as never;

    await processBulkItem(item, {
      admin: {} as never,
      predictus: { searchByCpf: async () => [], searchByCnpj: async () => [] },
      audit: async () => {},
      getCachedResults: async () => null,
      setCachedResults: async () => {},
      decryptDocument: async () => '12345678909',
      userId: 'user-1',
      dispatchEnrichment,
    });

    expect(dispatchEnrichment).toHaveBeenCalledWith({
      userId: 'user-1',
      rootHash: 'h1',
      rootType: 'cpf',
      documentEncrypted: 'CIPHER',
    });
  });

  it('still dispatches enrichment on cache hit', async () => {
    const dispatchEnrichment = vi.fn(async () => {});
    const item = {
      id: 'item-2',
      job_id: 'job-1',
      document_hash: 'h2',
      document_type: 'cnpj',
      document_encrypted: 'CIPHER2',
    } as never;

    await processBulkItem(item, {
      admin: {} as never,
      predictus: { searchByCpf: async () => [], searchByCnpj: async () => [] },
      audit: async () => {},
      getCachedResults: async () => ({ results: [{} as never], fetchedAt: 'now' }),
      setCachedResults: async () => {},
      decryptDocument: async () => '12345678000190',
      userId: 'user-1',
      dispatchEnrichment,
    });

    expect(dispatchEnrichment).toHaveBeenCalledWith({
      userId: 'user-1',
      rootHash: 'h2',
      rootType: 'cnpj',
      documentEncrypted: 'CIPHER2',
    });
  });
```

Garantir que o `import` no topo do arquivo de teste inclui `vi` (`import { describe, expect, it, vi } from 'vitest';`).

- [ ] **Step 1.2: Rodar e confirmar falha**

Run: `pnpm test -- lib/bulk/item-processor`
Expected: FAIL — `dispatchEnrichment` não é chamado (dep inexistente).

- [ ] **Step 1.3: Implementar a dep e o dispatch**

Em `lib/bulk/item-processor.ts`:

1. No tipo `ItemProcessorDeps`, adicionar antes de `userId`:
```ts
  /**
   * Dispara o job de enrichment (Netrin) em paralelo, reusando o ciphertext já
   * armazenado em `bulk_job_items.document_encrypted` (cifrado via
   * predictus_cache_key — mesma chave que `findOrCreateJob` espera). Opcional:
   * quando ausente, o bulk segue só com Predictus (comportamento legado).
   */
  dispatchEnrichment?: (input: {
    userId: string;
    rootHash: string;
    rootType: 'cpf' | 'cnpj';
    documentEncrypted: string;
  }) => Promise<void>;
```

2. No início de `processBulkItem`, logo após a linha `): Promise<ItemOutcome> {`, disparar o enrichment best-effort (independente de cache hit/miss — as duas fontes nunca encadeiam):
```ts
  if (deps.dispatchEnrichment) {
    try {
      await deps.dispatchEnrichment({
        userId: deps.userId,
        rootHash: item.document_hash,
        rootType: item.document_type,
        documentEncrypted: item.document_encrypted,
      });
    } catch (e) {
      console.warn('bulk item enrichment dispatch failed:', e);
    }
  }
```

- [ ] **Step 1.4: Rodar e confirmar verde**

Run: `pnpm test -- lib/bulk/item-processor`
Expected: PASS (todos, incluindo os 2 novos).

- [ ] **Step 1.5: Injetar `findOrCreateJob` no Edge Function de bulk**

Em `supabase/functions/process-bulk-job/index.ts`:

1. Adicionar import (caminho relativo, como os demais imports de lib no Edge):
```ts
import { findOrCreateJob } from '../../../lib/netrin/job-store.ts';
```

2. Onde o `deps` de `processBulkItem` é montado (objeto passado a `processBulkItem`/`processBulkJob`), adicionar a propriedade:
```ts
        dispatchEnrichment: (input) =>
          findOrCreateJob(admin as never, input).then(() => undefined),
```
(usar a mesma variável `admin` service-role já existente no arquivo; se o nome local for outro, usar o nome real).

- [ ] **Step 1.6: Typecheck + suíte + commit**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck limpo; testes ≥ 348 passing.

```bash
pnpm lint:fix
git add lib/bulk/item-processor.ts lib/bulk/item-processor.test.ts supabase/functions/process-bulk-job/index.ts
git commit -m "feat(bulk): dispara enrichment Netrin por item (densifica o grafo em volume)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> Deploy do Edge Function (fora do TDD, quando for promover): `pnpm exec supabase functions deploy process-bulk-job`.

---

## FASE 2 — Flags de risco no nó (`is_pep` / `has_sanction`)

**Por quê:** PEP/sanções já são buscados e pagos, mas não viram atributo de nó. Sem flags de risco, o grafo é só um diagrama de conexões — não dá pra responder "esse nó é arriscado?".

**Files:**
- Create: `supabase/migrations/20260526140000_graph_node_risk_flags.sql`
- Create: `lib/netrin/parsers/risk-flags.ts`
- Create: `lib/netrin/parsers/risk-flags.test.ts`
- Modify: `lib/graph/types.ts` (campo `risk?` em `ExtractedNode`)
- Modify: `lib/graph/writer.ts` (propagar flags no `NodeIn`)
- Modify: `lib/graph/writer.test.ts` (assertar flags no payload do RPC)
- Modify: `lib/netrin/graph-bridge.ts` (anexar risco ao nó raiz)
- Modify: `lib/supabase/types.ts` (colunas novas em `graph_nodes`)
- Modify: `app/(app)/search/result/[hash]/page.tsx` (DRY: usar o parser compartilhado)

---

- [ ] **Step 2.1: Migration — colunas + RPC**

Create `supabase/migrations/20260526140000_graph_node_risk_flags.sql`:

```sql
-- ============================================================================
-- Risk flags no nó do grafo: is_pep / has_sanction (booleanas, em claro — sem
-- detalhe pessoal sensível). Preenchidas só pela fonte antifraude (Netrin).
-- upsert_graph passa a aceitar flags opcionais por nó com semântica "só sobe"
-- (OR): uma escrita Predictus (sem flags) nunca rebaixa um nó já marcado.
-- ============================================================================

alter table public.graph_nodes
  add column if not exists is_pep boolean not null default false,
  add column if not exists has_sanction boolean not null default false,
  add column if not exists risk_updated_at timestamptz;

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
        is_pep, has_sanction,
        risk_updated_at
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

  -- Edges (idêntico à versão 20260526130000)
  if jsonb_typeof(edges_in) = 'array' then
    for e in select * from jsonb_array_elements(edges_in) loop
      k := e->>'kind';
      if k in ('corporate_relation', 'family_relation') then
        jsonb_evidence := coalesce(e->'evidence', '{}'::jsonb);
        insert into public.graph_edges (source_hash, target_hash, kind, evidence)
        values (e->>'source_hash', e->>'target_hash', k, jsonb_evidence)
        on conflict (source_hash, target_hash, kind) do update
          set evidence = excluded.evidence, last_seen_at = now();
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
          e->>'source_hash', e->>'target_hash', k,
          jsonb_build_object('processNumbers', process_numbers, 'samePolo', same_polo_val, 'occurrences', occurrences)
        )
        on conflict (source_hash, target_hash, kind) do update
          set evidence = jsonb_build_object('processNumbers', process_numbers, 'samePolo', same_polo_val, 'occurrences', occurrences),
              last_seen_at = now();
      end if;
    end loop;
  end if;
end;
$$;

revoke all on function public.upsert_graph(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_graph(jsonb, jsonb) to service_role;
```

- [ ] **Step 2.2: Aplicar a migration localmente**

Run: `pnpm exec supabase db reset`
Expected: todas as migrations aplicam sem erro; a última é `20260526140000_graph_node_risk_flags`.

- [ ] **Step 2.3: Escrever o teste do parser de risco (falhando)**

Create `lib/netrin/parsers/risk-flags.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { extractCnpjRisk, extractCpfRisk } from './risk-flags';

describe('extractCpfRisk', () => {
  it('flags PEP atual e sanção (atual ou pregressa)', () => {
    expect(extractCpfRisk({ pepKyc: { currentlyPEP: 'Sim', currentlySanctioned: false } } as never)).toEqual({
      isPep: true,
      hasSanction: false,
    });
    expect(extractCpfRisk({ pepKyc: { currentlyPEP: false, previouslySanctioned: 'S' } } as never)).toEqual({
      isPep: false,
      hasSanction: true,
    });
  });

  it('retorna tudo false quando slug ausente', () => {
    expect(extractCpfRisk({})).toEqual({ isPep: false, hasSanction: false });
  });
});

describe('extractCnpjRisk', () => {
  it('flags sanção por pep-kyc-cnpj, CEIS/CNEP ativos ou trabalho escravo', () => {
    expect(extractCnpjRisk({ 'pep-kyc-cnpj': { sancionado: 'S' } } as never)).toEqual({
      isPep: false,
      hasSanction: true,
    });
    expect(
      extractCnpjRisk({ 'portal-transparencia-ceis': { sancoes: [{ ativo: true }] } } as never),
    ).toEqual({ isPep: false, hasSanction: true });
    expect(extractCnpjRisk({ 'trabalho-escravo': { empregador: [{}] } } as never)).toEqual({
      isPep: false,
      hasSanction: true,
    });
  });

  it('CEIS inativo não conta', () => {
    expect(
      extractCnpjRisk({ 'portal-transparencia-ceis': { sancoes: [{ ativo: false }] } } as never),
    ).toEqual({ isPep: false, hasSanction: false });
  });
});
```

- [ ] **Step 2.4: Rodar e confirmar falha**

Run: `pnpm test -- lib/netrin/parsers/risk-flags`
Expected: FAIL — import não resolve.

- [ ] **Step 2.5: Implementar o parser (lógica extraída de page.tsx — DRY)**

Create `lib/netrin/parsers/risk-flags.ts`:

```ts
// lib/netrin/parsers/risk-flags.ts
import type { NetrinCompositePayload } from '@/lib/netrin/types.ts';

export type RiskFlags = { isPep: boolean; hasSanction: boolean };

function isSim(v: unknown): boolean {
  return v === true || v === 'Sim' || v === 'SIM' || v === 'S';
}

export function extractCpfRisk(payload: NetrinCompositePayload): RiskFlags {
  const slug = (payload as Record<string, unknown>).pepKyc as
    | { currentlyPEP?: unknown; currentlySanctioned?: unknown; previouslySanctioned?: unknown }
    | null
    | undefined;
  return {
    isPep: isSim(slug?.currentlyPEP),
    hasSanction: isSim(slug?.currentlySanctioned) || isSim(slug?.previouslySanctioned),
  };
}

export function extractCnpjRisk(payload: NetrinCompositePayload): RiskFlags {
  const p = payload as Record<string, unknown>;
  const pep = p['pep-kyc-cnpj'] as { sancionado?: unknown } | null | undefined;
  const ceis = p['portal-transparencia-ceis'] as { sancoes?: Array<{ ativo?: unknown }> } | null | undefined;
  const cnep = p['portal-transparencia-cnep'] as { sancoes?: Array<{ ativo?: unknown }> } | null | undefined;
  const trab = p['trabalho-escravo'] as { empregador?: unknown[] } | null | undefined;

  const ceisAtivo = (ceis?.sancoes ?? []).some((c) => c?.ativo === true);
  const cnepAtivo = (cnep?.sancoes ?? []).some((c) => c?.ativo === true);
  const trabEscravo = Array.isArray(trab?.empregador) && trab.empregador.length > 0;

  return {
    isPep: false, // pep-kyc-cnpj não expõe PEP de PJ; só sanção
    hasSanction: isSim(pep?.sancionado) || ceisAtivo || cnepAtivo || trabEscravo,
  };
}
```

- [ ] **Step 2.6: Rodar e confirmar verde**

Run: `pnpm test -- lib/netrin/parsers/risk-flags`
Expected: PASS.

- [ ] **Step 2.7: Adicionar `risk` ao `ExtractedNode`**

Em `lib/graph/types.ts`, no tipo `ExtractedNode`, adicionar o campo opcional:
```ts
export type ExtractedNode = {
  nodeHash: string;
  nodeType: NodeType;
  label: GraphNodeLabel;
  maskedPreview: string;
  risk?: { isPep: boolean; hasSanction: boolean };
};
```

- [ ] **Step 2.8: Teste do writer propagando flags (falhando)**

Em `lib/graph/writer.test.ts`, adicionar um caso. Reusar o mock de `client.rpc` já presente no arquivo (inspecionar o teste existente para o nome da spy). Asserção-alvo:

```ts
  it('passa is_pep/has_sanction no nodes_in quando o nó tem risk', async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    const client = {
      rpc,
      // encrypt_graph_label retorna hex; reusar o stub do arquivo se existir.
    } as never;

    await upsertGraph(
      client,
      [
        {
          nodeHash: 'h1',
          nodeType: 'cpf',
          label: { document: '123' },
          maskedPreview: 'm',
          risk: { isPep: true, hasSanction: false },
        },
      ],
      [],
    );

    const arg = rpc.mock.calls[0]?.[1] as { nodes_in: Array<Record<string, unknown>> };
    expect(arg.nodes_in[0]).toMatchObject({ is_pep: true, has_sanction: false });
  });
```
> Nota: se `writer.test.ts` já mocka `encryptLabel`/`client.rpc` de um jeito específico, copiar esse setup do teste vizinho em vez do stub acima.

- [ ] **Step 2.9: Rodar e confirmar falha**

Run: `pnpm test -- lib/graph/writer`
Expected: FAIL — `nodes_in[0]` não tem `is_pep`.

- [ ] **Step 2.10: Propagar as flags no writer**

Em `lib/graph/writer.ts`:

1. No tipo `NodeIn`, adicionar:
```ts
type NodeIn = {
  node_hash: string;
  node_type: string;
  encrypted_label_b64: string;
  masked_preview: string;
  is_pep?: boolean;
  has_sanction?: boolean;
};
```

2. Dentro de `encryptNodesBatched`, no objeto retornado por `batch.map`, acrescentar (só quando `node.risk` existe, para preservar a semântica "campo ausente = não mexe"):
```ts
        return {
          node_hash: node.nodeHash,
          node_type: node.nodeType,
          encrypted_label_b64: hexCiphertextToBase64(hexCipher),
          masked_preview: node.maskedPreview,
          ...(node.risk
            ? { is_pep: node.risk.isPep, has_sanction: node.risk.hasSanction }
            : {}),
        };
```

- [ ] **Step 2.11: Rodar e confirmar verde**

Run: `pnpm test -- lib/graph/writer`
Expected: PASS.

- [ ] **Step 2.12: Anexar risco ao nó raiz no bridge (falhando primeiro)**

Em `lib/netrin/graph-bridge.test.ts`, adicionar:
```ts
  it('marca risco no nó raiz CPF a partir de pepKyc', () => {
    const result = buildNetrinGraph({
      rootDocument: { type: 'cpf', raw: '12345678909', name: 'JOAO' },
      cpfPayload: { pepKyc: { currentlyPEP: 'Sim' } } as never,
      cnpjPayloads: {},
    });
    const root = result.nodes.find((n) => n.label.document === '12345678909');
    expect(root?.risk).toEqual({ isPep: true, hasSanction: false });
  });
```

Run: `pnpm test -- lib/netrin/graph-bridge` → Expected: FAIL (`root?.risk` é undefined).

- [ ] **Step 2.13: Implementar o anexo de risco no bridge**

Em `lib/netrin/graph-bridge.ts`:

1. Import:
```ts
import { extractCnpjRisk, extractCpfRisk } from './parsers/risk-flags.ts';
```

2. No bloco `// Root node`, substituir a criação do nó raiz para anexar o `risk`:
```ts
  // Root node
  if (input.rootDocument.type === 'cpf' && input.rootDocument.raw.length === 11) {
    const node = makeCpfNode(input.rootDocument.raw, input.rootDocument.name);
    if (input.cpfPayload) node.risk = extractCpfRisk(input.cpfPayload);
    nodeMap.set(node.nodeHash, node);
  } else if (input.rootDocument.type === 'cnpj' && input.rootDocument.raw.length === 14) {
    const node = makeCnpjNode(input.rootDocument.raw, input.rootDocument.name);
    const rootPayload = input.cnpjPayloads?.[input.rootDocument.raw];
    if (rootPayload) node.risk = extractCnpjRisk(rootPayload);
    nodeMap.set(node.nodeHash, node);
  }
```

Run: `pnpm test -- lib/netrin/graph-bridge` → Expected: PASS.

- [ ] **Step 2.14: Sincronizar `lib/supabase/types.ts` (graph_nodes)**

Em `graph_nodes` Row, adicionar após `masked_preview: string;`:
```ts
          is_pep: boolean;
          has_sanction: boolean;
          risk_updated_at: string | null;
```
Em Insert e Update, adicionar (opcionais):
```ts
          is_pep?: boolean;
          has_sanction?: boolean;
          risk_updated_at?: string | null;
```

- [ ] **Step 2.15: DRY — page.tsx usa o parser compartilhado**

Em `app/(app)/search/result/[hash]/page.tsx`:

1. Import:
```ts
import { extractCnpjRisk, extractCpfRisk } from '@/lib/netrin/parsers/risk-flags';
```

2. Substituir o array `cpfRisk` (linhas ~481-487) por:
```ts
  const cpfRiskFlags = hop1 ? extractCpfRisk(hop1) : { isPep: false, hasSanction: false };
  const cpfRisk = [
    { label: 'PEP', active: cpfRiskFlags.isPep },
    { label: 'Sanções', active: cpfRiskFlags.hasSanction },
  ];
```
3. Substituir `cnpjRisk` por:
```ts
  const cnpjRiskFlags = cnpjRootPayload
    ? extractCnpjRisk(cnpjRootPayload)
    : { isPep: false, hasSanction: false };
  const cnpjRisk = [{ label: 'Sanções', active: cnpjRiskFlags.hasSanction }];
```
> `extractPepFromHop1`/`extractCnpjSancoes` continuam para os cards (contagens/detalhes); só a derivação das flags de topo migra para o parser. Não remover as funções existentes.

- [ ] **Step 2.16: Typecheck + suíte + commit**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck limpo; testes ≥ 354 passing.

```bash
pnpm lint:fix
git add supabase/migrations/20260526140000_graph_node_risk_flags.sql lib/netrin/parsers/risk-flags.ts lib/netrin/parsers/risk-flags.test.ts lib/graph/types.ts lib/graph/writer.ts lib/graph/writer.test.ts lib/netrin/graph-bridge.ts lib/netrin/graph-bridge.test.ts lib/supabase/types.ts "app/(app)/search/result/[hash]/page.tsx"
git commit -m "feat(graph): flags de risco no nó (is_pep/has_sanction) a partir do antifraude

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> Deploy (ao promover): aplicar a migration (`pnpm exec supabase db push`) e redeploy de `process-enrichment-job` (que importa o bridge): `pnpm exec supabase functions deploy process-enrichment-job`.

---

## FASE 3 — `findPathBetween(hashA, hashB)` no grafo todo

**Por quê:** hoje a leitura é ego 1-hop. A pergunta-ouro do antifraude — "esse documento está a N saltos de um nó arriscado?" — não é respondível. Esta fase adiciona uma Server Action que acha o caminho mais curto entre dois documentos no grafo persistido inteiro, reusando o `findShortestPath` puro (já testado).

**Files:**
- Create: `lib/graph/path-result.ts`
- Create: `lib/graph/path-result.test.ts`
- Modify: `app/(app)/network/[hash]/actions.ts` (nova action `findPathBetween`)

> A travessia carrega todas as arestas do grafo (append-only, escala MVP) e roda BFS em memória. Sem paginação/otimização agora (sem gargalo demonstrado); adicionar bound só se a tabela crescer.

---

- [ ] **Step 3.1: Teste do mapeador de resultado de caminho (falhando)**

Create `lib/graph/path-result.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPathResult } from './path-result';

describe('buildPathResult', () => {
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'c', target: 'd' },
  ];

  it('retorna a sequência de hashes do caminho mais curto', () => {
    expect(buildPathResult(edges, 'a', 'c')).toEqual({ found: true, nodes: ['a', 'b', 'c'], hops: 2 });
  });

  it('found=false quando não há caminho', () => {
    expect(buildPathResult([{ source: 'a', target: 'b' }], 'a', 'z')).toEqual({
      found: false,
      nodes: [],
      hops: 0,
    });
  });

  it('caminho trivial quando origem == destino', () => {
    expect(buildPathResult(edges, 'a', 'a')).toEqual({ found: true, nodes: ['a'], hops: 0 });
  });
});
```

- [ ] **Step 3.2: Rodar e confirmar falha**

Run: `pnpm test -- lib/graph/path-result`
Expected: FAIL — import não resolve.

- [ ] **Step 3.3: Implementar o mapeador (wrapper puro sobre findShortestPath)**

Create `lib/graph/path-result.ts`:

```ts
// lib/graph/path-result.ts
import { findShortestPath } from './path.ts';

export type PathResult = { found: boolean; nodes: string[]; hops: number };

type EdgeLike = { source: string; target: string };

/**
 * Encontra o caminho mais curto entre dois hashes sobre uma lista de arestas
 * não-direcionada e o reduz a um DTO simples (sequência de hashes + nº de
 * saltos). Wrapper puro sobre `findShortestPath` para ser testável sem DB.
 */
export function buildPathResult(edges: EdgeLike[], source: string, target: string): PathResult {
  const path = findShortestPath(edges, source, target);
  if (!path) return { found: false, nodes: [], hops: 0 };
  return { found: true, nodes: path.nodes, hops: path.nodes.length - 1 };
}
```

- [ ] **Step 3.4: Rodar e confirmar verde**

Run: `pnpm test -- lib/graph/path-result`
Expected: PASS.

- [ ] **Step 3.5: Adicionar a Server Action `findPathBetween`**

Em `app/(app)/network/[hash]/actions.ts`, adicionar ao final do arquivo (e o import no topo):

No topo, junto dos imports de lib:
```ts
import { buildPathResult } from '@/lib/graph/path-result';
```

Ao final:
```ts
export type PathBetweenDto = {
  found: boolean;
  nodes: GraphNodeDto[];
  hops: number;
};

const PATH_EDGE_PAGE = 1000;

async function fetchAllEdges(
  supabase: ServerClient,
): Promise<Array<{ source: string; target: string }>> {
  const all: Array<{ source: string; target: string }> = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('graph_edges')
      .select('source_hash, target_hash')
      .range(from, from + PATH_EDGE_PAGE - 1)
      .returns<Array<{ source_hash: string; target_hash: string }>>();
    if (error) throw new Error(`fetchAllEdges failed: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) all.push({ source: r.source_hash, target: r.target_hash });
    if (rows.length < PATH_EDGE_PAGE) break;
    from += PATH_EDGE_PAGE;
  }
  return all;
}

export async function findPathBetween(
  hashA: string,
  hashB: string,
): Promise<PathBetweenDto> {
  await requirePermission('search_network');
  const admin = createAdminClient();
  const supabase = await createClient();

  const edges = await fetchAllEdges(supabase);
  const path = buildPathResult(edges, hashA, hashB);
  if (!path.found) return { found: false, nodes: [], hops: 0 };

  const rows = await fetchNodesInChunks(supabase, path.nodes);
  const byHash = new Map(rows.map((r) => [r.node_hash, r] as const));
  const nowIso = new Date().toISOString();
  const cacheHashes = await fetchFreshCacheHashes(supabase, path.nodes, nowIso);

  // Preserva a ordem do caminho; ignora hashes sem nó (não deveria ocorrer).
  const ordered = path.nodes
    .map((h) => byHash.get(h))
    .filter((r): r is NodeRow => r !== undefined);
  const nodes = await rowsToDtosBatched(admin, ordered, cacheHashes);

  return { found: true, nodes, hops: path.hops };
}
```

> Reusa `requirePermission`, `createAdminClient`, `createClient`, `fetchNodesInChunks`, `fetchFreshCacheHashes`, `rowsToDtosBatched`, `NodeRow` e `GraphNodeDto` já definidos no arquivo. UI (botão "traçar caminho") fica como follow-up — esta fase entrega a action testada pelo helper puro.

- [ ] **Step 3.6: Typecheck + suíte + commit**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck limpo; testes ≥ 357 passing.

```bash
pnpm lint:fix
git add lib/graph/path-result.ts lib/graph/path-result.test.ts "app/(app)/network/[hash]/actions.ts"
git commit -m "feat(graph): findPathBetween — caminho mais curto entre dois documentos no grafo

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-review (cobertura × spec)

- **Bug CPF→empresa** → Fase 0 (parser + bridge + fixture corrigida). ✓
- **types.ts dessincronizado** → Fase 0 (edges) + Fase 2 (nodes). ✓
- **Bulk não enriquece** → Fase 1. ✓
- **Risco no nó (flags em claro)** → Fase 2 (migration + parser + writer + bridge + types + DRY na page). ✓
- **Travessia A↔B no grafo todo** → Fase 3. ✓
- **QSA / informacoes-socios-pj** → explicitamente fora de escopo (sem shape conhecida; exige captura de payload real). Documentado no Contexto.

Consistência de tipos verificada: `ExtractedNode.risk` (2.7) → `NodeIn.is_pep/has_sanction` (2.10) → colunas SQL `is_pep/has_sanction` (2.1) → `extractCpfRisk/extractCnpjRisk` retornam `{isPep, hasSanction}` (2.5) usados em 2.13/2.15. `buildPathResult` (3.3) usado em `findPathBetween` (3.5). Nomes batem.

---

## Riscos & notas de execução

1. **`db reset` é destrutivo** (apaga dados locais). Só rodar em ambiente local. Em prod a migration vai por `supabase db push`.
2. **Custo Netrin no bulk** (Fase 1) — ver aviso na fase. Se for preocupante, gatear por flag/permissão antes de promover.
3. **Deploys de Edge Function** não são cobertos por testes — após Fase 1 redeploy `process-bulk-job`; após Fase 2 redeploy `process-enrichment-job`.
4. **`findPathBetween` carrega todas as arestas** por chamada — aceitável no MVP; revisitar se `graph_edges` crescer muito.
5. Cada fase é independente: dá para parar, mergear e retomar entre fases.
