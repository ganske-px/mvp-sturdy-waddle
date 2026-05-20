-- ============================================================================
-- bootstrap-vault.sql
--
-- Creates (idempotent) the Vault secret that backs encrypt_payload /
-- decrypt_payload. Run once per environment (local, staging, production).
--
--   Local : psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" -f scripts/bootstrap-vault.sql
--   Hosted: Studio → SQL editor, paste this file, Run.
--
-- The script is safe to run multiple times — it only inserts if the secret
-- does not already exist.
-- ============================================================================

do $bootstrap$
begin
  if not exists (select 1 from vault.secrets where name = 'predictus_cache_key') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'base64'),
      'predictus_cache_key',
      'Encryption key for predictus_cache.encrypted_payload and bulk_job_items.document_encrypted'
    );
    raise notice 'predictus_cache_key created.';
  else
    raise notice 'predictus_cache_key already exists, skipping.';
  end if;
end;
$bootstrap$;
