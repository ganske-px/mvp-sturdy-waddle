import { describe, expect, it } from 'vitest';
import { extractRelatedCompanies } from './related-companies';

describe('extractRelatedCompanies', () => {
  it('returns empty when slug missing', () => {
    expect(extractRelatedCompanies({})).toEqual([]);
  });

  it('reads empresasRelacionadasCPF.negociosRelacionados[] CNPJ entities', () => {
    const payload = {
      empresasRelacionadasCPF: {
        negociosRelacionados: [
          {
            entidadeRelacionadaDocumento: '12.345.678/0001-90',
            entidadeRelacionadadaTipoDeDocumento: 'CNPJ',
            entidadeRelacionadaNome: 'ACME LTDA',
            tipoDeRelacionamento: 'SOCIO',
            dataInicioRelacionamento: '2020-01-01',
            dataFimRelacionamento: '9999-12-31',
          },
        ],
      },
    } as never;
    expect(extractRelatedCompanies(payload)).toEqual([
      {
        cnpj: '12345678000190',
        razaoSocial: 'ACME LTDA',
        vinculo: 'SOCIO',
        dataInicio: '2020-01-01',
        dataFim: '9999-12-31',
      },
    ]);
  });

  it('skips CPF-typed entities and malformed CNPJs, and dedups', () => {
    const payload = {
      empresasRelacionadasCPF: {
        negociosRelacionados: [
          {
            entidadeRelacionadaDocumento: '08631699888',
            entidadeRelacionadadaTipoDeDocumento: 'CPF',
          },
          { entidadeRelacionadaDocumento: 'lixo', entidadeRelacionadadaTipoDeDocumento: 'CNPJ' },
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
    expect(extractRelatedCompanies(payload).map((c) => c.cnpj)).toEqual(['12345678000190']);
  });

  it('defaults vinculo to INDEFINIDO and handles non-array shape', () => {
    expect(
      extractRelatedCompanies({
        empresasRelacionadasCPF: { negociosRelacionados: 'nope' },
      } as never),
    ).toEqual([]);
    const payload = {
      empresasRelacionadasCPF: {
        negociosRelacionados: [
          {
            entidadeRelacionadaDocumento: '12345678000190',
            entidadeRelacionadadaTipoDeDocumento: 'CNPJ',
          },
        ],
      },
    } as never;
    expect(extractRelatedCompanies(payload)[0]?.vinculo).toBe('INDEFINIDO');
  });
});
