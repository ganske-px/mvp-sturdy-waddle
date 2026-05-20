-- ============================================================================
-- Initial schema for mvp-sturdy-waddle (Predictus background check app)
-- Stack: Supabase Postgres 16 + RLS + pgcrypto + Vault
-- LGPD: documents always hashed in plaintext tables; raw payload encrypted.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- ============================================================================
-- public.users — mirror of auth.users (manual operator allowlist)
-- ============================================================================
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  created_at timestamptz not null default now()
);

comment on table public.users is
  'Mirror of auth.users. Row presence acts as the operator allowlist — '
  'middleware blocks any authenticated user who is not present here.';

-- Trigger: when an admin creates a user in auth.users via Supabase Studio,
-- automatically mirror them into public.users so the allowlist stays consistent.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ============================================================================
-- public.searches — operator search history (private, RLS by user_id)
-- ============================================================================
create table public.searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  search_type text not null check (search_type in ('cpf', 'cnpj', 'name')),
  -- SHA256 of the normalized document/name. Never the document in plaintext.
  document_hash text not null,
  -- Masked preview for UI: "123.***.***-10", "12.345.***/****-**", "João S***"
  term_preview text not null,
  result_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now()
);

create index searches_user_created_idx on public.searches (user_id, created_at desc);

comment on table public.searches is
  'Operator search history. Documents are stored hashed; term_preview is masked.';

-- ============================================================================
-- public.predictus_cache — shared cache, encrypted payload, 30d TTL
-- ============================================================================
create table public.predictus_cache (
  document_hash text primary key,
  search_type text not null check (search_type in ('cpf', 'cnpj', 'name')),
  -- Payload encrypted with pgcrypto using a key stored in Supabase Vault.
  encrypted_payload bytea not null,
  result_count integer not null default 0,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index predictus_cache_expires_idx on public.predictus_cache (expires_at);

comment on table public.predictus_cache is
  'Shared Predictus result cache. Read by any authenticated operator; '
  'writes restricted to service_role (Edge Functions).';

-- ============================================================================
-- public.predictus_token — singleton token for Predictus API auth
-- ============================================================================
create table public.predictus_token (
  id integer primary key default 1 check (id = 1),
  access_token text not null,
  refreshed_at timestamptz not null default now()
);

comment on table public.predictus_token is
  'Singleton row holding the latest Predictus access token. '
  'Survives cold starts of Vercel functions and Edge Functions.';

-- ============================================================================
-- public.bulk_jobs — async bulk search jobs (private)
-- ============================================================================
create table public.bulk_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed')),
  total_items integer not null check (total_items between 1 and 250),
  done_items integer not null default 0,
  error_items integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_message text
);

create index bulk_jobs_user_created_idx on public.bulk_jobs (user_id, created_at desc);
create index bulk_jobs_status_idx on public.bulk_jobs (status) where status in ('pending', 'running');

-- ============================================================================
-- public.bulk_job_items — individual CSV rows
-- ============================================================================
create table public.bulk_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.bulk_jobs(id) on delete cascade,
  document_hash text not null,
  document_type text not null check (document_type in ('cpf', 'cnpj')),
  document_preview text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'found', 'clean', 'error')),
  result_count integer not null default 0,
  error_message text,
  processed_at timestamptz
);

create index bulk_job_items_job_idx on public.bulk_job_items (job_id, status);

-- ============================================================================
-- public.audit_log — append-only, retained 30 days, includes IP
-- ============================================================================
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  action text not null check (action in (
    'login',
    'logout',
    'search_single',
    'search_bulk_item',
    'bulk_job_created',
    'export_csv'
  )),
  search_type text check (search_type in ('cpf', 'cnpj', 'name')),
  document_hash text,
  result_count integer,
  ip inet,
  user_agent text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_user_created_idx on public.audit_log (user_id, created_at desc);

comment on table public.audit_log is
  'Append-only audit trail. Operators can read their own rows; '
  'service_role writes only. Purged after 30 days via pg_cron.';
