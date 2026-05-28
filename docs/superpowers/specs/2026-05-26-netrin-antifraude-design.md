# Enriquecimento Antifraude via Netrin (Hops 1+2+3)

**Status:** Spec proposta
**Data:** 2026-05-26
**Autor:** Andre Ganske + Claude
**Iniciativa irmã:** [Network view](2026-05-21-network-view-design.md), [Roles e permissões](2026-05-21-roles-and-permissions-design.md)

## Resumo

Toda busca por CPF (`/search/person`) e por CNPJ (`/search/company`) dispara, em paralelo ao resultado Predictus atual, um job assíncrono que enriquece o documento via API Netrin `consulta-composta`. O job percorre 3 hops (ou 2 quando raiz é CNPJ) e popula progressivamente novos cards "Antifraude" na página de resultado e novas arestas societárias no grafo de rede existente.

A API Netrin é uma fonte externa diferente da Predictus: ela responde com dados cadastrais (RFB), sanções/PEP, mídia negativa, processos e — crucialmente — a **rede societária** do documento (CPF → CNPJs vinculados → CPFs sócios). Isso enriquece o que hoje é só "histórico processual" com sinais antifraude vindo de outras fontes.

## Motivação

Hoje, ao buscar um CPF, o operador vê apenas processos judiciais (Predictus). Para um fluxo de antifraude — checar se uma pessoa cadastrando-se na PX traz risco — é necessário também: confirmar identidade, checar sanções/PEP, avaliar mídia negativa, e mapear a rede de empresas e sócios em volta dela. A Netrin entrega todos esses sinais via `consulta-composta`, que aceita múltiplos slugs empilhados em uma única chamada HTTP.

## Decisões tomadas no brainstorming

| Tópico | Decisão |
|---|---|
| Escopo | Hops 1+2+3 completos (3-graus de profundidade) |
| Trigger | Automático em toda busca CPF e CNPJ |
| Outras buscas | CPF dispara Hops 1→2→3; CNPJ dispara Hops 2→3; nome não dispara nada |
| Cache | Compartilhado, 30 dias, granularidade por documento, encriptado |
| UI | Cards Antifraude no resultado + integração no grafo `/network/[hash]` |
| Job model | Tabela `enrichment_jobs` nova + `enrichment_job_calls`; loop reaproveita padrões de `bulk/processor.ts` |
| Audit | 1 row em `audit_log` por chamada HTTP (= por documento consultado) |
| Vault key | Nova `netrin_cache_key` separada (defesa em profundidade) |
| Job único | Índice parcial em `(root_hash)` para `status in ('pending','running')` — busca repetida reusa |
| Auth Netrin | Token estático em query string (`?token=...`), via `NETRIN_TOKEN` em `.env.local` |
| Permissão | Reusa `search_person` / `search_company` (sem novo gate) |
| Rate limit | Sem cap defensivo; processamento serial; ajustar se Netrin reclamar |

## Arquitetura

### Camada de módulos

```
lib/netrin/
  client.ts          HTTP client da consulta-composta (multi-s=), token via query, retries 5xx
  server-client.ts   factory que injeta credenciais do env, isola token do client-side
  cache.ts           get/set netrin_cache (encriptado via netrin_cache_key, TTL 30d, compartilhado)
  types.ts           tipos das respostas por slug
  parsers/<slug>.ts  parser puro por slug + .test.ts (1 arquivo por slug do catálogo usado)
  hops/hop1.ts       executa Hop 1 (slugs do CPF root) + extrai CNPJs pivô
  hops/hop2.ts       executa Hop 2 (slugs do CNPJ) + extrai CPFs pivô
  hops/hop3.ts       executa Hop 3 (slugs reduzidos do CPF descoberto) — terminal
  job-store.ts       CRUD enrichment_jobs / enrichment_job_calls
  processor.ts       loop assíncrono, error isolation, status transitions, Realtime emit
  graph-bridge.ts    Netrin payload → ExtractedGraph (nodes cpf/cnpj + edges corporate_relation)
```

Camada `app/` e `supabase/functions/` é wiring fino sobre o `lib/`, conforme convenção do CLAUDE.md.

### Mudanças em código existente

