import { describe, expect, it } from 'vitest';
import { findNearestRisk } from './nearest-risk';

describe('findNearestRisk', () => {
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'c', target: 'd' },
    { source: 'd', target: 'e' },
  ];

  it('detecta risco direto (1 salto)', () => {
    expect(findNearestRisk(edges, 'a', new Set(['b']), 3)).toEqual({
      found: true,
      targetHash: 'b',
      distance: 1,
      level: 'direct',
    });
  });

  it('detecta risco próximo (2–3 saltos) como nearby', () => {
    expect(findNearestRisk(edges, 'a', new Set(['c']), 3)).toEqual({
      found: true,
      targetHash: 'c',
      distance: 2,
      level: 'nearby',
    });
  });

  it('ignora risco além de maxHops', () => {
    expect(findNearestRisk(edges, 'a', new Set(['e']), 3)).toEqual({
      found: false,
      targetHash: null,
      distance: 0,
      level: 'none',
    });
  });

  it('escolhe o arriscado mais próximo quando há vários', () => {
    const r = findNearestRisk(edges, 'a', new Set(['c', 'd']), 3);
    expect(r.targetHash).toBe('c');
    expect(r.distance).toBe(2);
  });

  it('o próprio centro arriscado não dispara (distance 0 não conta)', () => {
    expect(findNearestRisk(edges, 'a', new Set(['a']), 3)).toEqual({
      found: false,
      targetHash: null,
      distance: 0,
      level: 'none',
    });
  });

  it('sem arriscados → none', () => {
    expect(findNearestRisk(edges, 'a', new Set(), 3).level).toBe('none');
  });
});
