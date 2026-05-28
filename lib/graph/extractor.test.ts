import { hashDocument } from '@/lib/hash';
import type { PredictusProcess } from '@/lib/predictus/types';
import { describe, expect, it } from 'vitest';
import { extractGraph } from './extractor';
import type { ExtractedEdge, ProcessEdgeEvidence } from './types';

/** Narrow an ExtractedEdge to the process-evidence branch. */
function processEvidence(e: ExtractedEdge): ProcessEdgeEvidence {
  if (e.kind === 'corporate_relation' || e.kind === 'family_relation') {
    throw new Error(`unexpected ${e.kind} in test`);
  }
  return e.evidence;
}

const HASH_CPF_A = hashDocument('cpf', '11144477735');
const HASH_CPF_B = hashDocument('cpf', '52998224725');
const HASH_CNPJ = hashDocument('cnpj', '11222333000181');
const HASH_LAWYER_SP = hashDocument('lawyer', 'SP-12345');
const HASH_LAWYER_RJ = hashDocument('lawyer', 'RJ-99999');

function processWith(parts: unknown[], processNumber = 'P-1'): PredictusProcess {
  return { numeroProcessoUnico: processNumber, partes: parts };
}

describe('extractGraph', () => {
  it('returns empty result for empty payload', () => {
    const result = extractGraph({ payload: [], searchedHash: HASH_CPF_A });
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('emits one node for a parte with CPF, zero edges when alone', () => {
    const payload = [processWith([{ tipo: 'AUTOR', nome: 'Alice', cpf: '11144477735' }])];
    const { nodes, edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ nodeHash: HASH_CPF_A, nodeType: 'cpf' });
    expect(nodes[0]?.label.name).toBe('Alice');
    expect(edges).toEqual([]);
  });

  it('emits a co_party edge between two partes in the same process', () => {
    const payload = [
      processWith([
        { tipo: 'AUTOR', nome: 'Alice', cpf: '11144477735' },
        { tipo: 'RÉU', nome: 'Beto', cpf: '52998224725' },
      ]),
    ];
    const { nodes, edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    expect(nodes.map((n) => n.nodeHash).sort()).toEqual([HASH_CPF_A, HASH_CPF_B].sort());
    expect(edges).toHaveLength(1);
    expect(edges[0]?.kind).toBe('co_party');
    expect(edges[0] ? processEvidence(edges[0]).samePolo : undefined).toBe(false);
    expect((edges[0]?.sourceHash ?? '') < (edges[0]?.targetHash ?? '')).toBe(true);
  });

  it('marks samePolo=true when both partes share the same tipo', () => {
    const payload = [
      processWith([
        { tipo: 'AUTOR', nome: 'A', cpf: '11144477735' },
        { tipo: 'AUTOR', nome: 'B', cpf: '52998224725' },
      ]),
    ];
    const { edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    expect(edges[0] ? processEvidence(edges[0]).samePolo : undefined).toBe(true);
  });

  it('marks samePolo=null when either tipo is missing', () => {
    const payload = [
      processWith([
        { nome: 'A', cpf: '11144477735' },
        { tipo: 'RÉU', nome: 'B', cpf: '52998224725' },
      ]),
    ];
    const { edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    expect(edges[0] ? processEvidence(edges[0]).samePolo : undefined).toBeNull();
  });

  it('treats a parte with CNPJ as nodeType cnpj', () => {
    const payload = [
      processWith([
        { tipo: 'AUTOR', nome: 'Alice', cpf: '11144477735' },
        { tipo: 'RÉU', nome: 'Acme', cnpj: '11222333000181' },
      ]),
    ];
    const { nodes } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    const cnpjNode = nodes.find((n) => n.nodeHash === HASH_CNPJ);
    expect(cnpjNode?.nodeType).toBe('cnpj');
  });

  it('discards partes without CPF or CNPJ', () => {
    const payload = [
      processWith([
        { tipo: 'AUTOR', nome: 'Alice', cpf: '11144477735' },
        { tipo: 'TESTEMUNHA', nome: 'Sem doc' },
      ]),
    ];
    const { nodes, edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    expect(nodes).toHaveLength(1);
    expect(edges).toEqual([]);
  });

  it('emits lawyer node and client_lawyer edge for valid advogado', () => {
    const payload = [
      processWith([
        {
          tipo: 'AUTOR',
          nome: 'Alice',
          cpf: '11144477735',
          advogados: [{ nome: 'Dr. Souza', oab: { uf: 'SP', numero: '12345' } }],
        },
      ]),
    ];
    const { nodes, edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    expect(nodes.map((n) => n.nodeHash).sort()).toEqual([HASH_CPF_A, HASH_LAWYER_SP].sort());
    expect(edges).toHaveLength(1);
    expect(edges[0]?.kind).toBe('client_lawyer');
    expect(edges[0]?.sourceHash).toBe(HASH_CPF_A);
    expect(edges[0]?.targetHash).toBe(HASH_LAWYER_SP);
  });

  it('discards advogados with malformed OAB', () => {
    const payload = [
      processWith([
        {
          tipo: 'AUTOR',
          nome: 'Alice',
          cpf: '11144477735',
          advogados: [
            { nome: 'No OAB' },
            { nome: 'Partial', oab: { uf: 'SP' } },
            { nome: 'Empty numero', oab: { uf: 'SP', numero: '' } },
          ],
        },
      ]),
    ];
    const { nodes, edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    expect(nodes.map((n) => n.nodeHash)).toEqual([HASH_CPF_A]);
    expect(edges).toEqual([]);
  });

  it('emits lawyer_lawyer edge between two advogados in the same process', () => {
    const payload = [
      processWith([
        {
          tipo: 'AUTOR',
          nome: 'Alice',
          cpf: '11144477735',
          advogados: [{ nome: 'Dr. Souza', oab: { uf: 'SP', numero: '12345' } }],
        },
        {
          tipo: 'RÉU',
          nome: 'Beto',
          cpf: '52998224725',
          advogados: [{ nome: 'Dra. Lima', oab: { uf: 'RJ', numero: '99999' } }],
        },
      ]),
    ];
    const { edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    const lawyerEdge = edges.find((e) => e.kind === 'lawyer_lawyer');
    expect(lawyerEdge).toBeDefined();
    expect([lawyerEdge?.sourceHash, lawyerEdge?.targetHash].sort()).toEqual(
      [HASH_LAWYER_SP, HASH_LAWYER_RJ].sort(),
    );
    expect((lawyerEdge?.sourceHash ?? '') < (lawyerEdge?.targetHash ?? '')).toBe(true);
  });

  it('does not emit self-edges', () => {
    const payload = [
      processWith([
        { tipo: 'AUTOR', nome: 'Alice', cpf: '11144477735' },
        { tipo: 'AUTOR', nome: 'Alice (dup)', cpf: '11144477735' },
      ]),
    ];
    const { edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    expect(edges).toEqual([]);
  });

  it('emits one ExtractedEdge per process observation (writer dedupes)', () => {
    const payload = [
      processWith(
        [
          { tipo: 'AUTOR', nome: 'A', cpf: '11144477735' },
          { tipo: 'RÉU', nome: 'B', cpf: '52998224725' },
        ],
        'P-1',
      ),
      processWith(
        [
          { tipo: 'AUTOR', nome: 'A', cpf: '11144477735' },
          { tipo: 'RÉU', nome: 'B', cpf: '52998224725' },
        ],
        'P-2',
      ),
    ];
    const { edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    const coParty = edges.filter((e) => e.kind === 'co_party');
    expect(coParty).toHaveLength(2);
    expect(coParty.map((e) => processEvidence(e).processNumber).sort()).toEqual(['P-1', 'P-2']);
  });

  it('skips advogados block when partes list is empty', () => {
    const payload = [processWith([])];
    const { nodes, edges } = extractGraph({ payload, searchedHash: HASH_CPF_A });
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });
});
