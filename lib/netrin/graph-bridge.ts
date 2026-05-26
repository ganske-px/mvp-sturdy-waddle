import type {
  CorporateEdgeEvidence,
  ExtractedEdge,
  ExtractedGraph,
  ExtractedNode,
} from '@/lib/graph/types.ts';
import { hashDocument } from '@/lib/hash.ts';
import { mask as maskCnpj } from '@/lib/validators/cnpj.ts';
import { mask as maskCpf } from '@/lib/validators/cpf.ts';
import { extractRelatedCompanies } from './parsers/related-companies.ts';
import { extractCnpjRisk, extractCpfRisk } from './parsers/risk-flags.ts';
import type { NetrinCompositePayload, NetrinDocumentType } from './types.ts';

export type GraphBridgeInput = {
  rootDocument: { type: NetrinDocumentType; raw: string; name?: string };
  /** Payload from a CPF search (Hop1 slugs). Null/undefined when this build is not driven by a CPF search. */
  cpfPayload?: NetrinCompositePayload | null;
  /** Payloads from CNPJ searches. Key = raw CNPJ string (14 digits). */
  cnpjPayloads?: Record<string, NetrinCompositePayload>;
};

type Entidade = {
  cpf?: unknown;
  nome?: unknown;
  vinculoDoRelacionamento?: unknown;
  dataInicioRelacionamento?: unknown;
  dataFimRelacionamento?: unknown;
  percentualParticipacaoSociedade?: unknown;
};

type RelatedEntity = {
  entidadeRelacionadaDocumento?: unknown;
  entidadeRelacionadadaTipoDeDocumento?: unknown;
  entidadeRelacionadaNome?: unknown;
  tipoDeRelacionamento?: unknown;
  nivelDeRelacionamento?: unknown;
};

function makeCpfNode(cpfRaw: string, name?: string): ExtractedNode {
  return {
    nodeHash: hashDocument('cpf', cpfRaw),
    nodeType: 'cpf',
    label: { name, document: cpfRaw },
    maskedPreview: `${(name ?? '').slice(0, 24)} — ${maskCpf(cpfRaw)}`,
  };
}

function makeCnpjNode(cnpjRaw: string, name?: string): ExtractedNode {
  return {
    nodeHash: hashDocument('cnpj', cnpjRaw),
    nodeType: 'cnpj',
    label: { name, document: cnpjRaw },
    maskedPreview: `${(name ?? '').slice(0, 24)} — ${maskCnpj(cnpjRaw)}`,
  };
}

function corporateEvidenceFromEntidade(e: Entidade): CorporateEdgeEvidence {
  return {
    vinculo:
      typeof e.vinculoDoRelacionamento === 'string' ? e.vinculoDoRelacionamento : 'INDEFINIDO',
    percentualParticipacao:
      typeof e.percentualParticipacaoSociedade === 'number'
        ? e.percentualParticipacaoSociedade
        : undefined,
    dataInicioRelacionamento:
      typeof e.dataInicioRelacionamento === 'string' ? e.dataInicioRelacionamento : undefined,
    dataFimRelacionamento:
      typeof e.dataFimRelacionamento === 'string' ? e.dataFimRelacionamento : undefined,
    source: 'pessoas-relacionadas-cnpj',
  };
}

