# Rede orientada a investigação + risco — Design

**Data:** 2026-05-27
**Branch:** feature/nextjs-rewrite
**Status:** aprovado (brainstorming) — pronto para virar plano de implementação

## Problema

A tela de rede (`/network/[hash]`) é ego-cêntrica (vizinhança de 1 salto do documento central) e acumulou recursos que competem por atenção: comunidades (Louvain), anéis de hub, filtro de tipo, filtro de relação, slider de vínculos, legenda de 6 arestas, painel de 3 abas. Ficou densa e difícil de operar.

Em paralelo, duas capacidades já existem no backend mas **não têm UI**:
- `findPathBetween(hashA, hashB)` — caminho mais curto no grafo inteiro (commit `790569f`).
- Flags de risco no nó `is_pep` / `has_sanction` (commit `9875a55`, migration `20260526140000`).

O pedido: tornar a tela **mais simples e fácil de operar** e expor o `findPathBetween`, sem perder a capacidade de investigação.

## Os três jobs (espinha dorsal do design)

A tela é **progressiva**, com risco como camada sempre-ligada:

1. **Explorar** (entrada) — quem está ligado a este documento. É o ponto de partida.
2. **Investigar caminho** (evolução de explorar) — como dois documentos se conectam, inclusive quando o destino está fora da vizinhança carregada.
3. **Risco** (automático, sempre ligado) — alerta por proximidade a PEP/sancionado, em camadas:
   - 🔴 **ALTO** — relação direta (1 salto).
   - 🟠 **ATENÇÃO** — a 2–3 saltos.
   - sem alerta — nada arriscado a ≤3 saltos.

A proximidade indireta (🟠) alimenta o risco automaticamente — ou seja, o caminho no grafo passa a fazer parte do cálculo de risco, não é só ferramenta manual.

## Escopo: duas telas

### Tela 1 — Resultado da busca (`app/(app)/search/result/[hash]/page.tsx`)

Ganha um **verdicto de risco automático** no topo do resultado, calculado a partir do grafo persistido. O operador vê o risco **sem precisar abrir o grafo** — é isso que torna o alerta "automático".

- Renderiza 🔴/🟠/(sem alerta) conforme o nó arriscado mais próximo do centro.
- Texto curto: "Relação direta com pessoa PEP" / "A 2 saltos de um sancionado".
- Ação "ver caminho até o risco →" que abre a Tela 2 já com a rota destacada (deep-link por hash do nó arriscado alvo).
- Reusa o padrão de `getSubgraphStats` (server client cookie-aware, RLS deixa qualquer operador autenticado ler `graph_nodes`/`graph_edges`; nunca decifra labels).

### Tela 2 — Rede (`/network/[hash]`) — investigação em foco

Layout escolhido: **investigação em foco** (verdicto grande no topo, canvas full-width, detalhe flutuante).

- **Cabeçalho de investigação**:
  - Verdicto de risco grande (mesmo dado da Tela 1), com "ver caminho até o risco".
  - Campo **"traçar caminho até [CPF/CNPJ]"** — valida CPF/CNPJ, hash-eia e roda `findPathBetween(centro, destino)` mesmo que o destino esteja a vários saltos, fora da vizinhança carregada.
- **Canvas full-width**:
  - Nós coloridos por **risco** (🔴 direto, 🟠 a 2–3 saltos) sobreposto ao tipo (ícone/forma já existentes: pessoa/empresa/advogado).
  - Rota destacada em âmbar quando um caminho está ativo (reusa o highlight atual).
  - Controles enxutos: filtro **Tipos** visível; **"Filtros"** recolhido guarda o slider de vínculos (`minOccurrences`) e o filtro de relação (societário); **legenda compacta**.
  - **Mantém**: zoom/controles, Background, MiniMap.
  - **Corta**: comunidades (Louvain) — coloração, cálculo e a aba Comunidade; anéis de hub (`hubBudget`, `hubSet`, `communityColor`).
