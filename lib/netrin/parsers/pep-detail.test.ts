// lib/netrin/parsers/pep-detail.test.ts
import { describe, expect, it } from 'vitest';
import { extractPepHistory } from './pep-detail';

describe('extractPepHistory', () => {
  it('returns empty when slug or list missing', () => {
    expect(extractPepHistory({})).toEqual([]);
    expect(extractPepHistory({ pepKyc: null } as never)).toEqual([]);
    expect(extractPepHistory({ pepKyc: { historyPEP: 'nope' } } as never)).toEqual([]);
  });

  it('maps entries and filters empty placeholder rows', () => {
    const payload = {
      pepKyc: {
        historyPEP: [
          {
            level: '1',
            jobTitle: 'Prefeito',
            department: 'Prefeitura',
            motive: 'Cargo eletivo',
            source: 'TSE',
            startDate: '2017-01-01',
            endDate: '2020-12-31',
            lastUpdateDate: '2021-01-01',
          },
          { level: '', jobTitle: '', department: '', motive: '', source: '' },
        ],
      },
    } as never;
    const out = extractPepHistory(payload);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      level: '1',
      jobTitle: 'Prefeito',
      department: 'Prefeitura',
      motive: 'Cargo eletivo',
      source: 'TSE',
      startDate: '2017-01-01',
      endDate: '2020-12-31',
    });
  });

  it('masks document fields that look like a CPF or CNPJ', () => {
    const payload = {
      pepKyc: {
        historyPEP: [
          {
            jobTitle: 'Deputado',
            document: '123.456.789-10',
            documentPEP: '12.345.678/0001-90',
          },
        ],
      },
    } as never;
    const out = extractPepHistory(payload);
    expect(out[0]?.document).toBe('123.***.***-10');
    expect(out[0]?.documentPEP).toBe('12.***.***/****-90');
  });

  it('drops document fields that are not valid documents', () => {
    const payload = {
      pepKyc: { historyPEP: [{ jobTitle: 'X', document: 'abc' }] },
    } as never;
    const out = extractPepHistory(payload);
    expect(out[0]?.document).toBeUndefined();
  });
});
