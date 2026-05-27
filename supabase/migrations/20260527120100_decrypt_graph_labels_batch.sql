-- ============================================================================
-- decrypt_graph_labels: versão em lote de decrypt_graph_label. Recebe um array
-- de ciphertexts (bytea como '\x...') e devolve os plaintexts na mesma ordem.
-- Reduz N round-trips PostgREST a 1 no carregamento da rede. service_role only.
-- ============================================================================
create or replace function public.decrypt_graph_labels(ciphertexts text[])
returns text[]
language plpgsql
security definer
-- Sem 'vault' no search_path: esta função não lê o vault diretamente; delega a
-- public.decrypt_graph_label (security definer, com vault no próprio search_path).
set search_path = public, extensions
as $$
declare
  result text[] := '{}';
  c text;
begin
  foreach c in array ciphertexts loop
    result := array_append(result, public.decrypt_graph_label(c::bytea));
  end loop;
  return result;
end;
$$;

revoke all on function public.decrypt_graph_labels(text[]) from public, anon, authenticated;
grant execute on function public.decrypt_graph_labels(text[]) to service_role;
