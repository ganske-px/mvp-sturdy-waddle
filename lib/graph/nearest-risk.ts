// lib/graph/nearest-risk.ts
type EdgeLike = { source: string; target: string };

export type RiskLevel = 'direct' | 'nearby' | 'none';

export type NearestRisk = {
  found: boolean;
  targetHash: string | null;
  distance: number;
  level: RiskLevel;
};

const NOT_FOUND: NearestRisk = Object.freeze({
  found: false,
  targetHash: null,
  distance: 0,
  level: 'none',
});

/**
 * BFS por nível a partir de `centerHash` sobre uma lista de arestas não-direcionada,
 * retornando o primeiro nó em `riskyHashes` alcançado dentro de `maxHops` saltos.
 * O próprio centro (distância 0) nunca conta — só vizinhança alcançável.
 * level: 1 salto = 'direct'; 2..maxHops = 'nearby'; nada = 'none'.
 */
export function findNearestRisk(
  edges: EdgeLike[],
  centerHash: string,
  riskyHashes: Set<string>,
  maxHops: number,
): NearestRisk {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source)?.push(e.target);
    adj.get(e.target)?.push(e.source);
  }

  const visited = new Set<string>([centerHash]);
  let frontier: string[] = [centerHash];
  for (let distance = 1; distance <= maxHops; distance++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const neighbor of adj.get(node) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        if (riskyHashes.has(neighbor)) {
          return {
            found: true,
            targetHash: neighbor,
            distance,
            level: distance === 1 ? 'direct' : 'nearby',
          };
        }
        next.push(neighbor);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return NOT_FOUND;
}
