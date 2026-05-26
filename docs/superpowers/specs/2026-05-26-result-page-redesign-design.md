# Reestruturação da tela de resultado — `/search/result/[hash]`

**Data:** 2026-05-26
**Rota:** `app/(app)/search/result/[hash]/page.tsx`
**Tipo:** Reestruturação visual + de informação (sem mudança de backend/Netrin/Predictus)

---

## Contexto e problema

A tela de resultado hoje trata a **identidade da pessoa como um card pequeno entre iguais** (`IdentityCard` ao lado de `PepCard`, `MediaCard`, `RelatedCompanies`) e esconde a **visão de rede atrás de um botão** ("Ver rede") no header do card de processos. Os dados são reduzidos a contagens — não há como ver tudo o que a fonte traz. Há ainda ruído de metadados ("Consulta arquivada", "Em cache", "Pesquisada em…") e uma **violação de copy**: o título "Resultados Predictus" expõe nome de fornecedor ao operador, contra a regra do `CLAUDE.md`.

Uma feature nova (uncommitada) adiciona **vínculos familiares** (`RelatedPeople` + slug `pessoas-relacionadas-cpf` + edge kind `family_relation`). Ela é central para "foco na identidade" e enriquece a rede.

## Objetivos

1. **Identidade como herói** — pessoa (CPF) ou empresa (CNPJ) no topo, com veredito de risco "de relance" e núcleo familiar próximo.
2. **Rede sempre presente** — trilho lateral sticky com preview estático + stats discriminadas por tipo de vínculo.
3. **Toda informação acessível** — collapses "resumo + ver tudo" para chegar aos campos crus sob demanda.
4. **Menos ruído** — remover badges de cache/arquivo/timestamp e nome de fornecedor.
5. **Integrar `RelatedPeople`** como cidadão de primeira classe (hero + collapse + rede).

## Não-objetivos

- Nenhuma mudança em Netrin/Predictus, Edge Functions, schema (exceto a migration `family_relation` que **já existe** uncommitada e será aplicada como parte da feature de família, não deste redesign).
- Não reescrever a página `/network/[hash]` (o grafo completo continua lá). Só consumimos stats dela.
- Não polir o root CNPJ de forma separada — layout é unificado; CNPJ herda a mesma estrutura com as seções equivalentes.

---

## Decisões (confirmadas com o usuário)

| Tema | Decisão |
|------|---------|
| Entregável | Plano escrito primeiro → aprovação → implementação nos componentes React reais. |
| Visão de rede | Painel lateral **sticky**, **preview estático + stats** (sem ReactFlow embutido). |
| Escopo | **Layout unificado** CPF (pessoa) e CNPJ (empresa). |
| Collapses | **Resumo + "ver tudo"** (cabeçalho com veredito; corpo revela campos crus). |
| Família no hero | **Mini-núcleo familiar** (chips clicáveis 1º grau) no hero + lista completa no collapse. |
| Remover | Badge "Em cache"; "Consulta arquivada" + timestamp; badge proeminente de status do job (→ spinner discreto). |
| Manter | Breadcrumb de drill-down (`BreadcrumbNetwork`). |
| Copy | Renomear "Resultados Predictus" → **"Processos judiciais"** (neutro). |
| Estética | Dentro dos tokens shadcn/PX, **refinado** (hierarquia tipográfica, pills semânticos, ícones por seção). |

---

## Layout

### Desktop (`lg+`)
```
┌─────────────────────────────────────────────────────────────────┐
│  ‹ breadcrumb de drill-down (mantido) ›                           │
├──────────────────────────────────────────┬──────────────────────┤
│  HERO DE IDENTIDADE  (col-span: main)     │  REDE (sticky rail)   │
│  Nome/Razão grande · idade·gênero / fant. │  ┌─────────────────┐  │
│  doc mascarado · situação [pill]          │  │ preview estático│  │
│  PEP ● · Sanções ●  (veredito)            │  │  ●─● ● (snapshot│  │
│  ── núcleo familiar: ⚀mãe ⚀cônjuge … ──   │  │   color-coded)  │  │
│  · · · spinner discreto se job rodando    │  └─────────────────┘  │
├──────────────────────────────────────────┤  14 nós · 21 conexões │
│  ▸ Processos judiciais      N processos   │  👤 5 pessoas         │
│  ▸ Mídia & risco            N menções     │  🏢 3 empresas        │
│  ▸ PEP / Sanções            veredito      │  ⚖ 6 vínc. process.   │
│  ── Vínculos ──                           │  [ Abrir rede → ]     │
│  ▸ Pessoas relacionadas     N pessoas     │  (gate canSeeNetwork) │
│  ▸ Empresas relacionadas    N empresas    │                       │
└──────────────────────────────────────────┴──────────────────────┘
```
Grid: `lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8`. Rail `lg:sticky lg:top-8 self-start`.

