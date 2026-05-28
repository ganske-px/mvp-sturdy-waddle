# Relatório — estrutura de pesos nas relações da rede

**Data:** 2026-05-27
**Objetivo:** quando uma relação entre dois nós é apontada mais de uma vez (mesmas
partes em vários processos) **ou** por mais de um tipo (sócios + parentes +
co-parte), ela deve ganhar **peso** e ficar visualmente mais evidente — aresta mais
grossa, sobrevive aos filtros, ordena no topo do painel, e (opcionalmente) puxa o nó
para mais perto/maior.

> Este é um relatório de implementação. Nenhum código foi alterado.

---

## 1. Como o grafo funciona hoje (verificação)

### Modelo de dados (`supabase/migrations/20260521130000_graph_schema.sql` + extensões)

- **`graph_nodes`** — `node_hash` (PK), `node_type` (`cpf|cnpj|lawyer`),
  `encrypted_label` (bytea, `graph_label_key`), `masked_preview`, `first_seen_at`,
  `last_seen_at`. Migrations posteriores adicionaram `is_pep`, `has_sanction`,
  `risk_updated_at` (booleanas em claro, semântica "só sobe" / OR).
- **`graph_edges`** — `id`, `source_hash`, `target_hash`, `kind`, `evidence` (jsonb),
  timestamps, e a constraint **`unique (source_hash, target_hash, kind)`**.
  - `kind ∈ {co_party, client_lawyer, lawyer_lawyer, corporate_relation, family_relation}`.
  - **Implicação central:** o mesmo par de nós pode ter **várias linhas** se forem
    de **tipos diferentes**. Logo, "relação apontada por mais de um tipo" **já
    produz múltiplas arestas paralelas** entre os dois nós — só que nada as
    agrega num peso único.
  - Simetria: `co_party`/`lawyer_lawyer` são gravadas uma vez com `source < target`.
    `client_lawyer` (parte→advogado), `corporate_relation` (cnpj→sócio ou cpf→cnpj)
    e `family_relation` (cpf raiz→cpf relacionado) são **direcionais**.

### Evidência e acúmulo (`upsert_graph` — última versão em `20260526140000_graph_node_risk_flags.sql`)

A RPC é polimórfica por `kind`:

- **Arestas de processo** (`co_party`, `client_lawyer`, `lawyer_lawyer`):
  fazem **set-union de `processNumbers`** e recalculam
  `occurrences = jsonb_array_length(processNumbers)`. Ou seja, **já existe um peso
  real por aresta**: quantas vezes (processos distintos) as duas partes co-ocorreram.
- **`corporate_relation` e `family_relation`**: a evidência é **sobrescrita**
  (`evidence = excluded.evidence`). **Não há `occurrences`, não acumulam** — valem
  sempre "1".

### Extração / escrita

- `lib/graph/extractor.ts` — Predictus → arestas de processo (uma `ExtractedEdge`
  por observação; o `upsert_graph` colapsa por `(source,target,kind)`).
- `lib/netrin/graph-bridge.ts` — Netrin → `corporate_relation` (empresas-cpf e
  sócios-cnpj) e `family_relation` (pessoas-relacionadas-cpf).
- `lib/graph/writer.ts` — cifra labels e chama `upsert_graph`.

### Leitura (`app/(app)/network/[hash]/actions.ts`)

`getSubgraph(centerHash)` traz o nó centro, vizinhos a 1 salto e **todas as arestas
incidentes ao centro**, devolvendo `SubgraphDto { center, neighbors, edges }`.
`edges` é a lista **crua** — uma entrada por `(source,target,kind)`, sem agregação.

### Renderização (`app/(app)/network/[hash]/network-canvas.tsx`)

Aqui está o cerne do gap visual:

1. **Layout** (`computeLayout`, graphology `multi:false`): para arestas paralelas
   pega `Math.max(cur, weight)` onde `weight = occurrences` só das arestas de
   processo. `corporate`/`family` contribuem peso 1. → **múltiplos tipos não
   aumentam a atração no layout**.
2. **Largura** (`finalEdges`): `strokeWidth = min(5, 1 + occurrences*0.4)`. Só
   processo. `corporate`/`family` ficam fixas em ~1px.
3. **Múltiplos tipos no mesmo par** viram **vários beziers sobrepostos** com a mesma
   geometria (cores diferentes empilhadas) — visualmente confuso, e nenhuma fica
   "mais grossa por ser múltipla".
4. **Filtro "Vínculos ≥ N processos"** (slider) usa **só** `occurrences` de processo.
5. **Painel** (`node-detail-panel.tsx`, `VisaoTab`): ordena arestas incidentes por
   `occurrences` e mostra "N proc.". Um par multi-tipo aparece como vários itens
   soltos, sem força combinada.
6. `lib/graph/subgraph-stats.ts`: conta arestas por tipo, sem noção de peso.