- `lib/graph/types.ts` — adicionar `EdgeKind = ... | 'corporate_relation'` e `CorporateEvidence` type.
- `lib/graph/writer.ts` — aceitar union discriminada por `kind` no `evidence` (sem migration; já é jsonb).
- `app/(app)/search/person/actions.ts` — após o redirect Predictus, criar `enrichment_job` para o CPF e disparar Edge Function fire-and-forget.
- `app/(app)/search/company/actions.ts` — análogo para CNPJ root (Hops 2→3).
- `app/(app)/search/result/[hash]/page.tsx` — renderizar cards Antifraude com Realtime hook.
- `app/(app)/network/[hash]/page.tsx` — toggle "Societário" e estilo visual distinto para `corporate_relation`.
- `components/antifraude/` — novos componentes (`identity-card`, `pep-card`, `media-card`, `restrictions-card`, `related-companies`).
- `scripts/bootstrap-vault.sql` — adicionar criação idempotente de `netrin_cache_key`.

### Schema (nova migration `<timestamp>_netrin_enrichment.sql`)

```sql
-- Cache compartilhado, 30 dias, encriptado via Vault (netrin_cache_key)
create table public.netrin_cache (
  document_hash text primary key,
  document_type text not null check (document_type in ('cpf','cnpj')),
  encrypted_payload bytea not null,
  slugs_fetched text[] not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
alter table public.netrin_cache enable row level security;
create policy "netrin_cache read for authenticated"
  on public.netrin_cache for select to authenticated using (true);
-- writes via service-role only (sem policies = nega RLS)

-- Job de enriquecimento por documento root
create table public.enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  root_hash text not null,
  root_type text not null check (root_type in ('cpf','cnpj')),
  status text not null check (status in ('pending','running','completed','partial','failed')),
  hop1_status text,
  hop2_total int not null default 0,
  hop2_done  int not null default 0,
  hop3_total int not null default 0,
  hop3_done  int not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text
);
create unique index enrichment_jobs_one_active_per_root
  on public.enrichment_jobs (root_hash)
  where status in ('pending','running');

alter table public.enrichment_jobs enable row level security;
create policy "enrichment_jobs own rows"
  on public.enrichment_jobs for select to authenticated
  using (user_id = auth.uid());
-- writes service-role only

-- 1 row por chamada HTTP Netrin
create table public.enrichment_job_calls (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.enrichment_jobs(id) on delete cascade,
  hop int not null check (hop in (1,2,3)),
  document_hash text not null,
  document_type text not null check (document_type in ('cpf','cnpj')),
  slugs text[] not null,
  status text not null check (status in ('pending','running','success','error','cache_hit')),
  cached boolean not null default false,
  fetched_at timestamptz,
  error text
);
alter table public.enrichment_job_calls enable row level security;
create policy "enrichment_job_calls visible via parent"
  on public.enrichment_job_calls for select to authenticated
  using (exists (select 1 from public.enrichment_jobs j
                 where j.id = job_id and j.user_id = auth.uid()));

-- Vault RPC: encrypt_netrin / decrypt_netrin usando netrin_cache_key (padrão dos outros)
-- pg_cron jobs:
--   1) purge netrin_cache where expires_at < now() — diário
--   2) purge enrichment_jobs / calls > 30 dias (cascade) — diário
--   3) marca como 'failed' enrichment_jobs com status='running' e started_at < now() - interval '15 minutes' — a cada 5 min
```

### Vault key

`scripts/bootstrap-vault.sql` ganha bloco idempotente análogo ao `predictus_cache_key`, mas com nome `netrin_cache_key`. Funções `encrypt_netrin(text)` / `decrypt_netrin(bytea)` em SQL espelham as do Predictus, referenciando essa key.

## Fluxo

### Trigger (Server Action)

```
searchPerson() / searchCompany()
  ├─ valida documento + requirePermission
  ├─ writeAuditLog('search_single', ...)                       // hoje
  ├─ Predictus: cache lookup → fetch se miss                   // hoje
  ├─ INSERT em searches                                        // hoje
  ├─ enrichmentJobStore.findOrCreate({ root_hash, root_type, user_id })
  │     ├─ se já existe job (pending|running) → retorna existente
  │     ├─ senão INSERT (status=pending) + fire-and-forget
  │     │     fetch(EDGE_URL + '/process-enrichment-job', { method: 'POST', body: { jobId } })
  │     │     (sem await — o redirect dispara antes do Edge terminar)
  │     └─ race: dois requests concorrentes do mesmo CPF → INSERT do perdedor falha por
  │           violar `enrichment_jobs_one_active_per_root`; o erro é capturado e o caller
  │           refaz SELECT pra encontrar o job vencedor.
  └─ redirect('/search/result/[hash]?ej=' + jobId)
```

