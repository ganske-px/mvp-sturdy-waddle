-- ============================================================================
-- Adds 'family_relation' to graph_edges.kind and teaches upsert_graph to store
-- its jsonb evidence verbatim (same overwrite path as corporate_relation).
-- Family edges come from the Netrin slug pessoas-relacionadas-cpf: root CPF →
-- related person CPF, evidence = { tipoRelacionamento, nivel?, source }.
-- ============================================================================

-- ----- graph_edges.kind -----------------------------------------------------
alter table public.graph_edges drop constraint graph_edges_kind_check;
alter table public.graph_edges add constraint graph_edges_kind_check
  check (kind in (
    'co_party','client_lawyer','lawyer_lawyer','corporate_relation','family_relation'
  ));

-- ----- upsert_graph: accept family_relation as polymorphic-evidence edge -----
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
begin
  -- Nodes
  if jsonb_typeof(nodes_in) = 'array' then
    for n in select * from jsonb_array_elements(nodes_in) loop
      insert into public.graph_nodes (
        node_hash, node_type, encrypted_label, masked_preview
      )
      values (
        n->>'node_hash',
        n->>'node_type',
        decode(n->>'encrypted_label_b64', 'base64'),
        n->>'masked_preview'
      )
      on conflict (node_hash) do update
        set last_seen_at = now();
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
          set evidence = excluded.evidence,
              last_seen_at = now();
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
          e->>'source_hash',
          e->>'target_hash',
          k,
          jsonb_build_object(
            'processNumbers', process_numbers,
            'samePolo', same_polo_val,
            'occurrences', occurrences
          )
        )
        on conflict (source_hash, target_hash, kind) do update
          set evidence = jsonb_build_object(
                'processNumbers', process_numbers,
                'samePolo', same_polo_val,
                'occurrences', occurrences
              ),
              last_seen_at = now();
      end if;
    end loop;
  end if;
end;
$$;

revoke all on function public.upsert_graph(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_graph(jsonb, jsonb) to service_role;
