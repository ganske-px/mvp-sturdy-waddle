-- ============================================================================
-- Risk flags no nó do grafo: is_pep / has_sanction (booleanas, em claro — sem
-- detalhe pessoal sensível). Preenchidas só pela fonte antifraude (Netrin).
-- upsert_graph passa a aceitar flags opcionais por nó com semântica "só sobe"
-- (OR): uma escrita Predictus (sem flags) nunca rebaixa um nó já marcado.
-- ============================================================================

alter table public.graph_nodes
  add column if not exists is_pep boolean not null default false,
  add column if not exists has_sanction boolean not null default false,
  add column if not exists risk_updated_at timestamptz;

create or replace function public.upsert_graph(
  nodes_in jsonb,
  edges_in jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  n jsonb;
  e jsonb;
  k text;
  existing_evidence jsonb;
  process_numbers jsonb;
  same_polo_val jsonb;
  occurrences int;
  jsonb_evidence jsonb;
  in_pep boolean;
  in_sanction boolean;
begin
  -- Nodes
  if jsonb_typeof(nodes_in) = 'array' then
    for n in select * from jsonb_array_elements(nodes_in) loop
      in_pep := coalesce((n->>'is_pep')::boolean, false);
      in_sanction := coalesce((n->>'has_sanction')::boolean, false);
      insert into public.graph_nodes (
        node_hash, node_type, encrypted_label, masked_preview,
        is_pep, has_sanction,
        risk_updated_at
      )
      values (
        n->>'node_hash',
        n->>'node_type',
        decode(n->>'encrypted_label_b64', 'base64'),
        n->>'masked_preview',
        in_pep, in_sanction,
        case when (n ? 'is_pep') or (n ? 'has_sanction') then now() else null end
      )
      on conflict (node_hash) do update
        set last_seen_at = now(),
            is_pep = public.graph_nodes.is_pep or in_pep,
            has_sanction = public.graph_nodes.has_sanction or in_sanction,
            risk_updated_at = case
              when (n ? 'is_pep') or (n ? 'has_sanction') then now()
              else public.graph_nodes.risk_updated_at
            end;
    end loop;
  end if;

  -- Edges
  if jsonb_typeof(edges_in) = 'array' then
    for e in select * from jsonb_array_elements(edges_in) loop
      k := e->>'kind';
      if k in ('corporate_relation', 'family_relation') then
        jsonb_evidence := coalesce(e->'evidence', '{}'::jsonb);
        insert into public.graph_edges (source_hash, target_hash, kind, evidence)
        values (e->>'source_hash', e->>'target_hash', k, jsonb_evidence)
        on conflict (source_hash, target_hash, kind) do update
          set evidence = excluded.evidence, last_seen_at = now();
      else
        select evidence into existing_evidence
        from public.graph_edges
        where source_hash = e->>'source_hash'
          and target_hash = e->>'target_hash'
          and kind        = k;
        if existing_evidence is null then
          process_numbers := jsonb_build_array(e->>'process_number');
          occurrences := 1;
        else
          process_numbers := coalesce(existing_evidence->'processNumbers', '[]'::jsonb);
          if not (process_numbers @> jsonb_build_array(e->>'process_number')) then
            process_numbers := process_numbers || jsonb_build_array(e->>'process_number');
          end if;
          occurrences := jsonb_array_length(process_numbers);
        end if;
        same_polo_val := case
          when e ? 'same_polo' and (e->'same_polo') is not null then e->'same_polo'
          else 'null'::jsonb
        end;
        insert into public.graph_edges (source_hash, target_hash, kind, evidence)
        values (
          e->>'source_hash', e->>'target_hash', k,
          jsonb_build_object('processNumbers', process_numbers, 'samePolo', same_polo_val, 'occurrences', occurrences)
        )
        on conflict (source_hash, target_hash, kind) do update
          set evidence = jsonb_build_object('processNumbers', process_numbers, 'samePolo', same_polo_val, 'occurrences', occurrences),
              last_seen_at = now();
      end if;
    end loop;
  end if;
end;
$$;

revoke all on function public.upsert_graph(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_graph(jsonb, jsonb) to service_role;
