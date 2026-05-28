-- supabase/migrations/20260526110000_enrichment_pgnet_dispatch.sql
-- ============================================================================
-- pg_net dispatch for enrichment_jobs
--
-- Substitui o fire-and-forget `fetch()` na Server Action por um trigger
-- AFTER INSERT que enfileira uma chamada HTTP para a Edge Function
-- `process-enrichment-job` via pg_net. Garante at-least-once dispatch sem
-- depender da resiliência da Server Action.
--
-- Para o Edge Function poder reconstruir o documentRaw (Netrin precisa do
-- plaintext), adicionamos `document_encrypted bytea` na tabela. A Server
-- Action criptografa o documento via Vault (predictus_cache_key) antes de
-- inserir; o Edge Function decifra ao processar.
--
-- O dispatch URL e token vivem em vault.secrets (`enrichment_dispatch_url`,
-- `enrichment_dispatch_token`). Se algum estiver ausente o trigger emite
-- warning e segue — o sweep de órfãos a cada 5min marca o job como failed.
-- ============================================================================

create extension if not exists pg_net with schema extensions;

alter table public.enrichment_jobs
  add column document_encrypted bytea;

create or replace function public.dispatch_enrichment_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_token text;
begin
  if NEW.status <> 'pending' then
    return NEW;
  end if;

  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets
      where name = 'enrichment_dispatch_url'
      limit 1;

    select decrypted_secret into v_token
      from vault.decrypted_secrets
      where name = 'enrichment_dispatch_token'
      limit 1;

    if v_url is null or v_token is null then
      raise warning
        'enrichment dispatch skipped for job %: missing vault secrets (orphan sweep will catch it)',
        NEW.id;
      return NEW;
    end if;

    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('jobId', NEW.id::text),
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'Authorization', 'Bearer ' || v_token
      )
    );
  exception when others then
    raise warning 'enrichment dispatch failed for job %: %', NEW.id, SQLERRM;
  end;

  return NEW;
end;
$$;

revoke all on function public.dispatch_enrichment_job() from public;

create trigger enrichment_job_dispatch
  after insert on public.enrichment_jobs
  for each row execute function public.dispatch_enrichment_job();
