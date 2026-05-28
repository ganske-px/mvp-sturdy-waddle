// lib/netrin/parsers/related-cpfs.test.ts
import { describe, expect, it } from 'vitest';
import { extractRelatedCpfs } from './related-cpfs';

describe('extractRelatedCpfs', () => {
  it('returns empty when slug missing', () => {
    expect(extractRelatedCpfs({})).toEqual([]);
  });

  it('extracts CPF related people from pessoasRelacionadasCPF.entidadesRelacionadas[]', () => {
    const payload = {
      pessoasRelacionadasCPF: {
        entidadesRelacionadas: [
          {
            entidadeRelacionadaDocumento: '022.644.867-32',
            entidadeRelacionadadaTipoDeDocumento: 'CPF',
            entidadeRelacionadaNome: 'LUCELI CANDIDA DE MELO',
            tipoDeRelacionamento: 'MOTHER',
            nivelDeRelacionamento: 'DIRECT',
          },
          {
            entidadeRelacionadaDocumento: '06917562793',
            entidadeRelacionadadaTipoDeDocumento: 'CPF',
            entidadeRelacionadaNome: 'LUIZA CANDIDA DE MELO',
            tipoDeRelacionamento: 'GRANDPARENT',
            nivelDeRelacionamento: 'DIRECT',
          },
        ],
      },
    } as never;
    expect(extractRelatedCpfs(payload)).toEqual([
      {
        cpf: '02264486732',
        nome: 'LUCELI CANDIDA DE MELO',
        tipoRelacionamento: 'MOTHER',
        nivel: 'DIRECT',
      },
      {
        cpf: '06917562793',
        nome: 'LUIZA CANDIDA DE MELO',
        tipoRelacionamento: 'GRANDPARENT',
        nivel: 'DIRECT',
      },
    ]);
  });

  it('skips non-CPF-typed entities and malformed documents', () => {
    const payload = {
      pessoasRelacionadasCPF: {
        entidadesRelacionadas: [
          {
            entidadeRelacionadaDocumento: '12345678000190',
            entidadeRelacionadadaTipoDeDocumento: 'CNPJ',
            entidadeRelacionadaNome: 'ACME LTDA',
          },
          {
            entidadeRelacionadaDocumento: 'lixo',
            entidadeRelacionadadaTipoDeDocumento: 'CPF',
          },
          {
            entidadeRelacionadaDocumento: '07493343713',
            entidadeRelacionadadaTipoDeDocumento: 'CPF',
            tipoDeRelacionamento: 'UNCLE',
          },
        ],
      },
    } as never;
    expect(extractRelatedCpfs(payload)).toEqual([
      { cpf: '07493343713', nome: undefined, tipoRelacionamento: 'UNCLE', nivel: undefined },
    ]);
  });

  it('deduplicates by CPF, keeping the first occurrence', () => {
    const payload = {
      pessoasRelacionadasCPF: {
        entidadesRelacionadas: [
          {
            entidadeRelacionadaDocumento: '02264486732',
            entidadeRelacionadadaTipoDeDocumento: 'CPF',
            tipoDeRelacionamento: 'MOTHER',
          },
          {
            entidadeRelacionadaDocumento: '022.644.867-32',
            entidadeRelacionadadaTipoDeDocumento: 'CPF',
            tipoDeRelacionamento: 'PARENT',
          },
        ],
      },
    } as never;
    expect(extractRelatedCpfs(payload)).toEqual([
      { cpf: '02264486732', nome: undefined, tipoRelacionamento: 'MOTHER', nivel: undefined },
    ]);
  });

  it('falls back to INDEFINIDO when tipoDeRelacionamento is absent', () => {
    const payload = {
      pessoasRelacionadasCPF: {
        entidadesRelacionadas: [
          {
            entidadeRelacionadaDocumento: '02264486732',
            entidadeRelacionadadaTipoDeDocumento: 'CPF',
          },
        ],
      },
    } as never;
    expect(extractRelatedCpfs(payload)).toEqual([
      { cpf: '02264486732', nome: undefined, tipoRelacionamento: 'INDEFINIDO', nivel: undefined },
    ]);
  });

  it('handles non-array / null shape gracefully', () => {
    expect(extractRelatedCpfs({ pessoasRelacionadasCPF: null } as never)).toEqual([]);
    expect(
      extractRelatedCpfs({ pessoasRelacionadasCPF: { entidadesRelacionadas: 'nope' } } as never),
    ).toEqual([]);
  });
});
