import { describe, expect, it } from 'vitest';
import { buildPathResult } from './path-result';

describe('buildPathResult', () => {
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'c', target: 'd' },
  ];

  it('retorna a sequência de hashes do caminho mais curto', () => {
    expect(buildPathResult(edges, 'a', 'c')).toEqual({
      found: true,
      nodes: ['a', 'b', 'c'],
      hops: 2,
    });
  });

  it('found=false quando não há caminho', () => {
    expect(buildPathResult([{ source: 'a', target: 'b' }], 'a', 'z')).toEqual({
      found: false,
      nodes: [],
      hops: 0,
    });
  });

  it('caminho trivial quando origem == destino', () => {
    expect(buildPathResult(edges, 'a', 'a')).toEqual({ found: true, nodes: ['a'], hops: 0 });
  });
});