### Edge Function `process-enrichment-job`

Roda em Deno, importa `lib/` via paths relativos (mesmo padrão de `process-bulk-job`). Orquestra os três hops com error isolation:

```
Hop 1 (apenas se root_type='cpf'):
  ├─ writeAuditLog('enrichment_call', hop=1, doc_hash=rootHash)
  ├─ netrin_cache.get(rootHash) → hit ⇒ call.status='cache_hit'; segue
  ├─ client.fetchComposta(cpf, [
  │     'esp-cpf', 'receita-federal-cpf', 'pep-kyc-cpf',
  │     'midias-consolidado', 'processos-cpf',
  │     'empresas-relacionadas-cpf', 'pessoas-impedidas-apostar'
  │   ])
  ├─ cache.set(rootHash, encrypted payload, slugs_fetched)
  ├─ INSERT enrichment_job_calls + UPDATE job.hop1_status='success'
  ├─ Realtime emit
  └─ extrai CNPJs de payload['empresas-relacionadas-cpf'].negociosRelacionados[]
       → UPDATE job.hop2_total

Hop 2 (para cada CNPJ extraído OU se root_type='cnpj', sobre o root):
  para cada cnpj:
    ├─ writeAuditLog('enrichment_call', hop=2, doc_hash=cnpjHash)
    ├─ cache lookup
    ├─ client.fetchComposta(cnpj, [
    │     'esp-cnpj-completo', 'receita-federal-cnpj', 'receita-federal-cnpj-qsa',
    │     'informacoes-socios-pj', 'pessoas-relacionadas-cnpj', 'pep-kyc-cnpj',
    │     'midias-consolidado', 'processos-cnpj',
    │     'portal-transparencia-ceis', 'portal-transparencia-cnep',
    │     'trabalho-escravo'
    │   ])
    ├─ cache.set + INSERT call + UPDATE job.hop2_done++
    ├─ Realtime emit
    ├─ extrai CPFs de payload['pessoas-relacionadas-cnpj'].entidadesRelacionadas[]
    │   (inclusive vínculos com dataFimRelacionamento != '9999-12-31', marcados como histórico)
    └─ acumula em job.hop3_total

Hop 3 (para cada CPF sócio descoberto — terminal):
  para cada cpf:
    ├─ writeAuditLog('enrichment_call', hop=3, doc_hash=cpfHash)
    ├─ cache lookup
    ├─ client.fetchComposta(cpf, [
    │     'esp-cpf', 'pep-kyc-cpf', 'midias-consolidado',
    │     'processos-cpf', 'empresas-relacionadas-cpf'
    │   ])
    ├─ cache.set + INSERT call + UPDATE job.hop3_done++
    └─ Realtime emit

Pós-processamento:
  ├─ graphBridge.extract(allCalls) → ExtractedGraph
  ├─ graphWriter.write(extracted) via RPC upsert_graph
  └─ UPDATE job.status = 'completed' (ou 'partial' se houve ≥1 erro), finished_at = now()
```

### Client Netrin

```
client.fetchComposta(documento, slugs)
  ├─ URL = ${baseUrl}/v1/consulta-composta?token=${NETRIN_TOKEN}&${docKey}=${doc}${slugs.map(s=>'&s='+s).join('')}
  │   (docKey = 'cpf' ou 'cnpj' conforme tipo)
  │   Nome do query param do token (`token`) é assumido baseado em padrão Netrin; confirmar
  │   no contrato no momento da implementação. Trocar isolado em `lib/netrin/client.ts` se
  │   for diferente (ex.: `apikey`, `key`).
  ├─ GET com timeout
  ├─ 5xx/network → retry exp backoff (1s, 2s, 4s; 3 tentativas)
  ├─ 401/403 → throw imediato (token estático, sem refresh)
  ├─ 4xx (não 401/403) → throw imediato
  └─ 200 → parse JSON, retornar por slug
```

**Segurança:** o token nunca aparece em log. A `URL` completa **nunca** vai pra `console.log`. Erros que escapam pra `audit_log` ou pra resposta de Server Action carregam só status code + slug, nunca a URL.

