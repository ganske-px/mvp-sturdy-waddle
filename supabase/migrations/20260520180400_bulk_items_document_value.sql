-- ============================================================================
-- bulk_job_items: store the raw CPF/CNPJ alongside the hash
--
-- Rationale: the Edge Function needs the actual document digits to call the
-- Predictus API. The hash is irreversible, so we can't reconstruct it. We
-- accept a window of in-cleartext storage scoped to the lifetime of a bulk
-- job (typically minutes), and shrink the LGPD exposure with a 7-day purge
-- of completed jobs (vs. 30 days for everything else).
-- ============================================================================

alter table public.bulk_job_items
  add column document_value text not null;

comment on column public.bulk_job_items.document_value is
  'Raw CPF/CNPJ digits required by the Edge Function to call Predictus. '
  'Lives only as long as the parent job — completed jobs are purged in 7d.';

-- Replace the 30-day purge of bulk_jobs with a 7-day purge for completed and
-- failed jobs, to shorten the in-cleartext window of document_value.
create or replace function public.purge_old_bulk_jobs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.bulk_jobs
  where status in ('completed', 'failed')
    and finished_at < now() - interval '7 days';
end;
$$;
