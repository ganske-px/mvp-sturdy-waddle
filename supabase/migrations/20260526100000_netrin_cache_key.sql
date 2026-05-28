-- ============================================================================
-- netrin_cache_key — Vault key backing encrypt_netrin / decrypt_netrin
-- Mantida separada de predictus_cache_key (defesa em profundidade: vazamento
-- de uma chave não compromete o payload protegido pela outra).
-- ============================================================================

do $netrin_cache_key$
begin
  if not exists (select 1 from vault.secrets where name = 'netrin_cache_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'netrin_cache_key',
      'Encryption key for netrin_cache.encrypted_payload'
    );
    raise notice 'netrin_cache_key created.';
  else
    raise notice 'netrin_cache_key already exists, skipping.';
  end if;
end
$netrin_cache_key$;