### Resumo do gap

| Capacidade | Estado hoje |
|---|---|
| Peso por co-ocorrência em processos | ✅ existe (`occurrences`) |
| Peso por co-ocorrência em societário/família | ❌ sempre 1 (evidência sobrescrita) |
| **Peso agregado por par (somando tipos)** | ❌ **não existe** |
| Largura da aresta ∝ peso total | ⚠️ só por `occurrences` de processo |
| Layout puxa pares fortes | ⚠️ só por `occurrences` de processo |
| Filtro por força do vínculo | ⚠️ só processos |
| Prominência do nó ∝ peso incidente | ❌ não existe |

---

## 2. Modelo de peso proposto

Trabalhar com **dois níveis derivados**, ambos calculáveis a partir do que já está
no `SubgraphDto`:

### 2.1 Peso da relação (par de nós) — o pedido principal

Normalizar cada aresta para um **par não-ordenado** `key = [min(a,b), max(a,b)]` e
agregar todas as arestas (de qualquer tipo) desse par:

```
forçaDaAresta(e):
  processo (co_party/client_lawyer/lawyer_lawyer) → e.evidence.occurrences   (1..N)
  corporate_relation                              → 1
  family_relation                                 → 1

pesoDoPar(par):
  multiplicidade = Σ forçaDaAresta(e)        // soma sobre as arestas do par
  diversidade    = nº de kinds distintos no par   // 1..5
  peso = multiplicidade + W_DIV * (diversidade - 1)
```

- **Multiplicidade** cobre "apontada mais de uma vez" (vários processos; e, se no
  futuro contarmos, várias fontes societárias).
- **Diversidade** cobre "apontada por mais de um tipo" — cada tipo extra soma um
  bônus `W_DIV` (sugestão inicial `W_DIV = 2`, parametrizável).
