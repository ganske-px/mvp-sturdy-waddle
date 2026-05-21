-- ============================================================================
-- upsert_graph: atomic write path used by lib/graph/writer.ts
-- nodes_in :  jsonb array of { node_hash, node_type, encrypted_label_b64, masked_preview }
-- edges_in :  jsonb array of { source_hash, target_hash, kind, process_number, same_polo }
--
-- Nodes are upserted first (so foreign keys hold). Edges are then upserted with
-- evidence merging done in plpgsql.
-- ============================================================================

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
  existing_evidence jsonb;
  process_numbers jsonb;
  same_polo_val jsonb;
  occurrences int;
begin
  -- Nodes ---------------------------------------------------------------------
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

  -- Edges ---------------------------------------------------------------------
  if jsonb_typeof(edges_in) = 'array' then
    for e in select * from jsonb_array_elements(edges_in) loop
      -- Read current evidence if the row exists
      select evidence into existing_evidence
      from public.graph_edges
      where source_hash = e->>'source_hash'
        and target_hash = e->>'target_hash'
        and kind        = e->>'kind';

      if existing_evidence is null then
        process_numbers := jsonb_build_array(e->>'process_number');
        occurrences := 1;
      else
        -- Set-union the process number
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

      insert into public.graph_edges (
        source_hash, target_hash, kind, evidence
      )
      values (
        e->>'source_hash',
        e->>'target_hash',
        e->>'kind',
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
    end loop;
  end if;
end;
$$;

revoke all on function public.upsert_graph(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_graph(jsonb, jsonb) to service_role;
