-- ============================================================================
-- Retention: 30d para netrin_cache + enrichment_jobs/calls; mark orphan
-- running jobs as failed after 15 minutes.
-- ============================================================================

create or replace function public.purge_netrin_cache()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.netrin_cache where expires_at < now();
end;
$$;

create or replace function public.purge_old_enrichment_jobs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.enrichment_jobs
  where status in ('completed','failed','partial')
    and finished_at < now() - interval '30 days';
end;
$$;

create or replace function public.fail_orphan_enrichment_jobs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.enrichment_jobs
  set status = 'failed',
      finished_at = now(),
      error = coalesce(error, 'orphaned: edge function did not finish within 15m')
  where status in ('pending','running')
    and started_at < now() - interval '15 minutes';
end;
$$;

select cron.schedule(
  'purge-netrin-cache-daily',
  '15 3 * * *',
  $$select public.purge_netrin_cache();$$
);

select cron.schedule(
  'purge-old-enrichment-jobs-daily',
  '20 3 * * *',
  $$select public.purge_old_enrichment_jobs();$$
);

select cron.schedule(
  'fail-orphan-enrichment-jobs',
  '*/5 * * * *',
  $$select public.fail_orphan_enrichment_jobs();$$
);
