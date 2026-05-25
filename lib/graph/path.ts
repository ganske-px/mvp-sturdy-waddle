type EdgeLike = { source: string; target: string };

export type ShortestPath = {
  nodes: string[];
  edgeIndices: number[];
};

/**
 * BFS shortest path between two node hashes on an undirected edge list.
 * Returns the sequence of nodes and the indices of the edges traversed
 * (so the caller can highlight them), or null when no path exists.
 *
 * Self-loops are silently dropped; ties between equally-short paths are
 * broken by the order edges appear in the input.
 */
export function findShortestPath<E extends EdgeLike>(
  edges: E[],
  source: string,
  target: string,
): ShortestPath | null {
  if (source === target) return { nodes: [source], edgeIndices: [] };

  const adj = new Map<string, Array<{ neighbor: string; edgeIndex: number }>>();
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (!e) continue;
    if (e.source === e.target) continue;
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source)?.push({ neighbor: e.target, edgeIndex: i });
    adj.get(e.target)?.push({ neighbor: e.source, edgeIndex: i });
  }

  if (!adj.has(source) || !adj.has(target)) return null;

  const predecessor = new Map<string, { from: string; edgeIndex: number }>();
  const visited = new Set<string>([source]);
  const queue: string[] = [source];
  let found = false;

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (current === target) {
      found = true;
      break;
    }
    const neighbors = adj.get(current) ?? [];
    for (const { neighbor, edgeIndex } of neighbors) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      predecessor.set(neighbor, { from: current, edgeIndex });
      if (neighbor === target) {
        found = true;
        queue.length = 0;
        break;
      }
      queue.push(neighbor);
    }
  }

  if (!found) return null;

  const nodes: string[] = [target];
  const edgeIndices: number[] = [];
  let cursor = target;
  while (cursor !== source) {
    const pred = predecessor.get(cursor);
    if (!pred) return null;
    nodes.unshift(pred.from);
    edgeIndices.unshift(pred.edgeIndex);
    cursor = pred.from;
  }
  return { nodes, edgeIndices };
}
