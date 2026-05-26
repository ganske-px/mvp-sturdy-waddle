-- supabase/migrations/20260526120100_searches_orphan_sweep.sql
-- ============================================================================
-- Sweep de searches órfãs: rows com status='pending' > 15 minutos são
-- marcadas como 'failed' (mesmo padrão de fail_orphan_enrichment_jobs).
--
-- Causas comuns: trigger pg_net falhou em achar o segredo no Vault, Edge
-- Function crashou antes de UPDATE, ou Predictus engasgou além do timeout
-- do Edge Function. Sem o sweep o usuário ficaria preso no skeleton.
-- ============================================================================

create or replace function public.fail_orphan_pending_searches()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.searches
  set status = 'failed',
      error_message = coalesce(
        error_message,
        'orphaned: predictus edge function did not finish within 15m'
      ),
      document_encrypted = null
  where status = 'pending'
    and created_at < now() - interval '15 minutes';
end;
$$;

select cron.schedule(
  'fail-orphan-pending-searches',
  '*/5 * * * *',
  $$select public.fail_orphan_pending_searches();$$
);
