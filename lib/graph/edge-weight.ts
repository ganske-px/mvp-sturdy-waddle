import type { EdgeKind } from './types';

/** Bônus de peso por tipo de relação extra entre o mesmo par (cada tipo além do primeiro). */
export const W_DIV = 2;

export type MinimalEdge = {
  source: string;
  target: string;
  kind: EdgeKind;
  weight: number;
};

export type ConsolidatedPair = {
  a: string;
  b: string;
  kinds: EdgeKind[];
  /** Soma das forças (edge.weight) das arestas do par. */
  multiplicity: number;
  /** Nº de tipos distintos ligando o par. */
  diversity: number;
  /** multiplicity + W_DIV*(diversity-1). */
  weight: number;
  dominantKind: EdgeKind;
};

// Maior rank = mais evidente. co_party fica no topo porque pode ser adversarial
// (o canvas distingue mesmo/oposto pela evidência ao escolher a cor final).
const KIND_RANK: Record<EdgeKind, number> = {
  co_party: 5,
  corporate_relation: 4,
  family_relation: 3,
  client_lawyer: 2,
  lawyer_lawyer: 1,
};

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

export function dominantKind(kinds: EdgeKind[]): EdgeKind {
  return kinds.reduce(
    (best, k) => (KIND_RANK[k] > KIND_RANK[best] ? k : best),
    kinds[0] as EdgeKind,
  );
}

export function consolidatePairs(edges: MinimalEdge[]): Map<string, ConsolidatedPair> {
  const acc = new Map<
    string,
    { a: string; b: string; kinds: Set<EdgeKind>; multiplicity: number }
  >();
  for (const e of edges) {
    if (e.source === e.target) continue;
    const a = e.source < e.target ? e.source : e.target;
    const b = e.source < e.target ? e.target : e.source;
    const key = `${a}__${b}`;
    const cur = acc.get(key) ?? { a, b, kinds: new Set<EdgeKind>(), multiplicity: 0 };
    cur.kinds.add(e.kind);
    cur.multiplicity += Math.max(1, e.weight);
    acc.set(key, cur);
  }
  const out = new Map<string, ConsolidatedPair>();
  for (const [key, v] of acc) {
    const kinds = [...v.kinds];
    const diversity = kinds.length;
    out.set(key, {
      a: v.a,
      b: v.b,
      kinds,
      multiplicity: v.multiplicity,
      diversity,
      weight: v.multiplicity + W_DIV * (diversity - 1),
      dominantKind: dominantKind(kinds),
    });
  }
  return out;
}

export function pairStrokeWidth(weight: number, diversity: number): number {
  const w = 1 + 1.2 * Math.log2(weight + 1) + 0.6 * (diversity - 1);
  return Math.min(8, Math.max(1, w));
}

export function nodeScale(weight: number): number {
  return Math.min(1.8, Math.max(1, 1 + 0.15 * Math.log2(weight + 1)));
}
