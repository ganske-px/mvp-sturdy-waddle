import { describe, expect, it } from 'vitest';
import { buildNetrinGraph } from './graph-bridge';

describe('buildNetrinGraph', () => {
  it('emits corporate edges from CPF root → CNPJs', () => {
    const result = buildNetrinGraph({
      rootDocument: { type: 'cpf', raw: '12345678909', name: 'JOAO' },
      cpfPayload: {
        empresasRelacionadasCPF: {
          negociosRelacionados: [
            {
              entidadeRelacionadaDocumento: '12345678000190',
              entidadeRelacionadadaTipoDeDocumento: 'CNPJ',
              entidadeRelacionadaNome: 'ACME LTDA',
              tipoDeRelacionamento: 'OWNERSHIP',
              dataInicioRelacionamento: '2020-01-01',
              dataFimRelacionamento: '9999-12-31',
            },
          ],
        },
      } as never,
      cnpjPayloads: {},
    });

    const cnpjNode = result.nodes.find((n) => n.nodeType === 'cnpj');
    expect(cnpjNode).toBeTruthy();
    expect(cnpjNode?.label.document).toBe('12345678000190');

    const corp = result.edges.filter((e) => e.kind === 'corporate_relation');
    expect(corp).toHaveLength(1);
    expect(corp[0]?.evidence).toMatchObject({
      vinculo: 'OWNERSHIP',
      source: 'empresas-relacionadas-cpf',
    });
  });

  it('emits CNPJ → CPF socio edges from cnpjPayloads', () => {
    const result = buildNetrinGraph({
      rootDocument: { type: 'cpf', raw: '12345678909', name: 'JOAO' },
      cpfPayload: {
        empresasRelacionadasCPF: {
          negociosRelacionados: [
            {
              entidadeRelacionadaDocumento: '12345678000190',
              entidadeRelacionadadaTipoDeDocumento: 'CNPJ',
              entidadeRelacionadaNome: 'ACME',
            },
          ],
        },
      } as never,
      cnpjPayloads: {
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
      cpfPayload: {
        empresasRelacionadasCPF: {
          negociosRelacionados: [
            {
              entidadeRelacionadaDocumento: 'invalid',
              entidadeRelacionadadaTipoDeDocumento: 'CNPJ',
            },
            {
              entidadeRelacionadaDocumento: '12345678000190',
              entidadeRelacionadadaTipoDeDocumento: 'CNPJ',
            },
          ],
        },
      } as never,
      cnpjPayloads: {},
    });
    const cnpjNodes = result.nodes.filter((n) => n.nodeType === 'cnpj');
    expect(cnpjNodes).toHaveLength(1);
  });

  it('emits family edges from CPF root → related people (pessoasRelacionadasCPF)', () => {
    const result = buildNetrinGraph({
      rootDocument: { type: 'cpf', raw: '15574451760', name: 'FULANO' },
      cpfPayload: {
        pessoasRelacionadasCPF: {
          entidadesRelacionadas: [
            {
              entidadeRelacionadaDocumento: '022.644.867-32',
              entidadeRelacionadadaTipoDeDocumento: 'CPF',
              entidadeRelacionadaNome: 'LUCELI CANDIDA DE MELO',
              tipoDeRelacionamento: 'MOTHER',
              nivelDeRelacionamento: 'DIRECT',
            },
          ],
        },
      } as never,
      cnpjPayloads: {},
    });

    const motherNode = result.nodes.find((n) => n.label.document === '02264486732');
    expect(motherNode?.nodeType).toBe('cpf');

    const family = result.edges.filter((e) => e.kind === 'family_relation');
    expect(family).toHaveLength(1);
    expect(family[0]?.sourceHash).toBe(
      result.nodes.find((n) => n.label.document === '15574451760')?.nodeHash,
    );
    expect(family[0]?.targetHash).toBe(motherNode?.nodeHash);
    expect(family[0]?.evidence).toMatchObject({
      tipoRelacionamento: 'MOTHER',
      nivel: 'DIRECT',
      source: 'pessoas-relacionadas-cpf',
    });
  });

  it('does not emit family edges for non-CPF entities or when root is not a CPF', () => {
    const cpfRootCnpjEntity = buildNetrinGraph({
      rootDocument: { type: 'cpf', raw: '15574451760' },
      cpfPayload: {
        pessoasRelacionadasCPF: {
          entidadesRelacionadas: [
            {
              entidadeRelacionadaDocumento: '12345678000190',
              entidadeRelacionadadaTipoDeDocumento: 'CNPJ',
              entidadeRelacionadaNome: 'ACME LTDA',
            },
          ],
        },
      } as never,
      cnpjPayloads: {},
    });
    expect(cpfRootCnpjEntity.edges.filter((e) => e.kind === 'family_relation')).toHaveLength(0);
  });

  it('marca risco no nó raiz CPF a partir de pepKyc', () => {
    const result = buildNetrinGraph({
      rootDocument: { type: 'cpf', raw: '12345678909', name: 'JOAO' },
      cpfPayload: { pepKyc: { currentlyPEP: 'Sim' } } as never,
      cnpjPayloads: {},
    });
    const root = result.nodes.find((n) => n.label.document === '12345678909');
    expect(root?.risk).toEqual({ isPep: true, hasSanction: false });
  });

  it('CNPJ root: emits sócios from cnpjPayloads even without cpfPayload', () => {
    const result = buildNetrinGraph({
      rootDocument: { type: 'cnpj', raw: '12345678000190', name: 'ACME' },
      cnpjPayloads: {
        '12345678000190': {
          'pessoas-relacionadas-cnpj': {
            entidadesRelacionadas: [
              { cpf: '98765432100', nome: 'JOAO', vinculoDoRelacionamento: 'SOCIO' },
            ],
          },
        },
      },
    });
    expect(result.nodes.map((n) => n.nodeType).sort()).toEqual(['cnpj', 'cpf']);
    const corpEdges = result.edges.filter((e) => e.kind === 'corporate_relation');
    expect(corpEdges).toHaveLength(1);
    expect(corpEdges[0]?.evidence.vinculo).toBe('SOCIO');
  });
});
