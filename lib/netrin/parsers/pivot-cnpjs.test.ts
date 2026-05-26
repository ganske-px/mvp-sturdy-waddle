// lib/netrin/parsers/pivot-cnpjs.test.ts
import { describe, expect, it } from 'vitest';
import { extractPivotCnpjs } from './pivot-cnpjs';

describe('extractPivotCnpjs', () => {
  it('returns empty when slug missing', () => {
    expect(extractPivotCnpjs({})).toEqual([]);
  });

  it('returns digits-only CNPJs from empresasRelacionadasCPF.negociosRelacionados[]', () => {
    const payload = {
      empresasRelacionadasCPF: {
        negociosRelacionados: [
          {
            entidadeRelacionadaDocumento: '12.345.678/0001-90',
            entidadeRelacionadadaTipoDeDocumento: 'CNPJ',
          },
          {
            entidadeRelacionadaDocumento: '98765432000110',
            entidadeRelacionadadaTipoDeDocumento: 'CNPJ',
          },
          {
            entidadeRelacionadaDocumento: 'lixo',
            entidadeRelacionadadaTipoDeDocumento: 'CNPJ',
          },
        ],
      },
    } as never;
    expect(extractPivotCnpjs(payload)).toEqual(['12345678000190', '98765432000110']);
  });

  it('skips CPF-typed entities', () => {
    const payload = {
      empresasRelacionadasCPF: {
        negociosRelacionados: [
          {
            entidadeRelacionadaDocumento: '08631699888',
            entidadeRelacionadadaTipoDeDocumento: 'CPF',
          },
          {
            entidadeRelacionadaDocumento: '12345678000190',
            entidadeRelacionadadaTipoDeDocumento: 'CNPJ',
          },
        ],
      },
    } as never;
    expect(extractPivotCnpjs(payload)).toEqual(['12345678000190']);
  });

  it('deduplicates CNPJs', () => {
    const payload = {
      empresasRelacionadasCPF: {
        negociosRelacionados: [
          {
            entidadeRelacionadaDocumento: '12345678000190',
            entidadeRelacionadadaTipoDeDocumento: 'CNPJ',
          },
          {
            entidadeRelacionadaDocumento: '12.345.678/0001-90',
            entidadeRelacionadadaTipoDeDocumento: 'CNPJ',
          },
        ],
      },
    } as never;
    expect(extractPivotCnpjs(payload)).toEqual(['12345678000190']);
  });

  it('handles missing or non-array shape gracefully', () => {
    expect(extractPivotCnpjs({ empresasRelacionadasCPF: null } as never)).toEqual([]);
    expect(
      extractPivotCnpjs({
        empresasRelacionadasCPF: { negociosRelacionados: 'nope' },
      } as never),
    ).toEqual([]);
  });
});
