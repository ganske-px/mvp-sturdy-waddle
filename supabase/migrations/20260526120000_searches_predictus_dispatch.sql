-- supabase/migrations/20260526120000_searches_predictus_dispatch.sql
-- ============================================================================
-- Predictus fetch agora é async via pg_net dispatch — espelho da arquitetura
-- enrichment_jobs (20260526110000_enrichment_pgnet_dispatch.sql).
--
-- Por quê: o Server Action redirect-a imediatamente para /search/result/[hash]
-- e a Edge Function `process-predictus-job` faz a chamada Predictus em
-- background, gravando o cache e atualizando a row de `searches`. Isso roda em
-- paralelo com `process-enrichment-job` (Netrin) — as duas fontes começam
-- juntas, sem encadeamento.
--
-- Mudanças:
--   1. searches.status         text default 'pending' (após backfill p/
--                                                       linhas históricas)
--   2. searches.document_encrypted bytea, nullable — só preenchido em rows
--      cuja Predictus ainda vai rodar. Cifrado via `encrypt_payload`
--      (predictus_cache_key). Mesma chave do enrichment_jobs.document_encrypted.
--   3. Unique index parcial (user_id, document_hash) WHERE status='pending'
--      para dedup de re-submit do mesmo operador.
--   4. Trigger AFTER INSERT chamando net.http_post para a Edge Function
--      `process-predictus-job` via segredos do Vault.
--   5. searches adicionada ao publication supabase_realtime para a página de
--      resultado assinar UPDATEs.
-- ============================================================================

-- 1. Status lifecycle
-- Default temporário 'completed' faz backfill correto: linhas existentes só
-- foram inseridas APÓS Predictus retornar (cache hit, sucesso ou erro).
alter table public.searches
  add column status text not null default 'completed'
    check (status in ('pending','completed','failed'));

-- Novas linhas começam em 'pending' (Server Action insere antes da Predictus).
alter table public.searches
  alter column status set default 'pending';

-- 2. Encrypted document para o Edge Function reconstituir o plaintext.
-- Nullable porque cache hit insere sem dispatch.
alter table public.searches
  add column document_encrypted bytea;

-- 3. Dedup de re-submit: um pending vivo por (operador, documento).
-- O `findOrCreatePendingSearch` em lib/predictus/run-search.ts trata o 23505.
create unique index searches_one_pending_per_user_hash
  on public.searches (user_id, document_hash)
  where status = 'pending';

-- 4. Dispatch via pg_net (extension já habilitada no 20260526110000).
create or replace function public.dispatch_predictus_search()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_token text;
begin
  -- Só dispara quando há trabalho async a fazer (status pending E plaintext
  -- recuperável). Cache hit insere status='completed' sem document_encrypted.
  if NEW.status <> 'pending' or NEW.document_encrypted is null then
    return NEW;
  end if;

  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets
      where name = 'predictus_dispatch_url'
      limit 1;

    select decrypted_secret into v_token
      from vault.decrypted_secrets
      where name = 'predictus_dispatch_token'
      limit 1;

    if v_url is null or v_token is null then
      raise warning
        'predictus dispatch skipped for search %: missing vault secrets (orphan sweep will catch it)',
        NEW.id;
      return NEW;
    end if;

    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('searchId', NEW.id::text),
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'Authorization', 'Bearer ' || v_token
      )
    );
  exception when others then
    raise warning 'predictus dispatch failed for search %: %', NEW.id, SQLERRM;
  end;

  return NEW;
end;
$$;

revoke all on function public.dispatch_predictus_search() from public;

create trigger predictus_search_dispatch
  after insert on public.searches
  for each row execute function public.dispatch_predictus_search();

-- 5. Realtime
alter publication supabase_realtime add table public.searches;