### Mobile
Coluna única: breadcrumb → hero → **card de rede** (não-sticky, logo abaixo do hero, antes das seções) → seções colapsáveis.

---

## Branch CPF vs CNPJ (unificado)

A page já ramifica por `searchRow.search_type`. As seções por tipo:

| Seção | CPF (pessoa) | CNPJ (empresa) |
|-------|--------------|----------------|
| Hero | nome, idade·gênero, CPF, situação, núcleo familiar, PEP/sanções | razão social, fantasia, CNPJ, situação, capital, atividade, abertura, sancionado |
| Processos judiciais | ✓ | ✓ |
| Mídia & risco | ✓ | ✓ |
| PEP / Sanções | "PEP / Sanções" | "Sanções e restrições" (CEIS/CNEP/trabalho escravo) |
| Vínculos | Pessoas relacionadas + Empresas relacionadas | Sócios |

Núcleo familiar no hero e a seção "Pessoas relacionadas" **só existem no root CPF** (slug `pessoas-relacionadas-cpf`). CNPJ não tem família.

---

## Componentes

### Novos

**`components/antifraude/identity-hero.tsx`** (server)
Substitui `IdentityCard` + `IdentityCardCnpj` como herói. Branqueia por `tipo: 'cpf' | 'cnpj'`. Props somam os campos de ambos os cards atuais + `risk` (PEP/sanções para o veredito inline) + `nucleo: RelatedPersonEntry[]` (parentes de 1º grau, só CPF). Renderiza:
- Nome/razão em tipografia de display; metadados secundários em linha.
- `situacaoCadastral` como **pill semântico** (verde "ativa" / vermelho caso contrário) — reaproveita a lógica de `IdentityCardCnpj`.
- Veredito de risco inline: dots/badges PEP ● e Sanções ● (vem de `PepCard`/`SancoesCardCnpj` props).
- **Mini-núcleo familiar** (CPF): chips clicáveis dos parentes 1º grau filtrados de `RelatedPersonEntry` (tipos `MOTHER/FATHER/PARENT/SPOUSE/PARTNER/SON/DAUGHTER/CHILD`), cada um dispara o mesmo `deepenDocument({ docType: 'cpf-relacionado' })`. Reusa o `RELATIONSHIP_LABELS` de `related-people.tsx` (extrair para módulo compartilhado `lib/netrin/relationship-labels.ts`).
- Spinner discreto quando `jobStatus` ∈ {pending, running}.

**`components/antifraude/network-rail.tsx`** (server)
Card "Rede de relacionamentos" sticky. Props: `stats: SubgraphStats`, `networkHash`, `canSeeNetwork`. Renderiza:
- Preview estático leve (SVG/cluster simples desenhado a partir de contagens + posições determinísticas; **sem labels decifradas**, usa só counts e tipo). Arestas color-coded por kind: família, corporativa, processual.
- Stats discriminadas: total nós/conexões + por tipo (👤 pessoas, 🏢 empresas, ⚖ vínculos processuais).
- CTA "Abrir rede completa →" para `/network/[hash]`. Gate `canSeeNetwork`: sem permissão → estado bloqueado (cadeado) ou oculto.
- Estados: vazio (grafo não populado / busca por nome) e carregando (job rodando).

**`components/antifraude/result-section.tsx`** (client/server wrapper)
Wrapper colapsável genérico sobre shadcn `Collapsible`/`Accordion`. Props: `title`, `icon`, `summary` (ReactNode — veredito/contagem sempre visível no cabeçalho), `children` (corpo "ver tudo"), `defaultOpen?`. Usado por todas as seções da coluna principal.

**`lib/graph/subgraph-stats.ts`** + `.test.ts` (TDD — função pura/loader)
`getSubgraphStats(hash)`: conta nós por `node_type` e arestas por `kind` **sem decifrar labels** (query direta a `graph_nodes`/`graph_edges` 1-hop, ou derivação pura a partir de um `SubgraphDto`). Evita o custo de `DECRYPT_BATCH` de `getSubgraph` na página de resultado. Tipo `SubgraphStats = { nodes: number; edges: number; people: number; companies: number; processEdges: number; familyEdges: number; corporateEdges: number }`. A parte pura (derivar stats de listas de nós/arestas) é testada sob Vitest; o loader é wiring fino.

