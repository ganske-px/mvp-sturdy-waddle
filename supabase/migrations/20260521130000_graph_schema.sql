-- ============================================================================
-- Graph view: graph_nodes / graph_edges + audit and permission extensions
-- ============================================================================

-- public.graph_nodes ---------------------------------------------------------
create table public.graph_nodes (
  node_hash       text primary key,
  node_type       text not null check (node_type in ('cpf','cnpj','lawyer')),
  encrypted_label bytea not null,
  masked_preview  text not null,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);

comment on table public.graph_nodes is
  'Shared graph of entities derived from Predictus payloads. node_hash reuses '
  'hashDocument(cpf|cnpj|lawyer, value). encrypted_label is the JSON shape '
  '{name?, document?, oab?} encrypted via graph_label_key.';

-- public.graph_edges ---------------------------------------------------------
create table public.graph_edges (
  id              uuid primary key default gen_random_uuid(),
  source_hash     text not null references public.graph_nodes(node_hash),
  target_hash     text not null references public.graph_nodes(node_hash),
  kind            text not null check (kind in ('co_party','client_lawyer','lawyer_lawyer')),
  evidence        jsonb not null default '{}'::jsonb,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  unique (source_hash, target_hash, kind)
);

create index graph_edges_source_idx on public.graph_edges (source_hash);
create index graph_edges_target_idx on public.graph_edges (target_hash);

comment on table public.graph_edges is
  'Inferred relationships. co_party and lawyer_lawyer are symmetric: stored once '
  'with source_hash < target_hash. client_lawyer is directional (parte -> advogado).';

-- RLS ------------------------------------------------------------------------
alter table public.graph_nodes enable row level security;
alter table public.graph_edges enable row level security;

-- Authenticated operators can read; writes are service_role only.
create policy graph_nodes_read_authenticated on public.graph_nodes
  for select using (auth.role() = 'authenticated');

create policy graph_edges_read_authenticated on public.graph_edges
  for select using (auth.role() = 'authenticated');

-- Audit actions --------------------------------------------------------------
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in (
    'login','logout','search_single','search_bulk_item',
    'bulk_job_created','export_csv',
    'admin_user_created','admin_user_set_active',
    'admin_user_set_role','admin_user_permission_changed',
    'view_network','expand_network_node'
  ));

-- Service permission vocabulary ---------------------------------------------
alter table public.user_service_permissions drop constraint user_service_permissions_service_check;
alter table public.user_service_permissions add constraint user_service_permissions_service_check
  check (service in ('search_person','search_company','search_bulk','search_network'));
