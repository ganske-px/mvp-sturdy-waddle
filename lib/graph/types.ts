import type { PredictusProcess } from '@/lib/predictus/types';

export type NodeType = 'cpf' | 'cnpj' | 'lawyer';

export type EdgeKind = 'co_party' | 'client_lawyer' | 'lawyer_lawyer';

export type GraphNodeLabel = {
  name?: string;
  document?: string;
  oab?: { uf: string; numero: string };
};

export type ExtractedNode = {
  nodeHash: string;
  nodeType: NodeType;
  label: GraphNodeLabel;
  maskedPreview: string;
};

export type ExtractedEdge = {
  sourceHash: string;
  targetHash: string;
  kind: EdgeKind;
  evidence: { processNumber: string; samePolo: boolean | null };
};

// The extractor emits one ExtractedEdge per process observation. The writer
// collapses multiple ExtractedEdges with the same (source, target, kind) into
// a single graph_edges row whose stored `evidence` jsonb is the plural shape
// below (set-union of processNumbers, occurrences count).
export type ExtractedGraph = {
  nodes: ExtractedNode[];
  edges: ExtractedEdge[];
};

export type StoredEdgeEvidence = {
  processNumbers: string[];
  samePolo: boolean | null;
  occurrences: number;
};

export type ExtractGraphInput = {
  payload: PredictusProcess[];
  searchedHash: string;
};