### Modificados

**`app/(app)/search/result/[hash]/page.tsx`**
- Novo layout grid 2 colunas + rail sticky.
- Remove header "Consulta arquivada" + `term_preview` solto, badge "Em cache", "Pesquisada em…".
- Renomeia card → **"Processos judiciais"** (remove "Predictus").
- Compõe `IdentityHero` (passando núcleo familiar derivado de `buildRelatedPeople`), as `ResultSection`s, e `NetworkRail` (chama `getSubgraphStats`).
- Status do job vira spinner discreto no hero (remove o badge proeminente de status da seção antifraude).
- Mantém `BreadcrumbNetwork`, `EnrichmentRealtime`, `SearchRowRealtime`.

**`components/antifraude/related-people.tsx`** / **`related-companies.tsx`** / **`socios-card.tsx`**
Encaixam no corpo de `ResultSection` (o `Card`/`CardHeader` interno some; o título/contagem vira o `summary` da seção). Drill-down (`deepenDocument`) **100% preservado**. A lista completa de família vive aqui; o hero mostra só o 1º grau.

**`components/antifraude/pep-card.tsx`** / **`media-card.tsx`** / **`sancoes-card-cnpj.tsx`**
O **resumo** (veredito/contagem) sobe para o cabeçalho da `ResultSection`; o **detalhe cru** (histórico PEP linha a linha, breakdown de mídia, descrições CEIS/CNEP) vira o corpo expansível. Refatorar cada um para expor `summary` e `detail` separados, ou dividir em dois subcomponentes.

### Reaproveitados sem mudança
`ProcessResultsTable` (corpo da seção Processos), `EnrichmentRealtime`, `SearchRowRealtime`, `NetworkCta` (a lógica de gate `canSeeNetwork` migra para `NetworkRail`; o `NetworkCta` standalone pode ser aposentado).

---

## Estados (realtime / loading / vazio)

- **Processos `pending`**: spinner discreto no corpo da seção; `SearchRowRealtime` dispara `router.refresh()` na transição.
- **Antifraude `running`**: skeletons nos summaries das seções + spinner discreto no hero; `EnrichmentRealtime` atualiza.
- **Rede não populada**: trilho mostra estado vazio ("rede ainda sendo construída" quando job roda; "sem rede" para busca por nome).
- **Cache expirado** (processos): estado vazio "resultados não estão mais disponíveis" — mantém o comportamento atual, sem citar cache como motivo.

---

## Copy (pt-BR, sem fornecedor)

- "Resultados Predictus" → **"Processos judiciais"**.
- Sem "Em cache", "Consulta arquivada", "Pesquisada em".
- Manter "antifraude", "consulta", "fonte de dados" onde necessário.
- Labels de parentesco via `RELATIONSHIP_LABELS` compartilhado.

---

## Testes

- `lib/**` segue TDD. Novos: `lib/graph/subgraph-stats.test.ts` (derivação pura de stats), e teste do extrator de relationship-labels se virar módulo.
- `components/**` e `app/**` são wiring fino — verificados por `pnpm build` + smoke manual no localhost.
- Rodar `pnpm typecheck` + `pnpm lint:fix` + `pnpm test` antes de commitar.

## Itens a verificar na implementação

1. `getSubgraph`/`graph_edges` já retornam `family_relation`? (Sim, pela migration `20260526130000_family_relation_edges.sql` — confirmar que a migration foi aplicada no ambiente antes de testar o color-coding.)
2. A feature de família (`related-people.tsx`, parsers, `resolve-related.ts`, migration) está **uncommitada**. Definir se este redesign entra no mesmo branch/feature ou depois que ela estabilizar. O plano assume o formato atual de `RelatedPersonEntry`.
3. Preview estático: validar abordagem (SVG determinístico a partir de counts) vs. uma imagem/placeholder mais simples se o esforço de desenho não compensar.
4. Responsividade do rail sticky em alturas de viewport curtas (rail mais alto que a janela).

---

## Risco / reversibilidade

Mudança puramente de apresentação; nenhum dado persistido muda. Reversível por revert de commit. O maior risco é interação com a feature de família ainda em voo — mitigado tratando `RelatedPersonEntry` como contrato estável e coordenando o branch.
