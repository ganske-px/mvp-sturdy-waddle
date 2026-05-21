'use server';

import { requirePermission } from '@/lib/auth/permissions';
import type { EdgeKind, GraphNodeLabel, NodeType } from '@/lib/graph/types';

export type GraphNodeDto = {
  hash: string;
  type: NodeType;
  label: GraphNodeLabel;
  maskedPreview: string;
  inCache: boolean;
  lastSeenAt: string;
};

export type GraphEdgeDto = {
  source: string;
  target: string;
  kind: EdgeKind;
  evidence: { processNumbers: string[]; samePolo: boolean | null; occurrences: number };
  lastSeenAt: string;
};

export type SubgraphDto = {
  center: GraphNodeDto | null;
  neighbors: GraphNodeDto[];
  edges: GraphEdgeDto[];
};

export async function getSubgraph(_centerHash: string): Promise<SubgraphDto> {
  await requirePermission('search_network');
  // Implemented in T13.
  return { center: null, neighbors: [], edges: [] };
}
