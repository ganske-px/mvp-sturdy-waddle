// lib/graph/path-result.ts
import { findShortestPath } from './path';

export type PathResult = { found: boolean; nodes: string[]; hops: number };

type EdgeLike = { source: string; target: string };

/**
 * Encontra o caminho mais curto entre dois hashes sobre uma lista de arestas
 * não-direcionada e o reduz a um DTO simples (sequência de hashes + nº de
 * saltos). Wrapper puro sobre `findShortestPath` para ser testável sem DB.
 */
export function buildPathResult(edges: EdgeLike[], source: string, target: string): PathResult {
  const path = findShortestPath(edges, source, target);
  if (!path) return { found: false, nodes: [], hops: 0 };
  return { found: true, nodes: path.nodes, hops: path.nodes.length - 1 };
}
