// lib/netrin/parsers/pivot-cnpjs.test.ts
import { describe, expect, it } from 'vitest';
import { extractPivotCnpjs } from './pivot-cnpjs';

describe('extractPivotCnpjs', () => {
  it('returns empty when slug missing', () => {
    expect(extractPivotCnpjs({})).toEqual([]);
  });

  it('returns digits-only CNPJs from negociosRelacionados[]', () => {
    const payload = {
      'empresas-relacionadas-cpf': {
        negociosRelacionados: [
          { cnpj: '12.345.678/0001-90', tipoVinculo: 'OWNERSHIP' },
          { cnpj: '98765432000110', tipoVinculo: 'DIRECT' },
          { cnpj: 'lixo', tipoVinculo: 'DIRECT' },
        ],
      },
    };
    expect(extractPivotCnpjs(payload)).toEqual(['12345678000190', '98765432000110']);
  });

  it('deduplicates CNPJs', () => {
    const payload = {
      'empresas-relacionadas-cpf': {
        negociosRelacionados: [{ cnpj: '12345678000190' }, { cnpj: '12.345.678/0001-90' }],
      },
    };
    expect(extractPivotCnpjs(payload)).toEqual(['12345678000190']);
  });

  it('handles missing or non-array shape gracefully', () => {
    expect(extractPivotCnpjs({ 'empresas-relacionadas-cpf': null })).toEqual([]);
    expect(
      extractPivotCnpjs({ 'empresas-relacionadas-cpf': { negociosRelacionados: 'nope' } }),
    ).toEqual([]);
  });
});