### Render no `/search/result/[hash]`

- Server Component lê `enrichment_job` mais recente do `(root_hash, user_id)`, junta com `enrichment_job_calls`, decifra `netrin_cache` no servidor.
- Cliente recebe shape já decifrado (sem token, sem URL Netrin).
- Componentes em `components/antifraude/` consomem props tipadas.
- `useEnrichmentJob(jobId)` (client hook) assina canal Realtime `enrichment:<jobId>`, chama `router.refresh()` em mudanças de status/counters.
- Skeleton enquanto a call correspondente está `pending|running`. Erros viram badge cinza "indisponível" no card.

### Integração no grafo `/network/[hash]`

- Nova `EdgeKind = 'corporate_relation'`.
- Evidence:
  ```ts
  type CorporateEvidence = {
    vinculo: string;                         // 'SOCIO-ADMINISTRADOR', 'OWNERSHIP', 'DIRECT', ...
    percentualParticipacao?: number;
    dataInicioRelacionamento?: string;
    dataFimRelacionamento?: string;          // '9999-12-31' = ativo
    source: 'empresas-relacionadas-cpf' | 'pessoas-relacionadas-cnpj';
  };
  ```
- `lib/graph/types.ts` ganha union discriminada em `StoredEdgeEvidence`. Sem migration de schema (`evidence` é jsonb).
- `lib/graph/writer.ts` coleta `ExtractedEdge[]` com `kind='corporate_relation'` e persiste via mesmo RPC `upsert_graph`.
- UI: toggle "Societário" no sidebar; cor azul para arestas Netrin (cinza permanece pros processuais); nós CNPJ ganham shape quadrado para distinguir de CPF (círculo).
- Filtros, foco e shortest-path continuam funcionando — todas as queries existentes operam sobre `graph_edges` independente do `kind`.

## Erros e recuperação

| Cenário | Comportamento |
|---|---|
| Hop 1 falha | `job.status='failed'`, sem expansão pra Hop 2/3 |
| Hop 2 falha pra 1 CNPJ | call marcada `error`, segue demais CNPJs; sem Hop 3 derivado; job termina `partial` |
| Hop 3 falha pra 1 CPF | call marcada `error`, segue demais; job termina `partial` |
| Edge Function crash/timeout | job órfão `running` → pg_cron marca `failed` após 15 min |
| 401/403 do Netrin | throw, job `failed`; sinal pra rotacionar token |
| 5xx Netrin | retry exp backoff 3x dentro do client; se persistir, erro do call |
| Cache hit | call `cache_hit`, cached=true; graphBridge ainda processa pra atualizar nós/arestas |

## LGPD

- **Hashes**: `document_hash` em `enrichment_jobs`, `enrichment_job_calls`, `audit_log`, `netrin_cache` é sempre `hashDocument('cpf'|'cnpj', raw)` com prefixo de tipo.
- **Plaintext PII**: vive só (a) em memória durante a chamada Netrin, (b) encriptado em `netrin_cache.encrypted_payload` (via `netrin_cache_key`). Server Action decifra para renderizar pro operador autenticado.
- **`enrichment_job_calls`**: não guarda payload — só metadata (hash, slugs, status, fetched_at, error_msg). Sem CPF/CNPJ em cleartext.
- **`audit_log`**: 1 row por chamada HTTP com `action='enrichment_call'`, `document_hash`, `hop`, `job_id`. Permite relatório LGPD: "todos os documentos que o operador X consultou".
- **`graph_nodes.encrypted_label`**: labels (nome, documento, OAB) continuam encriptadas via `graph_label_key` (key separada do cache). `masked_preview` é a renderização LGPD-safe pro fallback client-side.
- **Retenção**: 30 dias para `netrin_cache`, `enrichment_jobs`, `enrichment_job_calls`. Mesma postura do `predictus_cache`. Purges via pg_cron na própria migration. `graph_nodes`/`graph_edges` continuam append-only (decisão consciente, igual hoje).
- **Token Netrin**: jamais aparece em log, audit, error message ou resposta de Server Action. Lido só dentro de `server-client.ts`.

## Permissões

