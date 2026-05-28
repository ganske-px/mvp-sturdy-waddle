import type { PredictusProcess } from '@/lib/predictus/types.ts';

export type NodeType = 'cpf' | 'cnpj' | 'lawyer';

export type EdgeKind =
  | 'co_party'
  | 'client_lawyer'
  | 'lawyer_lawyer'
  | 'corporate_relation'
  | 'family_relation';

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
  risk?: { isPep: boolean; hasSanction: boolean };
};

export type ProcessEdgeEvidence = {
  processNumber: string;
  samePolo: boolean | null;
};

export type CorporateEdgeEvidence = {
  vinculo: string;
  percentualParticipacao?: number;
  dataInicioRelacionamento?: string;
  dataFimRelacionamento?: string;
  source: 'empresas-relacionadas-cpf' | 'pessoas-relacionadas-cnpj';
};

export type FamilyEdgeEvidence = {
  tipoRelacionamento: string;
  nivel?: string;
  source: 'pessoas-relacionadas-cpf';
};

export type ExtractedEdge =
  | {
      sourceHash: string;
      targetHash: string;
      kind: 'co_party' | 'client_lawyer' | 'lawyer_lawyer';
      evidence: ProcessEdgeEvidence;
    }
  | {
      sourceHash: string;
      targetHash: string;
      kind: 'corporate_relation';
      evidence: CorporateEdgeEvidence;
    }
  | {
      sourceHash: string;
      targetHash: string;
      kind: 'family_relation';
      evidence: FamilyEdgeEvidence;
    };

// The extractor emits one ExtractedEdge per process observation. The writer
// collapses multiple ExtractedEdges with the same (source, target, kind) into
// a single graph_edges row whose stored `evidence` jsonb is the plural shape
// below (set-union of processNumbers, occurrences count).
export type ExtractedGraph = {
  nodes: ExtractedNode[];
  edges: ExtractedEdge[];
};

export type StoredEdgeEvidence =
  | { processNumbers: string[]; samePolo: boolean | null; occurrences: number }
  | CorporateEdgeEvidence
  | FamilyEdgeEvidence;

export type ExtractGraphInput = {
  payload: PredictusProcess[];
  searchedHash: string;
};
