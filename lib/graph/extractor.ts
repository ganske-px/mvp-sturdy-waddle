// Relative (not @/) so the Supabase edge bundler can follow these value
// imports — its dependency walker does not apply the deno.json import map.
import { hashDocument } from '../hash.ts';
import { mask as maskCnpj } from '../validators/cnpj.ts';
import { mask as maskCpf } from '../validators/cpf.ts';
import type {
  ExtractGraphInput,
  ExtractedEdge,
  ExtractedGraph,
  ExtractedNode,
  NodeType,
} from './types.ts';

type PartyShape = {
  tipo?: string;
  nome?: string;
  cpf?: string;
  cnpj?: string;
  advogados?: LawyerShape[];
};

type LawyerShape = {
  nome?: string;
  oab?: { uf?: string; numero?: string };
};

type PartyNodeInfo = {
  hash: string;
  type: NodeType;
  tipo: string | null;
};

type LawyerNodeInfo = {
  hash: string;
  uf: string;
  numero: string;
};

function maskLawyer(name: string | undefined, uf: string, numero: string): string {
  const first = (name ?? 'Advogado').split(/\s+/)[0] ?? 'Advogado';
  return `${first[0] ?? ''}. *** — OAB/${uf} ${numero}`;
}

function asPartyNode(parte: PartyShape): { info: PartyNodeInfo; node: ExtractedNode } | null {
  const cnpjRaw = typeof parte.cnpj === 'string' ? parte.cnpj.replace(/\D/g, '') : '';
  const cpfRaw = typeof parte.cpf === 'string' ? parte.cpf.replace(/\D/g, '') : '';
  if (cnpjRaw.length === 14) {
    const hash = hashDocument('cnpj', cnpjRaw);
    return {
      info: { hash, type: 'cnpj', tipo: parte.tipo?.trim() || null },
      node: {
        nodeHash: hash,
        nodeType: 'cnpj',
        label: { name: parte.nome, document: cnpjRaw },
        maskedPreview: `${(parte.nome ?? '').slice(0, 24)} — ${maskCnpj(cnpjRaw)}`,
      },
    };
  }
  if (cpfRaw.length === 11) {
    const hash = hashDocument('cpf', cpfRaw);
    return {
      info: { hash, type: 'cpf', tipo: parte.tipo?.trim() || null },
      node: {
        nodeHash: hash,
        nodeType: 'cpf',
        label: { name: parte.nome, document: cpfRaw },
        maskedPreview: `${(parte.nome ?? '').slice(0, 24)} — ${maskCpf(cpfRaw)}`,
      },
    };
  }
  return null;
}

function asLawyerNode(adv: LawyerShape): { info: LawyerNodeInfo; node: ExtractedNode } | null {
  const uf = adv.oab?.uf?.trim().toUpperCase();
  const numero = adv.oab?.numero?.toString().trim();
  if (!uf || !numero || !/^[A-Z]{2}$/.test(uf) || !/^\d+$/.test(numero)) return null;
  const hash = hashDocument('lawyer', `${uf}-${numero}`);
  return {
    info: { hash, uf, numero },
    node: {
      nodeHash: hash,
      nodeType: 'lawyer',
      label: { name: adv.nome, oab: { uf, numero } },
      maskedPreview: maskLawyer(adv.nome, uf, numero),
    },
  };
}

function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function computeSamePolo(a: string | null, b: string | null): boolean | null {
  if (!a || !b) return null;
  return a === b;
}

export function extractGraph({ payload }: ExtractGraphInput): ExtractedGraph {
  const nodeMap = new Map<string, ExtractedNode>();
  const edges: ExtractedEdge[] = [];

  for (const process of payload) {
    const processNumber =
      typeof process.numeroProcessoUnico === 'string' ? process.numeroProcessoUnico : '';
    const rawParties = Array.isArray(process.partes) ? process.partes : [];

    const partyEntries: Array<{ info: PartyNodeInfo; lawyerHashes: string[] }> = [];

    for (const parteUnknown of rawParties) {
      const parte = parteUnknown as PartyShape;
      const partyResult = asPartyNode(parte);
      if (!partyResult) continue;
      if (!nodeMap.has(partyResult.info.hash)) {
        nodeMap.set(partyResult.info.hash, partyResult.node);
      }

      const lawyerHashes: string[] = [];
      const rawAdvogados = Array.isArray(parte.advogados) ? parte.advogados : [];
      for (const advUnknown of rawAdvogados) {
        const advResult = asLawyerNode(advUnknown as LawyerShape);
        if (!advResult) continue;
        if (!nodeMap.has(advResult.info.hash)) {
          nodeMap.set(advResult.info.hash, advResult.node);
        }
        if (advResult.info.hash !== partyResult.info.hash) {
          edges.push({
            sourceHash: partyResult.info.hash,
            targetHash: advResult.info.hash,
            kind: 'client_lawyer',
            evidence: { processNumber, samePolo: null },
          });
        }
        lawyerHashes.push(advResult.info.hash);
      }
      partyEntries.push({ info: partyResult.info, lawyerHashes });
    }

    for (let i = 0; i < partyEntries.length; i++) {
      for (let j = i + 1; j < partyEntries.length; j++) {
        const a = partyEntries[i];
        const b = partyEntries[j];
        if (!a || !b) continue;
        if (a.info.hash === b.info.hash) continue;
        const [src, tgt] = orderedPair(a.info.hash, b.info.hash);
        edges.push({
          sourceHash: src,
          targetHash: tgt,
          kind: 'co_party',
          evidence: {
            processNumber,
            samePolo: computeSamePolo(a.info.tipo, b.info.tipo),
          },
        });
      }
    }

    const allLawyers = Array.from(new Set(partyEntries.flatMap((p) => p.lawyerHashes)));
    for (let i = 0; i < allLawyers.length; i++) {
      for (let j = i + 1; j < allLawyers.length; j++) {
        const a = allLawyers[i];
        const b = allLawyers[j];
        if (!a || !b || a === b) continue;
        const [src, tgt] = orderedPair(a, b);
        edges.push({
          sourceHash: src,
          targetHash: tgt,
          kind: 'lawyer_lawyer',
          evidence: { processNumber, samePolo: null },
        });
      }
    }
  }

  return { nodes: Array.from(nodeMap.values()), edges };
}
