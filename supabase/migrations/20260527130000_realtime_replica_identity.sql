-- ============================================================================
-- REPLICA IDENTITY FULL nas tabelas com RLS que alimentam o realtime.
--
-- O Supabase Realtime NÃO entrega eventos UPDATE/DELETE de tabelas com RLS
-- quando a replica identity é a default (apenas a PK): para avaliar as policies
-- sobre o registro *antigo* da mudança, o Realtime precisa da linha completa.
-- Sem REPLICA IDENTITY FULL o evento é descartado antes de chegar ao cliente.
--
-- A tela /search/result/[hash] depende de eventos UPDATE para atualizar sozinha:
--   searches        : status pending -> completed/failed (Predictus async)
--   enrichment_jobs : status pending -> running -> completed/partial (antifraude)
-- enrichment_job_calls é dirigida por INSERT (que não precisa de full), mas
-- marcamos FULL por consistência — a tela atualiza com QUALQUER fornecedor.
--
-- Append-only: novo arquivo, nunca editar os anteriores.
-- ============================================================================

alter table public.searches replica identity full;
alter table public.enrichment_jobs replica identity full;
alter table public.enrichment_job_calls replica identity full;
