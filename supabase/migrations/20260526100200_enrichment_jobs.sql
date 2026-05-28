-- supabase/migrations/20260526100200_enrichment_jobs.sql
-- ============================================================================
-- Async enrichment jobs (Netrin Hops 1+2+3)
-- ============================================================================

create table public.enrichment_jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  root_hash   text not null,
  root_type   text not null check (root_type in ('cpf','cnpj')),
  status      text not null check (status in ('pending','running','completed','partial','failed')),
  hop1_status text check (hop1_status in ('success','error','cache_hit','skipped')),
  hop2_total  int not null default 0,
  hop2_done   int not null default 0,
  hop3_total  int not null default 0,
  hop3_done   int not null default 0,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  error       text
);

create unique index enrichment_jobs_one_active_per_root
  on public.enrichment_jobs (root_hash)
  where status in ('pending','running');

create index enrichment_jobs_user_idx on public.enrichment_jobs (user_id, started_at desc);
create index enrichment_jobs_status_started_idx on public.enrichment_jobs (status, started_at);

create table public.enrichment_job_calls (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.enrichment_jobs(id) on delete cascade,
  hop            int not null check (hop in (1,2,3)),
  document_hash  text not null,
  document_type  text not null check (document_type in ('cpf','cnpj')),
  slugs          text[] not null,
  status         text not null check (status in ('pending','running','success','error','cache_hit')),
  cached         boolean not null default false,
  fetched_at     timestamptz,
  error          text,
  created_at     timestamptz not null default now()
);

create index enrichment_job_calls_job_idx on public.enrichment_job_calls (job_id);
create index enrichment_job_calls_doc_idx on public.enrichment_job_calls (document_hash);

alter table public.enrichment_jobs      enable row level security;
alter table public.enrichment_job_calls enable row level security;

create policy enrichment_jobs_own_select on public.enrichment_jobs
  for select using (user_id = auth.uid());

create policy enrichment_job_calls_via_parent on public.enrichment_job_calls
  for select using (
    exists (
      select 1 from public.enrichment_jobs j
      where j.id = job_id and j.user_id = auth.uid()
    )
  );

alter publication supabase_realtime add table public.enrichment_jobs;
alter publication supabase_realtime add table public.enrichment_job_calls;
