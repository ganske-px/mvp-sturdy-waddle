-- ============================================================================
-- Encryption helpers for predictus_cache.encrypted_payload
--
-- Uses pgcrypto symmetric encryption (PGP). The key lives in Supabase Vault
-- under name 'predictus_cache_key'. To populate it after `supabase start`:
--
--   select vault.create_secret(
--     '<base64-random-32-bytes>',
--     'predictus_cache_key',
--     'Encryption key for predictus_cache.encrypted_payload'
--   );
--
-- These functions are SECURITY DEFINER so RPC callers don't need direct
-- access to the Vault. The owning role (postgres) is the only one that can
-- read vault.decrypted_secrets.
-- ============================================================================

create or replace function public.encrypt_payload(plaintext text)
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
  where name = 'predictus_cache_key'
  limit 1;

  if k is null then
    raise exception 'Vault secret predictus_cache_key not found';
  end if;

  return extensions.pgp_sym_encrypt(plaintext, k);
end;
$$;

create or replace function public.decrypt_payload(ciphertext bytea)
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
  where name = 'predictus_cache_key'
  limit 1;

  if k is null then
    raise exception 'Vault secret predictus_cache_key not found';
  end if;

  return extensions.pgp_sym_decrypt(ciphertext, k);
end;
$$;

revoke all on function public.encrypt_payload(text) from public, anon, authenticated;
revoke all on function public.decrypt_payload(bytea) from public, anon, authenticated;
-- Only service_role calls these via RPC.
grant execute on function public.encrypt_payload(text) to service_role;
grant execute on function public.decrypt_payload(bytea) to service_role;