export function buildNetrinGraph(input: GraphBridgeInput): ExtractedGraph {
  const nodeMap = new Map<string, ExtractedNode>();
  const edges: ExtractedEdge[] = [];

  // Root node
  if (input.rootDocument.type === 'cpf' && input.rootDocument.raw.length === 11) {
    const node = makeCpfNode(input.rootDocument.raw, input.rootDocument.name);
    if (input.cpfPayload) node.risk = extractCpfRisk(input.cpfPayload);
    nodeMap.set(node.nodeHash, node);
  } else if (input.rootDocument.type === 'cnpj' && input.rootDocument.raw.length === 14) {
    const node = makeCnpjNode(input.rootDocument.raw, input.rootDocument.name);
    const rootPayload = input.cnpjPayloads?.[input.rootDocument.raw];
    if (rootPayload) node.risk = extractCnpjRisk(rootPayload);
    nodeMap.set(node.nodeHash, node);
  }

  // CPF root → relaciona CNPJs de empresas
  if (input.cpfPayload) {
    for (const empresa of extractRelatedCompanies(input.cpfPayload)) {
      const node = makeCnpjNode(empresa.cnpj, empresa.razaoSocial);
      nodeMap.set(node.nodeHash, node);
      if (input.rootDocument.type === 'cpf') {
        edges.push({
          sourceHash: hashDocument('cpf', input.rootDocument.raw),
          targetHash: node.nodeHash,
          kind: 'corporate_relation',
          evidence: {
            vinculo: empresa.vinculo,
            dataInicioRelacionamento: empresa.dataInicio,
            dataFimRelacionamento: empresa.dataFim,
            source: 'empresas-relacionadas-cpf',
          },
        });
      }
    }
  }

  // CPF root → pessoas relacionadas (família)
  if (
    input.cpfPayload &&
    input.rootDocument.type === 'cpf' &&
    input.rootDocument.raw.length === 11
  ) {
    const rootHash = hashDocument('cpf', input.rootDocument.raw);
    const slug = (input.cpfPayload as Record<string, unknown>).pessoasRelacionadasCPF as
      | { entidadesRelacionadas?: unknown }
      | null
      | undefined;
    const list = Array.isArray(slug?.entidadesRelacionadas)
      ? (slug?.entidadesRelacionadas as RelatedEntity[])
      : [];
    for (const item of list) {
      if (item.entidadeRelacionadadaTipoDeDocumento !== 'CPF') continue;
      const cpfRaw =
        typeof item.entidadeRelacionadaDocumento === 'string'
          ? item.entidadeRelacionadaDocumento.replace(/\D/g, '')
          : '';
      if (cpfRaw.length !== 11) continue;
      const node = makeCpfNode(
        cpfRaw,
        typeof item.entidadeRelacionadaNome === 'string' ? item.entidadeRelacionadaNome : undefined,
      );
      nodeMap.set(node.nodeHash, node);
      edges.push({
        sourceHash: rootHash,
        targetHash: node.nodeHash,
        kind: 'family_relation',
        evidence: {
          tipoRelacionamento:
            typeof item.tipoDeRelacionamento === 'string'
              ? item.tipoDeRelacionamento
              : 'INDEFINIDO',
          nivel:
            typeof item.nivelDeRelacionamento === 'string' ? item.nivelDeRelacionamento : undefined,
          source: 'pessoas-relacionadas-cpf',
        },
      });
    }
  }

  // CNPJ payloads → sócios CPF
  for (const [cnpjRaw, payload] of Object.entries(input.cnpjPayloads ?? {})) {
    if (cnpjRaw.length !== 14) continue;
    const cnpjHash = hashDocument('cnpj', cnpjRaw);
    if (!nodeMap.has(cnpjHash)) {
      nodeMap.set(cnpjHash, makeCnpjNode(cnpjRaw));
    }
    const slug = payload['pessoas-relacionadas-cnpj'] as
      | { entidadesRelacionadas?: unknown }
      | null
      | undefined;
    const list = Array.isArray(slug?.entidadesRelacionadas)
      ? (slug?.entidadesRelacionadas as Entidade[])
      : [];
    for (const item of list) {
      const cpfRaw = typeof item.cpf === 'string' ? item.cpf.replace(/\D/g, '') : '';
      if (cpfRaw.length !== 11) continue;

      const partnerName = typeof item.nome === 'string' ? item.nome : undefined;
      const socioNode = makeCpfNode(cpfRaw, partnerName);
      nodeMap.set(socioNode.nodeHash, socioNode);
      edges.push({
        sourceHash: cnpjHash,
        targetHash: socioNode.nodeHash,
        kind: 'corporate_relation',
        evidence: corporateEvidenceFromEntidade(item),
      });
    }
  }

  return { nodes: Array.from(nodeMap.values()), edges };
}
