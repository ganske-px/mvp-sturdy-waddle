import { describe, expect, it } from 'vitest';
import { buildNetrinGraph } from './graph-bridge';

describe('buildNetrinGraph', () => {
  it('emits corporate edges from CPF root → CNPJs', () => {
    const result = buildNetrinGraph({
      rootDocument: { type: 'cpf', raw: '12345678909', name: 'JOAO' },
      hop1Payload: {
        'esp-cpf': { nome: 'JOAO' },
        'empresas-relacionadas-cpf': {
          negociosRelacionados: [
            {
              cnpj: '12345678000190',
              razaoSocial: 'ACME LTDA',
              tipoVinculo: 'OWNERSHIP',
              dataInicioRelacionamento: '2020-01-01',
              dataFimRelacionamento: '9999-12-31',
              percentualParticipacao: 100,
            },
          ],
        },
      },
      hop2Payloads: {},
    });

    const cnpjNode = result.nodes.find((n) => n.nodeType === 'cnpj');
    expect(cnpjNode).toBeTruthy();
    expect(cnpjNode?.label.document).toBe('12345678000190');

    const corp = result.edges.filter((e) => e.kind === 'corporate_relation');
    expect(corp).toHaveLength(1);
    expect(corp[0]?.evidence).toMatchObject({
      vinculo: 'OWNERSHIP',
      source: 'empresas-relacionadas-cpf',
      percentualParticipacao: 100,
    });
  });

  it('emits CNPJ → CPF socio edges from Hop 2 payloads', () => {
    const result = buildNetrinGraph({
      rootDocument: { type: 'cpf', raw: '12345678909', name: 'JOAO' },
      hop1Payload: {
        'empresas-relacionadas-cpf': {
          negociosRelacionados: [{ cnpj: '12345678000190', razaoSocial: 'ACME' }],
        },
      },
      hop2Payloads: {
        '12345678000190': {
          'esp-cnpj-completo': { razaoSocial: 'ACME' },
          'pessoas-relacionadas-cnpj': {
            entidadesRelacionadas: [
              {
                cpf: '98765432100',
                nome: 'MARIA',
                vinculoDoRelacionamento: 'SOCIO',
                dataInicioRelacionamento: '2020-01-01',
                dataFimRelacionamento: '9999-12-31',
              },
            ],
          },
        },
      },
    });

    const mariaNode = result.nodes.find((n) => n.label.document === '98765432100');
    expect(mariaNode?.nodeType).toBe('cpf');

    const corpEdges = result.edges.filter((e) => e.kind === 'corporate_relation');
    expect(corpEdges).toHaveLength(2);
    const cnpjToCpf = corpEdges.find((e) => e.evidence.source === 'pessoas-relacionadas-cnpj');
    expect(cnpjToCpf?.evidence.vinculo).toBe('SOCIO');
  });

  it('omits malformed cnpj/cpf rows silently', () => {
    const result = buildNetrinGraph({
      rootDocument: { type: 'cpf', raw: '12345678909' },
      hop1Payload: {
        'empresas-relacionadas-cpf': {
          negociosRelacionados: [{ cnpj: 'invalid' }, { cnpj: '12345678000190' }],
        },
      },
      hop2Payloads: {},
    });
    const cnpjNodes = result.nodes.filter((n) => n.nodeType === 'cnpj');
    expect(cnpjNodes).toHaveLength(1);
  });
});
