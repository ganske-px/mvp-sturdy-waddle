-- ============================================================================
-- Encryption helpers for graph_nodes.encrypted_label
--
-- Mirrors predictus_cache crypto helpers; bound to 'graph_label_key'.
-- These functions are SECURITY DEFINER so RPC callers don't need direct
-- access to the Vault. The owning role (postgres) is the only one that can
-- read vault.decrypted_secrets.
-- ============================================================================

create or replace function public.encrypt_graph_label(plaintext text)
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
  where name = 'graph_label_key'
  limit 1;

  if k is null then
    raise exception 'Vault secret graph_label_key not found';
  end if;

  return extensions.pgp_sym_encrypt(plaintext, k);
end;
$$;

create or replace function public.decrypt_graph_label(ciphertext bytea)
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
  where name = 'graph_label_key'
  limit 1;

  if k is null then
    raise exception 'Vault secret graph_label_key not found';
  end if;

  return extensions.pgp_sym_decrypt(ciphertext, k);
end;
$$;

revoke all on function public.encrypt_graph_label(text) from public, anon, authenticated;
revoke all on function public.decrypt_graph_label(bytea) from public, anon, authenticated;
-- Only service_role calls these via RPC.
grant execute on function public.encrypt_graph_label(text) to service_role;
grant execute on function public.decrypt_graph_label(bytea) to service_role;