- CPF root → `requirePermission('search_person')` já presente em `searchPerson`. Sem novo gate.
- CNPJ root → `requirePermission('search_company')` já presente em `searchCompany`. Sem novo gate.
- Justificativa: enriquecimento é parte do mesmo ato de busca. Se quisermos isolar custo no futuro, adicionamos `enrichment_antifraud` via recipe do CLAUDE.md ("Adicionar uma nova permissão de serviço").

## Variáveis de ambiente

```bash
# .env.local
NETRIN_BASE_URL=https://api.netrin.com.br
NETRIN_TOKEN=<token estático fornecido pela Netrin>
NETRIN_PEP_ACURACIA=95           # threshold default para slugs pep-kyc-*
```

`NETRIN_TOKEN` é tratado como secret: nunca exposto ao client-side, nunca logado, lido apenas em `lib/netrin/server-client.ts`. Em produção, configurado via `vercel env add NETRIN_TOKEN` (encrypted at rest).

## Testes

`pnpm test` hoje tem 157. Estimativa pós-implementação: **+40 a +60 testes**.

| Módulo | Testes | Cobertura |
|---|---|---|
| `lib/netrin/client.test.ts` | ~12 | URL construction, multi-`s=`, 5xx retry, 401/403 throw, timeout, parse |
| `lib/netrin/cache.test.ts` | ~5 | Encrypt/decrypt round-trip, expiry, slugs_fetched merge |
| `lib/netrin/parsers/*.test.ts` | ~20 | 1 suite por slug usado, com fixture real |
| `lib/netrin/hops/*.test.ts` | ~6 | Pivots, filtros (dataFim, vínculo encerrado) |
| `lib/netrin/processor.test.ts` | ~6 | Loop, error isolation, status transitions, Realtime emit |
| `lib/netrin/graph-bridge.test.ts` | ~5 | Netrin payload → ExtractedGraph nodes+edges |
| `lib/netrin/job-store.test.ts` | ~5 | findOrCreate idempotência, CRUD calls |

App e Edge Function continuam sem unit test — wiring fino exercitado por build + smoke manual, padrão do projeto.

## Perguntas em aberto

1. **`midias-consolidado` aceita CNPJ?** Doc Netrin avisa pra confirmar com time deles. Se não aceitar, removemos do bundle do Hop 2 sem afetar o resto. Encaminhar como pergunta direta à Netrin antes de codar Hop 2.
2. **Rate limit Netrin contratual.** Não consta. Começamos serial sem `sleep` defensivo. Se rolar 429 em produção, adicionamos `RETRY_AFTER`-aware delay.
3. **`empresas-relacionadas-cpf` no Hop 3 — manter ou cortar?** Doc marca como opcional ("só se quiser detectar fachada — sócio do cadastrando também é sócio de empresa X já flagrada"). Decisão padrão neste design: **manter** (escopo "completo" aprovado). Custo: +1 chamada por sócio do Hop 3. Reavaliar se cost-per-job for proibitivo.
4. **Vínculos societários encerrados** (`dataFimRelacionamento != '9999-12-31'`). Decisão padrão: **incluir e marcar como histórico** no payload (não filtrar). UI mostra com cinza/badge "encerrado". Operador decide se ignora.

## Riscos

- **Custo Netrin imprevisível.** Hub com 30 CNPJs × 10 sócios cada vira ~300 chamadas de Hop 3. Sem cap defensivo (decisão consciente — sem premature optimization), mas vale monitorar cost/job em produção e revisitar se gritar.
- **Tempo de execução do Edge Function.** Vercel/Supabase Edge tem limite (default 300s no Supabase, ainda mais com fluid compute). Hub muito grande pode estourar. Mitigação: marcador de `running` órfão + retry manual via nova busca (que reusa via cache). Se virar problema real, quebramos em sub-jobs Hop 2 → Hop 3.
- **Schema drift entre slugs.** Cada slug retorna shape diferente; parsers individuais isolam o risco. Mas se a Netrin mudar um campo num slug, o parser quebra silenciosamente. Mitigação: parsers fazem validação mínima (campos obrigatórios) e logam warning se shape divergir; teste com fixture atualizada periodicamente.
- **Rotação de token Netrin.** Token estático = sem refresh automático. Se Netrin rotacionar, todas as chamadas falham com 401 até o operador atualizar `.env.local`/Vercel. Mitigação: monitorar 401 no `audit_log` (`error_msg LIKE '%401%'`) e alertar.
