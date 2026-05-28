import type { NodeType } from './types.ts';

export type InvestigatePlan =
  | { ok: true; type: 'cpf' | 'cnpj'; document: string }
  | { ok: false; error: string };

const MALFORMED = 'Não foi possível recuperar o documento deste nó.';

/**
 * Decide, a partir de um nó do grafo, qual busca disparar. Puro e testável:
 * a Server Action `investigateNode` só recupera o documento (decrypt) e delega
 * a decisão aqui antes de chamar a pipeline real.
 */
export function planNodeInvestigation(node: {
  type: NodeType;
  document?: string;
}): InvestigatePlan {
  if (node.type === 'lawyer') {
    return { ok: false, error: 'Advogados não podem ser investigados por documento.' };
  }
  const document = (node.document ?? '').replace(/\D/g, '');
  if (node.type === 'cpf' && document.length !== 11) return { ok: false, error: MALFORMED };
  if (node.type === 'cnpj' && document.length !== 14) return { ok: false, error: MALFORMED };
  return { ok: true, type: node.type, document };
}
