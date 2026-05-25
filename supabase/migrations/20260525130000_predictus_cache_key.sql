-- ============================================================================
-- predictus_cache_key — Vault key backing encrypt_payload / decrypt_payload
--
-- Idempotent: skips creation if the secret already exists. Mirrors the block
-- in scripts/bootstrap-vault.sql so prod environments that ran the migrations
-- without the manual bootstrap step still get the key.
--
-- Without this key, every cache write fails silently inside the try/catch in
-- searchPerson/searchByCnpj, the operator sees a fresh result but the row
-- never persists, and the History view has nothing to reopen.
-- ============================================================================

do $predictus_cache_key$
begin
  if not exists (select 1 from vault.secrets where name = 'predictus_cache_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'predictus_cache_key',
      'Encryption key for predictus_cache.encrypted_payload and bulk_job_items.document_encrypted'
    );
    raise notice 'predictus_cache_key created.';
  else
    raise notice 'predictus_cache_key already exists, skipping.';
  end if;
end
$predictus_cache_key$;
