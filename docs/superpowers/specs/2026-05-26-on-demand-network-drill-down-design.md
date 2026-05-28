# Drill-down sob demanda na rede societária

**Status:** Spec proposta
**Data:** 2026-05-26
**Autor:** Andre Ganske + Claude
**Iniciativa pai:** [Enriquecimento Antifraude via Netrin](2026-05-26-netrin-antifraude-design.md)

## Resumo

Hoje, toda busca por CPF dispara em cascata Hop1 (CPF root) + Hop2 (todos os CNPJs relacionados) + Hop3 (todos os CPFs sócios desses CNPJs). Toda busca por CNPJ dispara Hop2 (root) + Hop3 (sócios). Isso pode gerar 30+ chamadas Netrin com um único clique do operador, custando dinheiro e tempo mesmo quando o operador só quer ver o resultado raiz.

Esta refatoração reorganiza o fluxo em torno de **dois tipos de busca canônicos** — CPF e CNPJ — onde cada um faz **uma única** chamada Netrin (mais a Predictus correspondente). A exploração da rede societária vira **navegação explícita**: o operador clica "Aprofundar" num pivô (CPF sócio ou CNPJ relacionado) para disparar uma nova busca daquele documento.

A recursão é simétrica e ilimitada: CPF → CNPJ → CPF → CNPJ → …, e o grafo (`graph_nodes` / `graph_edges`) cresce organicamente a cada drill-down.

## Motivação

- **Custo Netrin desproporcional ao valor entregue.** Cascata atual dispara dezenas de slugs antes do operador saber se vai sequer olhar para os relacionados. Caro e lento.
- **UX confusa.** Status "Em andamento" com `0/24 empresas` enquanto o operador só queria ver os dados básicos do CPF é ruído. A profundidade da pesquisa deveria ser uma decisão consciente.
- **Hop3 ≈ Hop1.** Os dois operam sobre CPFs com slugs majoritariamente sobrepostos; manter conceitos separados ("hop") é dívida conceitual. Unificar simplifica modelo mental e código.
- **Sem teto natural.** A rede societária pode ter centenas de nós; cascata automática não escala. Drill-down explícito sim.

## Decisões tomadas no brainstorming

| Tópico | Decisão |
|---|---|
| Tipos de busca | Apenas **CPF** e **CNPJ**. "Hop" deixa de ser um conceito. |
| Slugs CPF | `pep-kyc-cpf`, `empresas-relacionadas-cpf`, `receita-federal-cpf-data-nascimento`, `midias-consolidado` (4 slugs — atuais do HOP1) |
| Slugs CNPJ | Mantém os 11 atuais do HOP2 |
| Processos | Continuam vindo da Predictus (sem `esp-cpf`/`processos-cpf`/`processos-cnpj` da Netrin) |
| Aprofundar | Cria nova entrada em `searches` + `audit_log` + `enrichment_job` (idem busca raiz). Navega para `/search/result/<hash-novo>` |
| Navegação | Breadcrumbs por query param: `?path=<h1>,<h2>,...` |
| Página CNPJ | Nova suite de cards CNPJ-cêntricos no escopo deste refactor |
| Job model | Permanece (`enrichment_jobs` + `enrichment_job_calls`), com 1 call por job |
| Cache | Sem mudança (continua compartilhado, encriptado, 30d) |
| Grafo | Sem mudança no schema; cada busca contribui suas arestas via `upsertGraph` (append-only) |

## Modelo conceitual

```
┌──────────────────────────────────────────────────────────────────┐
│  Pesquisa de CPF                                                  │
│   ├─ Predictus searchPerson  (processos)                          │
│   └─ Netrin consulta-composta (4 slugs CPF)                       │
│        └─ extrai pivôs CNPJ via empresasRelacionadasCPF           │
│                                                                    │
│  ▼ operador clica "Aprofundar" num CNPJ relacionado               │
│                                                                    │
│  Pesquisa de CNPJ                                                 │
│   ├─ Predictus searchByCnpj  (processos)                          │
│   └─ Netrin consulta-composta (11 slugs CNPJ)                     │
│        └─ extrai pivôs CPF via pessoasRelacionadasCnpj            │
│                                                                    │
│  ▼ operador clica "Aprofundar" num CPF sócio                      │
│                                                                    │
│  Pesquisa de CPF  ... ad infinitum                                │
└──────────────────────────────────────────────────────────────────┘
```

Cada nível na trilha é uma busca completa, com seu próprio `searches` row, audit, cache e enrichment job. Cache hits são instantâneos; cache misses disparam novas chamadas externas.

## Arquitetura

### Renames e deleções em `lib/netrin/`

