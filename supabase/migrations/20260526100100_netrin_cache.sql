-- ============================================================================
-- netrin_cache: shared, 30-day TTL, encrypted via netrin_cache_key
-- ============================================================================

create table public.netrin_cache (
  document_hash     text primary key,
  document_type     text not null check (document_type in ('cpf','cnpj')),
  encrypted_payload bytea not null,
  slugs_fetched     text[] not null,
  fetched_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '30 days')
);

comment on table public.netrin_cache is
  'Shared encrypted Netrin consulta-composta payloads, 30-day TTL. document_hash '
  'reuses hashDocument(cpf|cnpj, value). Encrypted via vault key netrin_cache_key.';

create index netrin_cache_expires_idx on public.netrin_cache (expires_at);

alter table public.netrin_cache enable row level security;

create policy netrin_cache_read_authenticated on public.netrin_cache
  for select using (auth.role() = 'authenticated');

-- Mirrors encrypt_payload / encrypt_graph_label pattern exactly:
-- decrypted_secret is used directly as the pgp_sym_encrypt passphrase.
-- No base64→hex conversion needed — pgcrypto accepts any string as passphrase.
create or replace function public.encrypt_netrin(plaintext text)
returns bytea
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  k text;
begin
  select decrypted_secret into k
  from vault.decrypted_secrets
  where name = 'netrin_cache_key'
  limit 1;

  if k is null then
    raise exception 'Vault secret netrin_cache_key not found';
  end if;

  return extensions.pgp_sym_encrypt(plaintext, k);
end;
$$;

create or replace function public.decrypt_netrin(ciphertext bytea)
returns text
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  k text;
begin
  select decrypted_secret into k
  from vault.decrypted_secrets
  where name = 'netrin_cache_key'
  limit 1;

  if k is null then
    raise exception 'Vault secret netrin_cache_key not found';
  end if;

  return extensions.pgp_sym_decrypt(ciphertext, k);
end;
$$;

revoke all on function public.encrypt_netrin(text) from public, anon, authenticated;
revoke all on function public.decrypt_netrin(bytea) from public, anon, authenticated;
-- Only service_role calls these via RPC.
grant execute on function public.encrypt_netrin(text) to service_role;
grant execute on function public.decrypt_netrin(bytea) to service_role;
