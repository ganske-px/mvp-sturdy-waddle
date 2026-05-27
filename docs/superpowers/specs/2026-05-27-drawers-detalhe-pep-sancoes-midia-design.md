# Drawers de detalhe: PEP/Sanções e Mídia

**Data:** 2026-05-27
**Status:** aprovado para implementação

## Problema

Os cards de antifraude em `/search/result/[hash]` (`PepCard`, `MediaCard`,
`SancoesCardCnpj`) hoje mostram apenas **resumos**: contadores e booleans. Os
registros detalhados existem no payload Netrin mas são descartados na agregação
em `app/(app)/search/result/[hash]/page.tsx`. O operador não consegue:

1. Ver as sanções/menções individuais que motivaram o flag.
2. Entender **por que** alguém aparece com "histórico" mas `currentlySanctioned=Não`.

O caso real que motiva: `sanctionsHistory` traz matches por **similaridade de
nome** (homônimos) com `matchRate` baixo (52, 50, 26, 23…), nomes, nascimentos e
nacionalidades diferentes do buscado. Sem o detalhe, o operador interpreta mal.

## Objetivo

Adicionar um **drawer lateral** (sheet à direita) acionável a partir de cada card,
listando todos os registros com detalhes suficientes para o operador avaliar.

## Schemas reais (do payload Netrin)

### `pepKyc.sanctionsHistory[]`
```
source: string            // "interpol" | "ofac" | ...
type: string              // "Money Laundering", "Law Enforcement"
standardizedSanctionType: string  // "FINANCIAL CRIMES", "ARREST WARRANTS"
matchRate: number         // 0..100 — similaridade de nome
nameUniquenessScore: number
startDate / endDate / lastUpdateDate: string
currentlyPresentOnSource / recentlyPresentOnSource: boolean
details: {
  OriginalName: string    // nome buscado
  SanctionName: string    // nome na lista (homônimo)
  BirthDate / StandardizedBirthDate: string
  Nationalities?: string
  charges?: string
  image?: string
  language_spoken?: string
  "SanctionAliases|MatchRate"?: string
}
```

### `pepKyc.historyPEP[]`
```
level, jobTitle, department, motive, source, document, documentPEP,
startDate, endDate, lastUpdateDate   // todos string; linhas vazias = placeholder
```
Filtrar linhas vazias com o mesmo `isNonEmpty` já usado em `extractPepFromHop1`.

### `midiasConsolidado`
```
midiasPublicas.midias[]: {
  titulo, fonte, data_noticia, uf, regiao,
  tipo_suspeita, envolvimento, atividade,
  citacao,                 // texto integral da matéria
  dtec_link_noticia,       // URL da fonte
  nome_cpf, cpf, nome_exato  // disambiguação — CPF mascarado no cliente
}
midiasRiscoReputacional.riscoReputacional.value: { qtdTotal, qtdMidias, ... }  // já usado
midiasListasRestritivas.listas[]
midiasListasGovernamentais.governamentais[]
midiasListasSocioambientais.socioambientais[]
```

### Sanções CNPJ (`pep-kyc-cnpj` / fonte do `SancoesCardCnpj`)
`ceis[]` e `cnep[]` com `{ ativo: boolean; descricao?: string }`, `trabalhoEscravo`.

## Arquitetura

Seguir a regra do projeto: lógica pura em `lib/`, UI fina. Os drawers são
**client components**; os parsers de detalhe são **funções puras testadas**.

### Novo primitivo: `components/ui/sheet.tsx`
Wrapper sobre `@base-ui/react/dialog` (mesma base de `dialog.tsx`), ancorado à
direita, altura total, `max-w-xl`, corpo rolável. Exporta `Sheet`, `SheetTrigger`,
`SheetContent`, `SheetHeader`, `SheetTitle`, `SheetClose`. Sem unit test (camada UI).

### Parsers (TDD, `lib/netrin/parsers/`)
- `sanctions-detail.ts` → `extractSanctions(payload): SanctionMatch[]` (ordena por `matchRate` desc).
- `pep-detail.ts` → `extractPepHistory(payload): PepHistoryEntry[]` (filtra vazios).
- `media-detail.ts` → `extractMediaMentions(payload): MediaMention[]` + listas restritivas/gov/socioambientais. **CPF mascarado** via `mask` de `lib/validators/cpf.ts`.
- `cnpj-sanctions-detail.ts` → reaproveita o que já chega ao `SancoesCardCnpj` (ceis/cnep/trabalhoEscravo); só tipos + helper de contagem.

Cada parser com `.test.ts` usando fixtures derivadas do payload real (sem PII real).

### Componentes de drawer (`components/antifraude/`)
- `pep-sancoes-drawer.tsx` — aviso de contexto quando não há sanção confirmada; lista de matches (badge fonte, `standardizedSanctionType`, realce de `matchRate%`, `SanctionName` vs `OriginalName`, `BirthDate`, `Nationalities`, `charges` expansível); seção PEP.
- `media-drawer.tsx` — lista de menções (`titulo`, `fonte · data · uf`, badge `tipo_suspeita`, `envolvimento`, link "ler na fonte", `citacao` **expansível inline**); seções de listas quando não-vazias.
- `sancoes-cnpj-drawer.tsx` — CEIS/CNEP (ativos e inativos) com `descricao`, flag trabalho escravo.

### Plumbing (`page.tsx`)
Estender `extractPepFromHop1`/`extractMediaFromHop1` (ou chamar os novos parsers)
para retornar também os arrays de registros, adicionar aos props dos cards e
repassar aos drawers. **Sem lazy-load nem paginação** (MVP; não otimizar sem
gargalo real demonstrado — ver memória do projeto). `citacao` integral vai ao
cliente (expansível inline), aceitando payload maior.

### Cards (triggers)
`PepCard`, `MediaCard`, `SancoesCardCnpj` ganham um botão `ghost` discreto no
rodapé ("Ver N registros" / "Ver menções") que abre o respectivo drawer. Mantêm
o resumo atual.

## LGPD

- CPF/CNPJ nos registros (ex.: `media.cpf`) **mascarados** antes de cruzar a
  fronteira servidor→cliente. Nome próprio e texto de notícia pública podem ir em
  claro (já é o conteúdo que o operador precisa avaliar).
- Nada de novo em log/audit. Drawers só renderizam o que o parser server-side já
  decifrou de `netrin_cache`.

## Fora de escopo

- Lazy-loading / paginação de registros.
- Filtro/busca dentro do drawer.
- Persistência de "match revisado/descartado".

## Critérios de aceite

1. Cada card abre seu drawer com os registros do payload.
2. Drawer de sanções deixa explícito que matches são por similaridade e mostra `matchRate`.
3. Drawer de mídia lista menções com citação expansível e link à fonte.
4. Drawer de sanções CNPJ lista CEIS/CNEP com descrição.
5. Nenhum CPF/CNPJ em claro chega ao cliente nos registros.
6. `pnpm typecheck` + `pnpm test` verdes; parsers cobertos por testes.
