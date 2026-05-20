-- ============================================================================
-- 30-day retention via pg_cron
-- ============================================================================

create extension if not exists pg_cron with schema extensions;

-- ----------------------------------------------------------------------------
-- Purge audit_log rows older than 30 days
-- ----------------------------------------------------------------------------
create or replace function public.purge_audit_log()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.audit_log where created_at < now() - interval '30 days';
end;
$$;

-- ----------------------------------------------------------------------------
-- Purge predictus_cache rows past their expires_at
-- ----------------------------------------------------------------------------
create or replace function public.purge_predictus_cache()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.predictus_cache where expires_at < now();
end;
$$;

-- ----------------------------------------------------------------------------
-- Purge completed bulk_jobs (and their items via cascade) older than 30 days
-- ----------------------------------------------------------------------------
create or replace function public.purge_old_bulk_jobs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.bulk_jobs
  where status in ('completed', 'failed')
    and finished_at < now() - interval '30 days';
end;
$$;

-- ----------------------------------------------------------------------------
-- Cron jobs — run daily at 03:00 UTC
-- ----------------------------------------------------------------------------
select cron.schedule(
  'purge-audit-log-daily',
  '0 3 * * *',
  $$select public.purge_audit_log();$$
);

select cron.schedule(
  'purge-predictus-cache-daily',
  '5 3 * * *',
  $$select public.purge_predictus_cache();$$
);

select cron.schedule(
  'purge-old-bulk-jobs-daily',
  '10 3 * * *',
  $$select public.purge_old_bulk_jobs();$$
);
