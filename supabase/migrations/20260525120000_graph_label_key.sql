-- ============================================================================
-- graph_label_key — Vault key for graph_nodes.encrypted_label
--
-- Idempotent: skips creation if the secret already exists. Mirrors the block
-- in scripts/bootstrap-vault.sql so prod environments that ran the migrations
-- without the manual bootstrap step still get the key.
-- ============================================================================

do $graph_label_key$
begin
  if not exists (select 1 from vault.secrets where name = 'graph_label_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'graph_label_key',
      'Encryption key for graph_nodes.encrypted_label'
    );
    raise notice 'graph_label_key created.';
  else
    raise notice 'graph_label_key already exists, skipping.';
  end if;
end
$graph_label_key$;
