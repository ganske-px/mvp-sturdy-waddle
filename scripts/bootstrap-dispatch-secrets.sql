-- ============================================================================
-- bootstrap-dispatch-secrets.sql
--
-- Popula (idempotente) os segredos de dispatch que os triggers pg_net em
-- enrichment_jobs e searches consomem para chamar as Edge Functions
-- process-enrichment-job (Netrin) e process-predictus-job (Predictus).
--
-- Pré-requisitos:
--   1. Migrations 20260526110000_enrichment_pgnet_dispatch.sql e
--      20260526120000_searches_predictus_dispatch.sql aplicadas
--   2. Vault habilitado (default no Supabase)
--
-- Como rodar (local):
--   psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" \
--     -v enrichment_url="'http://host.docker.internal:54321/functions/v1/process-enrichment-job'" \
--     -v predictus_url="'http://host.docker.internal:54321/functions/v1/process-predictus-job'" \
--     -v dispatch_token="'<SUPABASE_SECRET_KEY local>'" \
--     -f scripts/bootstrap-dispatch-secrets.sql
--
-- Como rodar (hosted via Studio → SQL editor):
--   Substitua :enrichment_url, :predictus_url e :dispatch_token pelos
--   literais e cole.
--     enrichment_url: https://<project-ref>.supabase.co/functions/v1/process-enrichment-job
--     predictus_url:  https://<project-ref>.supabase.co/functions/v1/process-predictus-job
--     dispatch_token: service-role / SUPABASE_SECRET_KEY do projeto
--
-- Re-roda sem efeitos colaterais — se o segredo já existe, atualiza o valor
-- via vault.update_secret. Caso contrário, vault.create_secret.
--
-- Notas:
--   - O token é o mesmo (service-role) para os dois dispatches; mantemos
--     dois segredos só por simetria de nomenclatura e para permitir rotação
--     independente futura, se quisermos.
-- ============================================================================

-- enrichment_dispatch_url
do $enrichment_url$
declare
  v_existing uuid;
begin
  select id into v_existing from vault.secrets where name = 'enrichment_dispatch_url' limit 1;
  if v_existing is null then
    perform vault.create_secret(
      :'enrichment_url',
      'enrichment_dispatch_url',
      'Edge Function URL chamada pelo trigger pg_net em enrichment_jobs'
    );
    raise notice 'enrichment_dispatch_url created.';
  else
    perform vault.update_secret(v_existing, :'enrichment_url');
    raise notice 'enrichment_dispatch_url updated.';
  end if;
end
$enrichment_url$;

-- predictus_dispatch_url
do $predictus_url$
declare
  v_existing uuid;
begin
  select id into v_existing from vault.secrets where name = 'predictus_dispatch_url' limit 1;
  if v_existing is null then
    perform vault.create_secret(
      :'predictus_url',
      'predictus_dispatch_url',
      'Edge Function URL chamada pelo trigger pg_net em searches'
    );
    raise notice 'predictus_dispatch_url created.';
  else
    perform vault.update_secret(v_existing, :'predictus_url');
    raise notice 'predictus_dispatch_url updated.';
  end if;
end
$predictus_url$;

-- enrichment_dispatch_token
do $enrichment_token$
declare
  v_existing uuid;
begin
  select id into v_existing from vault.secrets where name = 'enrichment_dispatch_token' limit 1;
  if v_existing is null then
    perform vault.create_secret(
      :'dispatch_token',
      'enrichment_dispatch_token',
      'Bearer token (service-role key) usado no header Authorization do dispatch'
    );
    raise notice 'enrichment_dispatch_token created.';
  else
    perform vault.update_secret(v_existing, :'dispatch_token');
    raise notice 'enrichment_dispatch_token updated.';
  end if;
end
$enrichment_token$;

-- predictus_dispatch_token
do $predictus_token$
declare
  v_existing uuid;
begin
  select id into v_existing from vault.secrets where name = 'predictus_dispatch_token' limit 1;
  if v_existing is null then
    perform vault.create_secret(
      :'dispatch_token',
      'predictus_dispatch_token',
      'Bearer token (service-role key) usado no header Authorization do dispatch Predictus'
    );
    raise notice 'predictus_dispatch_token created.';
  else
    perform vault.update_secret(v_existing, :'dispatch_token');
    raise notice 'predictus_dispatch_token updated.';
  end if;
end
$predictus_token$;
