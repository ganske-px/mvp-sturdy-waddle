// lib/netrin/parsers/sanctions-detail.test.ts
import { describe, expect, it } from 'vitest';
import { extractSanctions } from './sanctions-detail';

describe('extractSanctions', () => {
  it('returns empty when slug or list missing', () => {
    expect(extractSanctions({})).toEqual([]);
    expect(extractSanctions({ pepKyc: null } as never)).toEqual([]);
    expect(extractSanctions({ pepKyc: { sanctionsHistory: 'nope' } } as never)).toEqual([]);
  });

  it('maps records and orders by matchRate descending', () => {
    const payload = {
      pepKyc: {
        sanctionsHistory: [
          {
            source: 'interpol',
            type: 'Law Enforcement',
            standardizedSanctionType: 'ARREST WARRANTS',
            matchRate: 52,
            nameUniquenessScore: 10,
            startDate: '2020-01-01',
            endDate: '',
            lastUpdateDate: '2024-01-01',
            currentlyPresentOnSource: true,
            recentlyPresentOnSource: false,
            details: {
              OriginalName: 'JOAO DA SILVA',
              SanctionName: 'JOHN SILVA',
              BirthDate: '1980-05-05',
              StandardizedBirthDate: '1980-05-05',
              Nationalities: 'BR',
              charges: 'Some charges text',
            },
          },
          {
            source: 'ofac',
            standardizedSanctionType: 'FINANCIAL CRIMES',
            matchRate: 90,
            details: { OriginalName: 'JOAO DA SILVA', SanctionName: 'J SILVA' },
          },
        ],
      },
    } as never;

    const out = extractSanctions(payload);
    expect(out).toHaveLength(2);
    expect(out[0]?.matchRate).toBe(90);
    expect(out[1]?.matchRate).toBe(52);
    expect(out[0]).toMatchObject({
      source: 'ofac',
      standardizedSanctionType: 'FINANCIAL CRIMES',
      originalName: 'JOAO DA SILVA',
      sanctionName: 'J SILVA',
    });
    expect(out[1]).toMatchObject({
      source: 'interpol',
      type: 'Law Enforcement',
      standardizedSanctionType: 'ARREST WARRANTS',
      currentlyPresentOnSource: true,
      birthDate: '1980-05-05',
      nationalities: 'BR',
      charges: 'Some charges text',
      sanctionName: 'JOHN SILVA',
    });
  });

  it('treats missing matchRate as lowest priority', () => {
    const payload = {
      pepKyc: {
        sanctionsHistory: [
          { source: 'a', details: {} },
          { source: 'b', matchRate: 30, details: {} },
        ],
      },
    } as never;
    const out = extractSanctions(payload);
    expect(out[0]?.source).toBe('b');
    expect(out[1]?.source).toBe('a');
  });

  it('skips placeholder rows where every field is empty', () => {
    const payload = {
      pepKyc: {
        sanctionsHistory: [
          { source: '', type: '', matchRate: 0, details: {} },
          { source: 'ofac', matchRate: 10, details: { OriginalName: 'X', SanctionName: 'Y' } },
        ],
      },
    } as never;
    const out = extractSanctions(payload);
    expect(out).toHaveLength(1);
    expect(out[0]?.source).toBe('ofac');
  });
});