- **Painel de detalhe flutuante** (ao clicar um nó):
  - Aba **Visão** — vínculo com o centro, evidências, expandir nó, "ver rede deste nó" (preserva o atual).
  - Aba **Caminho** — resultado da rota ativa (origem → destino, lista de saltos clicável). Absorve o que era a aba "Caminhos".
  - Clique-em-dois-nós para caminho **local** vira extra opcional (mantido, sem destaque).

## Backend

### `findPathBetween` (já existe) — ligar à UI

Sem mudança de assinatura. Passa a ser chamado por:
- o campo "traçar caminho até [doc]" (destino digitado), e
- a ação "ver caminho até o risco" (destino = nó arriscado mais próximo).

### Novo: cálculo de risco por proximidade (função pura + Server Action)

- **Função pura** `lib/graph/nearest-risk.ts` → `findNearestRisk(edges, centerHash, riskyHashes, maxHops)`:
  - BFS não-direcionado a partir do `centerHash` sobre `edges`, parando ao alcançar o primeiro hash em `riskyHashes` (conjunto dos nós com `is_pep`/`has_sanction`).
  - Retorna `{ found, targetHash, distance, level: 'direct' | 'nearby' | 'none' }` — `direct` = distância 1, `nearby` = 2–3, `none` = nada a ≤3.
  - Espelha o estilo de `buildPathResult`/`findShortestPath`: pura, testável sem DB. **TDD primeiro** (`nearest-risk.test.ts`).
- **Server Action / loader** fina por cima:
  - Carrega as arestas (como `findPathBetween` já faz via `fetchAllEdges`) e o conjunto de hashes arriscados (`select node_hash from graph_nodes where is_pep or has_sanction`).
  - Chama `findNearestRisk`. Para a Tela 1, reusa o caminho de dados leve (sem decifrar labels) análogo a `getSubgraphStats`.
  - Constante de limiar `RISK_MAX_HOPS = 3` (1 = vermelho, ≤3 = âmbar, >3 = sem alerta).

### `getSubgraph` — propagar flags de risco ao DTO

- A query de nós passa a selecionar `is_pep, has_sanction`; `GraphNodeDto` ganha `isPep`/`hasSanction`. A coloração de risco no canvas é client-side a partir do DTO.

## Camadas (alinhado ao CLAUDE.md)

- **Lógica pura em `lib/graph/`** com Vitest (`nearest-risk.ts` novo; `path-result.ts` já testado). Cresce a contagem de testes.
- **`app/(app)/network/[hash]/`** e a página de resultado são wiring fino sobre `lib/`.
- LGPD: o cálculo de risco e a Tela 1 nunca decifram labels nem expõem CPF/CNPJ em claro; trafegam só hashes, contagens e flags booleanas. Nenhum nome de fornecedor na copy ("consulta"/"antifraude"). UI toda pt-BR.

## Não-objetivos (YAGNI)

- **Sem otimização prematura**: BFS em memória carregando as arestas (como `findPathBetween` já faz). Sem paginação/índice de caminho/cache de risco até haver gargalo demonstrado. Revisitar só se `graph_edges` crescer muito.
- **Sem substituir** o caminho local cliente-side (clique-em-dois-nós) — fica como extra.
- Comunidades/hubs: apenas removidos, sem substituto.

## Riscos / notas

- Cortar Louvain/hubs remove dependências (`graphology-communities-louvain`) e bastante código do canvas — revisar imports órfãos.
- O verdicto de risco depende do grafo estar populado; com grafo vazio o estado é "sem alerta" (não "erro"). Buscas recém-disparadas podem ainda não ter enrichment concluído — o verdicto atualiza no refresh/realtime já existente da página de resultado.
- Deep-link "ver caminho até o risco" precisa carregar a rota mesmo que o alvo não esteja na vizinhança de 1 salto → usa `findPathBetween`, não o caminho local.

## Critério de pronto

- `findNearestRisk` puro, testado (TDD), verde.
- Tela 1 mostra verdicto correto (direto/próximo/sem alerta) a partir do grafo.
- Tela 2: cabeçalho com verdicto + busca de destino funcionando via `findPathBetween`; nós coloridos por risco; comunidades/hubs removidos; slider/relação atrás de "Filtros"; painel com abas Visão + Caminho.
- `pnpm typecheck` limpo e `pnpm test` acima do baseline atual (358).
