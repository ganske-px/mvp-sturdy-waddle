import { createClient } from '@/lib/supabase/server';
import type { EdgeKind, NodeType } from './types';

export type SubgraphStats = {
  nodes: number;
  edges: number;
  people: number;
  companies: number;
  familyEdges: number;
  corporateEdges: number;
  processEdges: number;
};

export function deriveSubgraphStats(
  centerHash: string,
  neighbors: { node_hash: string; node_type: NodeType }[],
  edges: { kind: EdgeKind }[],
): SubgraphStats {
  const uniqueNeighbors = new Map<string, NodeType>();
  for (const n of neighbors) {
    if (n.node_hash !== centerHash) uniqueNeighbors.set(n.node_hash, n.node_type);
  }

  let people = 0;
  let companies = 0;
  for (const type of uniqueNeighbors.values()) {
    if (type === 'cpf') people++;
    else if (type === 'cnpj') companies++;
  }

  let familyEdges = 0;
  let corporateEdges = 0;
  let processEdges = 0;
  for (const e of edges) {
    if (e.kind === 'family_relation') familyEdges++;
    else if (e.kind === 'corporate_relation') corporateEdges++;
    else processEdges++; // co_party | client_lawyer | lawyer_lawyer
  }

  return {
    nodes: uniqueNeighbors.size,
    edges: edges.length,
    people,
    companies,
    familyEdges,
    corporateEdges,
    processEdges,
  };
}

type EdgeRow = { source_hash: string; target_hash: string; kind: EdgeKind };
type NodeRow = { node_hash: string; node_type: NodeType };

/**
 * Lightweight 1-hop stats for the result-page network rail. Unlike getSubgraph,
 * it never decrypts labels — only counts node types and edge kinds. RLS allows
 * any authenticated operator to read graph_nodes/graph_edges, so it uses the
 * cookie-aware server client.
 */
export async function getSubgraphStats(centerHash: string): Promise<SubgraphStats> {
  const supabase = await createClient();

  const { data: edgeRows } = await supabase
    .from('graph_edges')
    .select('source_hash, target_hash, kind')
    .or(`source_hash.eq.${centerHash},target_hash.eq.${centerHash}`)
    .returns<EdgeRow[]>();

  const edges = edgeRows ?? [];
  const neighborHashes = Array.from(
    new Set(edges.flatMap((e) => [e.source_hash, e.target_hash]).filter((h) => h !== centerHash)),
  );

  let neighbors: NodeRow[] = [];
  if (neighborHashes.length > 0) {
    const { data } = await supabase
      .from('graph_nodes')
      .select('node_hash, node_type')
      .in('node_hash', neighborHashes)
      .returns<NodeRow[]>();
    neighbors = data ?? [];
  }

  return deriveSubgraphStats(
    centerHash,
    neighbors,
    edges.map((e) => ({ kind: e.kind })),
  );
}
