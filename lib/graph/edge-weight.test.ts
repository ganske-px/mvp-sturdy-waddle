import { describe, expect, it } from 'vitest';
import {
  W_DIV,
  consolidatePairs,
  dominantKind,
  nodeScale,
  pairKey,
  pairStrokeWidth,
} from './edge-weight';

describe('pairKey', () => {
  it('is order-independent', () => {
    expect(pairKey('B', 'A')).toBe(pairKey('A', 'B'));
  });
});

describe('consolidatePairs', () => {
  it('sums weights and counts distinct kinds per unordered pair', () => {
    const pairs = consolidatePairs([
      { source: 'A', target: 'B', kind: 'co_party', weight: 3 },
      { source: 'B', target: 'A', kind: 'corporate_relation', weight: 1 },
      { source: 'A', target: 'B', kind: 'family_relation', weight: 1 },
    ]);
    const p = pairs.get(pairKey('A', 'B'));
    expect(p).toBeDefined();
    expect(p?.multiplicity).toBe(5); // 3 + 1 + 1
    expect(p?.diversity).toBe(3);
    expect(p?.weight).toBe(5 + W_DIV * 2); // multiplicidade + bônus de 2 tipos extras
  });

  it('single-kind process pair keeps weight == multiplicity (no diversity bonus)', () => {
    const pairs = consolidatePairs([{ source: 'A', target: 'B', kind: 'co_party', weight: 4 }]);
    const p = pairs.get(pairKey('A', 'B'));
    expect(p?.diversity).toBe(1);
    expect(p?.weight).toBe(4);
  });

  it('ignores self-loops and treats weight<1 as 1', () => {
    const pairs = consolidatePairs([
      { source: 'A', target: 'A', kind: 'co_party', weight: 9 },
      { source: 'A', target: 'B', kind: 'co_party', weight: 0 },
    ]);
    expect(pairs.has(pairKey('A', 'A'))).toBe(false);
    expect(pairs.get(pairKey('A', 'B'))?.multiplicity).toBe(1);
  });
});

describe('dominantKind', () => {
  it('prioritises adversarial/relevant kinds', () => {
    expect(dominantKind(['lawyer_lawyer', 'co_party'])).toBe('co_party');
    expect(dominantKind(['family_relation', 'corporate_relation'])).toBe('corporate_relation');
  });
});

describe('pairStrokeWidth', () => {
  it('grows with weight and clamps to [1, 8]', () => {
    expect(pairStrokeWidth(1, 1)).toBeGreaterThanOrEqual(1);
    expect(pairStrokeWidth(1, 1)).toBeLessThan(pairStrokeWidth(20, 1));
    expect(pairStrokeWidth(100000, 5)).toBeLessThanOrEqual(8);
  });

  it('clamps to a minimum of 1', () => {
    expect(pairStrokeWidth(0, 1)).toBe(1);
    expect(pairStrokeWidth(0.5, 1)).toBeGreaterThanOrEqual(1);
  });
});

describe('nodeScale', () => {
  it('grows with weight and clamps to [1, 1.8]', () => {
    expect(nodeScale(0)).toBe(1);
    expect(nodeScale(4)).toBeGreaterThan(1);
    expect(nodeScale(1000000)).toBeLessThanOrEqual(1.8);
  });
});
