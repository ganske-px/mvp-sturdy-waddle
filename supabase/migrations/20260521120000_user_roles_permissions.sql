-- ============================================================================
-- 20260521120000_user_roles_permissions.sql
-- Adds two-role model (admin / operator), is_active flag, per-user service
-- permissions table, and SQL helpers used by RLS, proxy and lib/auth.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- public.users: role + is_active
-- ----------------------------------------------------------------------------
alter table public.users
  add column role text not null default 'operator'
    check (role in ('admin', 'operator')),
  add column is_active boolean not null default true;

create index users_active_role_idx on public.users (is_active, role);

comment on column public.users.role is
  'Two-role model. Admins always have all service permissions via helpers.';
comment on column public.users.is_active is
  'Soft-delete flag. Inactive users are blocked by the proxy. UI never deletes.';

-- ----------------------------------------------------------------------------
-- public.user_service_permissions
--   row present = permission granted; missing row = denied.
--   service vocabulary is extensible by widening the CHECK.
-- ----------------------------------------------------------------------------
create table public.user_service_permissions (
  user_id uuid not null references public.users(id) on delete cascade,
  service text not null check (service in (
    'search_person', 'search_company', 'search_bulk'
  )),
  granted_at timestamptz not null default now(),
  granted_by uuid references public.users(id) on delete set null,
  primary key (user_id, service)
);

create index user_service_permissions_user_idx
  on public.user_service_permissions (user_id);

alter table public.user_service_permissions enable row level security;

comment on table public.user_service_permissions is
  'Per-user grants for callable services. Admins bypass this table via helpers.';

-- ----------------------------------------------------------------------------
-- Helper: is_admin(uid)
-- ----------------------------------------------------------------------------
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = uid and role = 'admin' and is_active = true
  );
$$;

comment on function public.is_admin(uuid) is
  'True iff the given user is an active admin. SECURITY DEFINER so RLS '
  'policies and the proxy can call it without recursing into users RLS.';

-- ----------------------------------------------------------------------------
-- Helper: has_service_permission(uid, svc)
-- ----------------------------------------------------------------------------
create or replace function public.has_service_permission(uid uuid, svc text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users u
    where u.id = uid
      and u.is_active = true
      and (
        u.role = 'admin'
        or exists (
          select 1 from public.user_service_permissions p
          where p.user_id = uid and p.service = svc
        )
      )
  );
$$;

comment on function public.has_service_permission(uuid, text) is
  'Single source of truth: admin OR explicit grant, gated by is_active.';

-- ----------------------------------------------------------------------------
-- Expand audit_log.action vocabulary
-- ----------------------------------------------------------------------------
alter table public.audit_log drop constraint audit_log_action_check;

alter table public.audit_log
  add constraint audit_log_action_check
  check (action in (
    'login',
    'logout',
    'search_single',
    'search_bulk_item',
    'bulk_job_created',
    'export_csv',
    'admin_user_created',
    'admin_user_set_active',
    'admin_user_set_role',
    'admin_user_permission_changed'
  ));
