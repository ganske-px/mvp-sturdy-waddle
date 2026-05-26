// lib/netrin/parsers/pivot-cpfs.test.ts
import { describe, expect, it } from 'vitest';
import { extractPivotCpfs } from './pivot-cpfs';

describe('extractPivotCpfs', () => {
  it('returns empty when slug missing', () => {
    expect(extractPivotCpfs({})).toEqual([]);
  });

  it('extracts CPFs from entidadesRelacionadas[] keeping vinculo', () => {
    const payload = {
      'pessoas-relacionadas-cnpj': {
        entidadesRelacionadas: [
          {
            cpf: '123.456.789-09',
            vinculoDoRelacionamento: 'SOCIO-ADMINISTRADOR',
            dataInicioRelacionamento: '2020-01-01',
            dataFimRelacionamento: '9999-12-31',
            percentualParticipacaoSociedade: 50,
          },
          {
            cpf: '98765432100',
            vinculoDoRelacionamento: 'SOCIO',
            dataInicioRelacionamento: '2018-06-01',
            dataFimRelacionamento: '2021-09-01',
          },
        ],
      },
    };
    const result = extractPivotCpfs(payload);
    expect(result).toEqual([
      {
        cpf: '12345678909',
        vinculo: 'SOCIO-ADMINISTRADOR',
        dataInicio: '2020-01-01',
        dataFim: '9999-12-31',
        percentualParticipacao: 50,
        ativo: true,
      },
      {
        cpf: '98765432100',
        vinculo: 'SOCIO',
        dataInicio: '2018-06-01',
        dataFim: '2021-09-01',
        percentualParticipacao: undefined,
        ativo: false,
      },
    ]);
  });

  it('dedupes by CPF, keeping first occurrence', () => {
    const payload = {
      'pessoas-relacionadas-cnpj': {
        entidadesRelacionadas: [
          { cpf: '12345678909', vinculoDoRelacionamento: 'SOCIO' },
          { cpf: '123.456.789-09', vinculoDoRelacionamento: 'OUTRO' },
        ],
      },
    };
    expect(extractPivotCpfs(payload).map((r) => r.vinculo)).toEqual(['SOCIO']);
  });
});
