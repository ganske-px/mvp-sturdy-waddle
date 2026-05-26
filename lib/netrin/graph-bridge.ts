import type {
  CorporateEdgeEvidence,
  ExtractedEdge,
  ExtractedGraph,
  ExtractedNode,
} from '@/lib/graph/types';
import { hashDocument } from '@/lib/hash';
import { mask as maskCnpj } from '@/lib/validators/cnpj';
import { mask as maskCpf } from '@/lib/validators/cpf';
import type { NetrinCompositePayload, NetrinDocumentType } from './types';

export type GraphBridgeInput = {
  rootDocument: { type: NetrinDocumentType; raw: string; name?: string };
  hop1Payload: NetrinCompositePayload | null;
  hop2Payloads: Record<string, NetrinCompositePayload>; // key: cnpj raw 14 dígitos
};

type Negocio = {
  cnpj?: unknown;
  razaoSocial?: unknown;
  tipoVinculo?: unknown;
  vinculoDoRelacionamento?: unknown;
  dataInicioRelacionamento?: unknown;
  dataFimRelacionamento?: unknown;
  percentualParticipacao?: unknown;
};

type Entidade = {
  cpf?: unknown;
  nome?: unknown;
  vinculoDoRelacionamento?: unknown;
  dataInicioRelacionamento?: unknown;
  dataFimRelacionamento?: unknown;
  percentualParticipacaoSociedade?: unknown;
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

function corporateEvidenceFromNegocio(
  n: Negocio,
  source: CorporateEdgeEvidence['source'],
): CorporateEdgeEvidence {
  const vinculo =
    typeof n.tipoVinculo === 'string'
      ? n.tipoVinculo
      : typeof n.vinculoDoRelacionamento === 'string'
        ? n.vinculoDoRelacionamento
        : 'INDEFINIDO';
  return {
    vinculo,
    percentualParticipacao:
      typeof n.percentualParticipacao === 'number' ? n.percentualParticipacao : undefined,
    dataInicioRelacionamento:
      typeof n.dataInicioRelacionamento === 'string' ? n.dataInicioRelacionamento : undefined,
    dataFimRelacionamento:
      typeof n.dataFimRelacionamento === 'string' ? n.dataFimRelacionamento : undefined,
    source,
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
    nodeMap.set(node.nodeHash, node);
  } else if (input.rootDocument.type === 'cnpj' && input.rootDocument.raw.length === 14) {
    const node = makeCnpjNode(input.rootDocument.raw, input.rootDocument.name);
    nodeMap.set(node.nodeHash, node);
  }

  // Hop 1: CPF root → relaciona CNPJs de empresas
  if (input.hop1Payload) {
    const slug = input.hop1Payload['empresas-relacionadas-cpf'] as
      | { negociosRelacionados?: unknown }
      | null
      | undefined;
    const list = Array.isArray(slug?.negociosRelacionados)
      ? (slug?.negociosRelacionados as Negocio[])
      : [];
    for (const item of list) {
      const cnpjRaw = typeof item.cnpj === 'string' ? item.cnpj.replace(/\D/g, '') : '';
      if (cnpjRaw.length !== 14) continue;
      const node = makeCnpjNode(
        cnpjRaw,
        typeof item.razaoSocial === 'string' ? item.razaoSocial : undefined,
      );
      nodeMap.set(node.nodeHash, node);
      if (input.rootDocument.type === 'cpf') {
        edges.push({
          sourceHash: hashDocument('cpf', input.rootDocument.raw),
          targetHash: node.nodeHash,
          kind: 'corporate_relation',
          evidence: corporateEvidenceFromNegocio(item, 'empresas-relacionadas-cpf'),
        });
      }
    }
  }

  // Hop 2: CNPJ → sócios CPF
  for (const [cnpjRaw, payload] of Object.entries(input.hop2Payloads)) {
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
      const socioNode = makeCpfNode(cpfRaw, typeof item.nome === 'string' ? item.nome : undefined);
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
