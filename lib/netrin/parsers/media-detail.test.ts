// lib/netrin/parsers/media-detail.test.ts
import { describe, expect, it } from 'vitest';
import { extractMediaDetail } from './media-detail';

describe('extractMediaDetail', () => {
  it('returns empty structure when slug missing', () => {
    expect(extractMediaDetail({})).toEqual({
      mentions: [],
      restritivas: [],
      governamentais: [],
      socioambientais: [],
    });
  });

  it('maps midiasPublicas.midias[] and masks the CPF', () => {
    const payload = {
      midiasConsolidado: {
        midiasPublicas: {
          midias: [
            {
              titulo: 'Operação X mira empresário',
              fonte: 'G1',
              data_noticia: '2023-08-10',
              uf: 'SP',
              regiao: 'Sudeste',
              tipo_suspeita: 'Lavagem de dinheiro',
              envolvimento: 'Citado',
              atividade: 'Empresarial',
              citacao: 'Texto integral da matéria com detalhes.',
              dtec_link_noticia: 'https://g1.com/noticia',
              nome_cpf: 'JOAO DA SILVA',
              cpf: '123.456.789-10',
              nome_exato: 'JOAO DA SILVA',
            },
          ],
        },
      },
    } as never;
    const out = extractMediaDetail(payload);
    expect(out.mentions).toHaveLength(1);
    expect(out.mentions[0]).toMatchObject({
      titulo: 'Operação X mira empresário',
      fonte: 'G1',
      dataNoticia: '2023-08-10',
      uf: 'SP',
      tipoSuspeita: 'Lavagem de dinheiro',
      envolvimento: 'Citado',
      citacao: 'Texto integral da matéria com detalhes.',
      linkNoticia: 'https://g1.com/noticia',
      nomeCpf: 'JOAO DA SILVA',
      cpfMascarado: '123.***.***-10',
    });
    // Never leak the raw CPF
    expect(JSON.stringify(out)).not.toContain('123.456.789-10');
  });

  it('extracts restritivas / governamentais / socioambientais lists, masking documents', () => {
    const payload = {
      midiasConsolidado: {
        midiasListasRestritivas: {
          listas: [{ titulo: 'Lista OFAC', documento: '123.456.789-10' }],
        },
        midiasListasGovernamentais: {
          governamentais: [{ titulo: 'CEIS', cnpj: '12.345.678/0001-90' }],
        },
        midiasListasSocioambientais: {
          socioambientais: [{ titulo: 'IBAMA' }],
        },
      },
    } as never;
    const out = extractMediaDetail(payload);
    expect(out.restritivas).toEqual([{ titulo: 'Lista OFAC', documento: '123.***.***-10' }]);
    expect(out.governamentais).toEqual([{ titulo: 'CEIS', cnpj: '12.***.***/****-90' }]);
    expect(out.socioambientais).toEqual([{ titulo: 'IBAMA' }]);
  });

  it('ignores non-string list values', () => {
    const payload = {
      midiasConsolidado: {
        midiasListasRestritivas: {
          listas: [{ titulo: 'X', count: 3, ativo: true, nested: { a: 1 } }],
        },
      },
    } as never;
    const out = extractMediaDetail(payload);
    expect(out.restritivas).toEqual([{ titulo: 'X', count: '3', ativo: 'true' }]);
  });
});
