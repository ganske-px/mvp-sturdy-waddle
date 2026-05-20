-- ============================================================================
-- RLS policies
-- ============================================================================

alter table public.users enable row level security;
alter table public.searches enable row level security;
alter table public.predictus_cache enable row level security;
alter table public.predictus_token enable row level security;
alter table public.bulk_jobs enable row level security;
alter table public.bulk_job_items enable row level security;
alter table public.audit_log enable row level security;

-- ----------------------------------------------------------------------------
-- public.users: operator can read own row; nobody writes (service_role only).
-- ----------------------------------------------------------------------------
create policy users_self_select on public.users
  for select using (auth.uid() = id);

-- ----------------------------------------------------------------------------
-- public.searches: operator full access to own rows.
-- ----------------------------------------------------------------------------
create policy searches_owner_all on public.searches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- public.predictus_cache: shared READ for any authenticated operator.
-- Writes only via service_role (Edge Function / Server Action with admin client).
-- ----------------------------------------------------------------------------
create policy cache_read_authenticated on public.predictus_cache
  for select using (auth.role() = 'authenticated');

-- ----------------------------------------------------------------------------
-- public.predictus_token: read/write only by service_role. No policy = locked.
-- ----------------------------------------------------------------------------
-- (RLS enabled, zero policies → only service_role bypasses RLS.)

-- ----------------------------------------------------------------------------
-- public.bulk_jobs: operator full access to own jobs.
-- ----------------------------------------------------------------------------
create policy bulk_jobs_owner_all on public.bulk_jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- public.bulk_job_items: visible only when the parent job belongs to the user.
-- ----------------------------------------------------------------------------
create policy bulk_job_items_via_owner on public.bulk_job_items
  for all using (
    exists (
      select 1 from public.bulk_jobs
      where id = bulk_job_items.job_id and user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.bulk_jobs
      where id = bulk_job_items.job_id and user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- public.audit_log: operator reads own rows; writes via service_role only.
-- ----------------------------------------------------------------------------
create policy audit_log_own_select on public.audit_log
  for select using (auth.uid() = user_id);
