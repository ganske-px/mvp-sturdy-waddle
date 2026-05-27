// lib/netrin/parsers/cnpj-sanctions-detail.test.ts
import { describe, expect, it } from 'vitest';
import { countSanctions } from './cnpj-sanctions-detail';

describe('countSanctions', () => {
  it('counts active and inactive entries across CEIS and CNEP', () => {
    const out = countSanctions({
      ceis: [{ ativo: true }, { ativo: false }, { ativo: true }],
      cnep: [{ ativo: false }],
    });
    expect(out).toEqual({
      ceisAtivos: 2,
      ceisInativos: 1,
      cnepAtivos: 0,
      cnepInativos: 1,
      total: 4,
    });
  });

  it('handles missing arrays', () => {
    expect(countSanctions({})).toEqual({
      ceisAtivos: 0,
      ceisInativos: 0,
      cnepAtivos: 0,
      cnepInativos: 0,
      total: 0,
    });
  });
});