```
lib/netrin/
  types.ts
    HOP1_SLUGS  →  CPF_SLUGS   (mesmo conteúdo)
    HOP2_SLUGS  →  CNPJ_SLUGS  (mesmo conteúdo)
    HOP3_SLUGS  →  DELETED
    NetrinSlug  →  union de CPF_SLUGS | CNPJ_SLUGS
  hops/
    hop1.ts     →  cpf-search.ts        (mantém shape de saída)
    hop2.ts     →  cnpj-search.ts       (mantém shape de saída)
    hop3.ts     →  DELETED
    *.test.ts   →  renomeiam junto
  parsers/
    pivot-cnpjs.ts  →  mantém (usado pela página + graph-bridge)
    pivot-cpfs.ts   →  mantém (idem)
  processor.ts
    → simplifica: 1 job = 1 chamada Netrin
    → sem loop de pivôs, sem cascata, sem hop2_total/hop3_total
  graph-bridge.ts
    → segue gerando arestas corporate_relation a partir do payload retornado;
      cada job contribui o que seu doc-type permite
  result-loader.ts
    → estende: além de decifrar caches do job atual, decifra também
      caches de quaisquer pivôs CNPJ extraídos do payload raiz (para
      preencher inline RelatedCompanies quando o operador já tiver
      drill-downado aquele CNPJ em sessão anterior)
```

### Server Actions

```
app/(app)/search/
  person/actions.ts
    → permanece. Trigger Edge funciona porque processor agora só roda CPF_SLUGS.
  company/actions.ts
    → permanece. Trigger Edge funciona porque processor agora só roda CNPJ_SLUGS.
  deepen/actions.ts     (NOVA)
    → action deepenDocument({ docType, cnpjRaw?, cpfHash?, parentCnpjHash?, currentPath })
      - resolve raw plaintext server-side (ver "Resolução de plaintext")
      - chama helper compartilhado (extraído de searchPerson / searchByCnpj):
        runCpfSearch(rawCpf, { source: 'deepen' }) ou
        runCnpjSearch(rawCnpj, { source: 'deepen' })
      - helper retorna { documentHash } sem redirect
      - deepenDocument concatena currentPath + novoHash → redirect para
        `/search/result/<novoHash>?path=<encodedPath>`

  Refactor obrigatório: extrair de `searchPerson`/`searchByCnpj` um helper puro
  `lib/predictus/run-search.ts` (ou similar) que faça todo o trabalho (auth,
  audit, cache, predictus call, enrichment job) e retorne o hash. As Server
  Actions existentes passam a ser wrappers finos sobre o helper + redirect.
```

### Resolução de plaintext em drill-downs

CNPJ não é dado pessoal (LGPD); pode trafegar plaintext no body do form. CPF é. Solução server-side:

- **Drill-down CNPJ**: form submete `cnpj` raw (já visível no payload Hop1 do CPF raiz). Server action recebe e processa.
- **Drill-down CPF (sócio)**: form submete `cpfHash` + `parentCnpjHash`. Server action carrega o cache Netrin do parent CNPJ (`pessoas-relacionadas-cnpj.entidadesRelacionadas[].cpf` traz plaintext), encontra o CPF cujo hash bate, dispara `runCpfSearch(rawCpf)`. Se o parent cache não existir mais (TTL 30d expirou) ou o CPF não bater nenhum hash, retorna erro user-facing "Não foi possível resolver o sócio — refaça a consulta da empresa".

Isso preserva o invariante "plaintext CPF nunca cruza para o cliente".

### Breadcrumb e tamanho de URL

Hashes são SHA-256 hex (64 chars). Um path de 5 níveis ocupa ~320 chars no query string — abaixo dos limites práticos de URL (~2KB). Sem encoding especial (`?path=h1,h2,h3,h4` simples). Se o operador ultrapassar 10 níveis, o componente `BreadcrumbNetwork` mostra "… ▸ último-3" para não estourar a UI; o path inteiro continua no URL.

### Componentes UI

```
components/antifraude/
  identity-card.tsx          → mantém (CPF)
  pep-card.tsx               → mantém (CPF)
  media-card.tsx             → mantém (compartilhado CPF/CNPJ — só lê midiasConsolidado)
  related-companies.tsx      → estende:
                                 - botão "Aprofundar" por linha quando cache MISS
                                 - botão "Ver detalhes" quando cache HIT
                                 - row expandida mostra sócios CPF com botão drill-down
  identity-card-cnpj.tsx     → NOVA: razão social, situação, capital social, atividade, abertura
  sancoes-card-cnpj.tsx      → NOVA: consolidação pep-kyc-cnpj.sancionado + CEIS + CNEP + trabalho-escravo
  socios-card.tsx            → NOVA: lista de sócios com botão "Aprofundar" por CPF
  enrichment-realtime.tsx    → mantém

components/breadcrumb-network.tsx  → NOVO
  Lê ?path do URL → busca term_preview de cada hash via lib/searches ou similar
  → renderiza trilha "CPF José ▸ CNPJ ACME ▸ CPF Maria"
```

### Página `/search/result/[hash]`

