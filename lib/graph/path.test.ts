import { describe, expect, it } from 'vitest';
import { findShortestPath } from './path';

const e = (source: string, target: string) => ({ source, target });

describe('findShortestPath', () => {
  it('returns empty path when source equals target', () => {
    expect(findShortestPath([], 'A', 'A')).toEqual({ nodes: ['A'], edgeIndices: [] });
  });

  it('returns null when no edges exist between distinct nodes', () => {
    expect(findShortestPath([], 'A', 'B')).toBeNull();
  });

  it('finds a direct edge', () => {
    const edges = [e('A', 'B')];
    expect(findShortestPath(edges, 'A', 'B')).toEqual({ nodes: ['A', 'B'], edgeIndices: [0] });
  });

  it('treats edges as undirected', () => {
    const edges = [e('A', 'B')];
    expect(findShortestPath(edges, 'B', 'A')).toEqual({ nodes: ['B', 'A'], edgeIndices: [0] });
  });

  it('finds a 2-hop path', () => {
    const edges = [e('A', 'B'), e('B', 'C')];
    expect(findShortestPath(edges, 'A', 'C')).toEqual({
      nodes: ['A', 'B', 'C'],
      edgeIndices: [0, 1],
    });
  });

  it('returns null when target is unreachable', () => {
    const edges = [e('A', 'B'), e('C', 'D')];
    expect(findShortestPath(edges, 'A', 'D')).toBeNull();
  });

  it('returns null when source has no edges at all', () => {
    const edges = [e('B', 'C')];
    expect(findShortestPath(edges, 'A', 'C')).toBeNull();
  });

  it('picks the shorter of two paths', () => {
    const edges = [e('A', 'B'), e('B', 'C'), e('C', 'D'), e('A', 'D')];
    const result = findShortestPath(edges, 'A', 'D');
    expect(result?.nodes).toEqual(['A', 'D']);
    expect(result?.edgeIndices).toEqual([3]);
  });

  it('ignores self-loops in the input', () => {
    const edges = [e('A', 'A'), e('A', 'B')];
    expect(findShortestPath(edges, 'A', 'B')).toEqual({
      nodes: ['A', 'B'],
      edgeIndices: [1],
    });
  });

  it('handles many edges efficiently', () => {
    const edges: Array<{ source: string; target: string }> = [];
    for (let i = 0; i < 1000; i++) {
      edges.push(e(`N${i}`, `N${i + 1}`));
    }
    const result = findShortestPath(edges, 'N0', 'N1000');
    expect(result?.nodes).toHaveLength(1001);
    expect(result?.edgeIndices).toHaveLength(1000);
  });

  it('returns a deterministic path among equally-short options', () => {
    // Two paths of length 2: A->B->D and A->C->D
    const edges = [e('A', 'B'), e('A', 'C'), e('B', 'D'), e('C', 'D')];
    const result = findShortestPath(edges, 'A', 'D');
    expect(result?.nodes).toHaveLength(3);
    // BFS visits B before C (edge order), so the path goes through B.
    expect(result?.nodes).toEqual(['A', 'B', 'D']);
  });
});
