// lib/graph/risk-verdict.ts
import { type RiskLevel, findNearestRisk } from '@/lib/graph/nearest-risk';
import { createClient } from '@/lib/supabase/server';

export const RISK_MAX_HOPS = 3;

export type RiskVerdict = {
  level: RiskLevel;
  distance: number;
  targetHash: string | null;
  /** flags do nó arriscado-alvo, para a copy (PEP vs sanção) */
  isPep: boolean;
  hasSanction: boolean;
};

const NO_RISK: RiskVerdict = Object.freeze({
  level: 'none',
  distance: 0,
  targetHash: null,
  isPep: false,
  hasSanction: false,
});

type EdgeRow = { source_hash: string; target_hash: string };
type RiskyRow = { node_hash: string; is_pep: boolean; has_sanction: boolean };

/**
 * Calcula o verdicto de risco por proximidade no grafo inteiro a partir de um
 * documento central. Nunca decifra labels — trafega só hashes e flags booleanas.
 * Carrega todas as arestas (MVP; sem paginação — espelha findPathBetween).
 */
export async function getRiskVerdict(centerHash: string): Promise<RiskVerdict> {
  const supabase = await createClient();

  const { data: riskyRows } = await supabase
    .from('graph_nodes')
    .select('node_hash, is_pep, has_sanction')
    .or('is_pep.eq.true,has_sanction.eq.true')
    .returns<RiskyRow[]>();
  const risky = riskyRows ?? [];
  if (risky.length === 0) return NO_RISK;

  const riskyByHash = new Map(risky.map((r) => [r.node_hash, r] as const));
  const riskyHashes = new Set(riskyByHash.keys());

  const { data: edgeRows } = await supabase
    .from('graph_edges')
    .select('source_hash, target_hash')
    .returns<EdgeRow[]>();
  const edges = (edgeRows ?? []).map((e) => ({ source: e.source_hash, target: e.target_hash }));

  const nearest = findNearestRisk(edges, centerHash, riskyHashes, RISK_MAX_HOPS);
  if (!nearest.found || nearest.targetHash === null) return NO_RISK;

  const target = riskyByHash.get(nearest.targetHash);
  if (!target) return NO_RISK;
  return {
    level: nearest.level,
    distance: nearest.distance,
    targetHash: nearest.targetHash,
    isPep: target.is_pep,
    hasSanction: target.has_sanction,
  };
}