- Lê `searchRow.search_type` (já existe).
- Se `'cpf'` → renderiza grupo CPF (IdentityCard + PepCard + MediaCard + RelatedCompanies).
- Se `'cnpj'` → renderiza grupo CNPJ (IdentityCardCnpj + SancoesCardCnpj + MediaCard + SociosCard).
- `BreadcrumbNetwork` no header em ambos os casos quando `?path=` presente.

### Schema

Sem migration. Os campos `enrichment_jobs.hop2_total/done` e `enrichment_jobs.hop3_total/done` ficam sempre `0` — documenta-se como deprecated num comentário SQL via migration futura `_deprecate_hop_counters.sql`, removível depois quando nenhum código os ler.

Campo `enrichment_job_calls.hop` passa a aceitar só `1` (=CPF) ou `2` (=CNPJ). Sem CHECK constraint nova (o atual `hop in (1,2,3)` continua válido); novos jobs simplesmente nunca emitem `hop=3`.

## Mudanças por arquivo (resumo)

| Arquivo | Tipo |
|---|---|
| `lib/netrin/types.ts` | rename const + deleta HOP3_SLUGS |
| `lib/netrin/hops/cpf-search.ts` (era hop1.ts) | rename + ajusta slug set |
| `lib/netrin/hops/cnpj-search.ts` (era hop2.ts) | rename |
| `lib/netrin/hops/hop3.ts` | delete |
| `lib/netrin/hops/*.test.ts` | rename junto |
| `lib/netrin/processor.ts` | simplifica: 1 job = 1 call, sem loops |
| `lib/netrin/processor.test.ts` | reescreve cenários |
| `lib/netrin/result-loader.ts` | adiciona "look-up de caches pivôs além do job atual" |
| `lib/netrin/result-loader.test.ts` | novos cenários |
| `supabase/functions/process-enrichment-job/index.ts` | injeta só `runCpfSearch` ou `runCnpjSearch` |
| `app/(app)/search/result/[hash]/page.tsx` | branch CPF vs CNPJ, breadcrumb |
| `app/(app)/search/deepen/actions.ts` | NOVO |
| `components/antifraude/related-companies.tsx` | estende com botões |
| `components/antifraude/identity-card-cnpj.tsx` | NOVO |
| `components/antifraude/sancoes-card-cnpj.tsx` | NOVO |
| `components/antifraude/socios-card.tsx` | NOVO |
| `components/breadcrumb-network.tsx` | NOVO |

## Coisas que não mudam

- Schema do banco (sem nova migration; campos deprecated comentados, removíveis em ticket futuro).
- RLS, retention (30d para netrin_cache / enrichment_jobs), Vault keys, encriptação.
- Audit log writer (`lib/audit.ts`).
- Bulk processing — bulk continua chamando `searchPerson`/`searchByCnpj`, que agora rodam só seu próprio slug-set Netrin (mais rápido por item).
- Permissões (`search_person` / `search_company` continuam gateando as actions).
- `upsert_graph` RPC (continua append-only; cada drill-down contribui).
- Realtime channel `enrichment:<jobId>` (continua útil pra mostrar "Carregando…" durante a única call Netrin).

## Trade-offs aceitos

- **Operador faz mais cliques** para ver a rede completa. Aceitável: explicitude > automação cega.
- **Page renders incompleta no início**: RelatedCompanies aparece com linhas sem detalhes hop2 (até o operador aprofundar ou voltar pra uma sessão antiga). UX clara: "X empresas, clique para aprofundar".
- **Custo de drill-down recorrente**: se o operador navegar a mesma rede em duas sessões, cache hit (30d) torna a segunda navegação grátis na Netrin. Aceitável.
- **Schema com campos deprecated** (`hop2_total/done`, `hop3_total/done`) por algumas semanas até cleanup. Aceitável (são `int default 0`).

## Out of scope (próximos tickets)

- Migration de cleanup removendo `hop2_total`, `hop2_done`, `hop3_total`, `hop3_done`.
- Renomear `enrichment_job_calls.hop` para algo mais semântico (`document_type` já carrega a info).
- "Refresh" forçado: hoje cache hit é sempre reutilizado; um botão "Atualizar" que ignora cache pode ser útil depois.
- Indicador visual no grafo para mostrar quais nós já foram "aprofundados" pelo operador atual vs nós que só apareceram como pivôs.

## Plano de teste (alto nível, detalhado no impl plan)

- Vitest cobre `processor.ts` reescrito (cenários: CPF root sucesso, CPF root erro, CNPJ root sucesso, CNPJ root erro).
- Vitest cobre `result-loader.ts` extensão (cache lookup expandido para pivôs).
- Vitest cobre `deepen/actions.ts` (resolução de plaintext via parent cache, redirecionamento com breadcrumb).
- Smoke manual: busca CPF → vê 4 slugs no Netrin call → aprofundar CNPJ → nova URL com path → aprofundar CPF sócio → nova URL com path de 3 níveis → grafo agora tem nós dos 3 docs.
- Verificar que `pnpm typecheck` e `pnpm test` continuam verdes (270+ testes).
