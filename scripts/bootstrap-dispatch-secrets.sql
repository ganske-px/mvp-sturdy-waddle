-- ============================================================================
-- bootstrap-dispatch-secrets.sql
--
-- Popula (idempotente) os segredos de dispatch que o trigger pg_net em
-- enrichment_jobs consome para chamar a Edge Function process-enrichment-job.
--
-- Pré-requisitos:
--   1. Migration 20260526110000_enrichment_pgnet_dispatch.sql aplicada
--   2. Vault habilitado (default no Supabase)
--
-- Como rodar:
--   # Local (Supabase CLI):
--   psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" \
--     -v dispatch_url="'http://host.docker.internal:54321/functions/v1/process-enrichment-job'" \
--     -v dispatch_token="'<seu SUPABASE_SECRET_KEY local>'" \
--     -f scripts/bootstrap-dispatch-secrets.sql
--
--   # Hosted (Studio → SQL editor):
--     Substitua :dispatch_url e :dispatch_token pelos valores literais e cole.
--     URL: https://<project-ref>.supabase.co/functions/v1/process-enrichment-job
--     Token: a service-role / SUPABASE_SECRET_KEY do projeto
--
-- Re-roda sem efeitos colaterais — se o segredo já existe, atualiza o valor
-- via vault.update_secret. Caso contrário, vault.create_secret.
-- ============================================================================

do $dispatch_url$
declare
  v_existing uuid;
begin
  select id into v_existing from vault.secrets where name = 'enrichment_dispatch_url' limit 1;
  if v_existing is null then
    perform vault.create_secret(
      :'dispatch_url',
      'enrichment_dispatch_url',
      'Edge Function URL chamada pelo trigger pg_net em enrichment_jobs'
    );
    raise notice 'enrichment_dispatch_url created.';
  else
    perform vault.update_secret(v_existing, :'dispatch_url');
    raise notice 'enrichment_dispatch_url updated.';
  end if;
end
$dispatch_url$;

do $dispatch_token$
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
$dispatch_token$;