- O `peso` é **explicável**: o painel mostra a decomposição ("3 processos + sócios +
  parentesco → peso 7").

### 2.2 Peso do nó (prominência) — derivado, opcional

`pesoDoNó(n) = Σ pesoDoPar(par)` sobre os pares incidentes a `n`. Usado para
dimensionar o raio/saliência do nó (centro sempre destacado à parte). Atende a
literal "estrutura de pesos **nos nodes**".

### 2.3 Mapeamento visual (explicável, com teto)

```
strokeWidth(par) = clamp(1 + 1.2*log2(pesoDoPar+1) + 0.6*(diversidade-1), 1, 8)
nodeScale(n)     = clamp(1 + 0.15*log2(pesoDoNó+1), 1, 1.8)
```

Log para não deixar um par com 40 processos achatar todos os outros; teto para não
estourar o layout. Cor da aresta consolidada = tipo **mais severo** presente no par
(ordem sugerida: `co_party_opposed` > `corporate_relation` > `family_relation` >
`co_party_same` > demais), com um indicador de multi-tipo (ver §4).

---

## 3. Onde calcular o peso: leitura vs escrita

### Opção A — agregação em leitura (recomendada)

Calcular `pesoDoPar`/`pesoDoNó` numa **função pura** consumida na renderização,
a partir do `SubgraphDto` que já é carregado inteiro no cliente.

- **Prós:** zero migration; nada muda no schema append-only compartilhado; é
  testável puro (TDD); reversível; alinhado a "sem otimização/estrutura prematura
  sem gargalo real" — o subgrafo já está em memória no canvas.
- **Contras:** peso não fica persistido (não dá pra ordenar no banco). Para o uso
  atual (render de subgrafo 1-salto), isso é irrelevante.

### Opção B — peso persistido em escrita

Adicionar `occurrences`/contagem de fontes às evidências de `corporate`/`family` e/ou
uma coluna `weight` materializada, atualizada no `upsert_graph`.

- **Prós:** consultável/ordenável no banco; útil se um dia houver ranking global de
  pares ou export.
- **Contras:** migration nova + reescrita da RPC (append-only: novo arquivo); precisa
  semântica de recomputação no grafo compartilhado; muda o contrato de `corporate`/
  `family` (hoje sobrescrevem de propósito). Custo/risco maior sem gargalo demonstrado.

**Recomendação:** começar pela **Opção A**. Subir para B só se aparecer um caso de
ranking/ordenação no servidor. As duas não conflitam — A é a camada de apresentação;
B só materializa o que A já calcula.

---

## 4. Plano por camada (Opção A)

Seguindo TDD (`lib/**` com `.test.ts` primeiro) e mantendo `app/**` como wiring fino.

1. **`lib/graph/edge-weight.ts` (novo, puro, + `.test.ts`)** — TDD.
   - `type WeightedPair = { a: string; b: string; kinds: EdgeKind[]; multiplicity: number; diversity: number; weight: number; dominantKind: EdgeKind }`.
   - `aggregatePairs(edges: GraphEdgeDto[]): Map<string, WeightedPair>` — normaliza
     par não-ordenado, soma `occurrences` (1 p/ corporate/family), conta kinds.
   - `nodeWeights(pairs): Map<string, number>`.
   - Constantes `W_DIV`, fórmulas de `strokeWidth`/`nodeScale` (testar limites: teto,
     diversidade só, multiplicidade só, par single-kind = comportamento atual).
   - Casos de teste: par só-processo (= occurrences de hoje), par sócios+parentes
     (diversidade 2), par com 3 tipos, simetria de chave (a,b)==(b,a), teto do clamp.

2. **`network-canvas.tsx` — consolidar e pesar.**
   - Trocar o mapa cru `keptEdgeDtos → finalEdges` por **uma aresta por par**
     (consolidada via `aggregatePairs`), `strokeWidth` ∝ `weight`, cor =
     `dominantKind`, dash conforme tipo dominante. Guardar `kinds` no `data` da aresta
     para o tooltip/legenda.
   - Indicador multi-tipo: pequeno “×N tipos” ou aresta tracejada-dupla quando
     `diversity > 1` (decisão de UI em aberto, §6).
   - `computeLayout`: usar `pesoDoPar` como `weight` do graphology (em vez do
     `Math.max` de occurrences) e considerar subir `edgeWeightInfluence`.
   - Dimensionar nós por `nodeScale(pesoDoNó)` (ajustar também o `size` do FA2).

3. **Filtro de força (generalizar o slider).**
   - "Vínculos ≥ N **processos**" → "Força do vínculo ≥ N", usando `pesoDoPar`.
     Manter o filtro por tipo de relação como está. Recalcular `maxWeight` no lugar
     de `maxOccurrences`.

4. **`node-detail-panel.tsx` (`VisaoTab`).**
   - Agrupar os vínculos com o centro por par e exibir o **peso** + a **decomposição**
     ("3 processos · sócios · parentesco — peso 7"), ordenando por `pesoDoPar`.

5. **(Opcional) `subgraph-stats.ts` / `network-rail.tsx`.**
   - Expor "vínculo mais forte" / nº de pares multi-tipo no trilho do resultado.

6. **Verificação:** `pnpm test` (novos testes verdes), `pnpm typecheck`, `pnpm lint`,
   e smoke manual numa rede com par multi-tipo conhecido.

### Se/quando for para a Opção B (incremento futuro)

- Migration nova (append-only) adicionando `occurrences`/`source_count` às evidências
  de `corporate`/`family` (set-union de fontes/datas) e/ou coluna `weight`.
- Reescrever `upsert_graph` numa nova migration para acumular em vez de sobrescrever
  esses tipos, e materializar `weight`.
- `edge-weight.ts` continua sendo a fonte única da fórmula (servidor e cliente
  importam a mesma função pura).

---

## 5. Invariantes e cuidados

- **LGPD:** o cálculo de peso usa só `kind`, `occurrences` e hashes — **nada de
  CPF/CNPJ/nome em claro**. Não toca em `encrypted_label`. Sem novos campos sensíveis.
- **Append-only do grafo:** Opção A não escreve nada. Opção B exige migration nova
  (nunca editar migration aplicada) e cuidado com o grafo compartilhado entre
  operadores.
- **TDD:** `lib/graph/edge-weight.ts` nasce com `.test.ts` (o subsistema já tem forte
  cobertura — `path`, `nearest-risk`, `risk-verdict`, `subgraph-stats`).
- **Performance:** agregação é O(arestas) sobre um subgrafo já em memória; sem
  gargalo novo. Layout/render já lidam com centenas de nós.
- **Compat visual:** num par single-kind de processo, a nova fórmula deve recair no
  comportamento atual (width ∝ occurrences) — garantir por teste para não regredir.

---

## 6. Decisões em aberto

1. **Bônus de diversidade `W_DIV`:** começar em `2`? (cada tipo extra "vale" ~2
   processos). Calibrar com uma rede real.
2. **Indicador visual de multi-tipo:** (a) aresta consolidada única mais grossa + cor
   do tipo dominante + contador de tipos no hover; ou (b) manter linhas paralelas mas
   com leve offset (mais "denso" visualmente, mais complexo). Recomendo (a).
3. **Severidade da cor dominante:** confirmar a ordem de prioridade dos tipos para
   pintar a aresta consolidada.
4. **Escopo agora:** só peso de **aresta** (o pedido literal de "relação mais
   evidente"), ou já incluir prominência de **nó** (`nodeScale`)? O texto cita
   "pesos nos nodes" — sugiro entregar os dois, já que o peso do nó deriva trivial.
5. **Opção A só, ou já preparar B?** Recomendo A; B fica como follow-up se surgir
   ordenação no servidor.
```
