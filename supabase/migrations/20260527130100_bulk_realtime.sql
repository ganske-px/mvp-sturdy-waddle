-- ============================================================================
-- Realtime para o acompanhamento de bulk job (/bulk/[jobId]).
--
-- bulk_jobs e bulk_job_items nunca foram adicionadas ao publication
-- supabase_realtime — o componente JobProgress assinava postgres_changes mas
-- nunca recebia eventos. Aqui publicamos as duas e marcamos REPLICA IDENTITY
-- FULL: o JobProgress depende de eventos UPDATE (status do job e dos itens) sob
-- RLS, e UPDATE/DELETE sob RLS só é entregue com a linha antiga completa.
-- Ver o invariante de realtime + RLS em CLAUDE.md.
--
-- Append-only: novo arquivo, nunca editar os anteriores.
-- ============================================================================

alter table public.bulk_jobs replica identity full;
alter table public.bulk_job_items replica identity full;

alter publication supabase_realtime add table public.bulk_jobs;
alter publication supabase_realtime add table public.bulk_job_items;
