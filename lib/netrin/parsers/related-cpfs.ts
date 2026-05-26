// lib/netrin/parsers/related-cpfs.ts
import type { NetrinCompositePayload } from '@/lib/netrin/types.ts';

export type RelatedCpf = {
  cpf: string;
  nome?: string;
  tipoRelacionamento: string;
  nivel?: string;
};

type Entidade = {
  entidadeRelacionadaDocumento?: unknown;
  entidadeRelacionadadaTipoDeDocumento?: unknown;
  entidadeRelacionadaNome?: unknown;
  tipoDeRelacionamento?: unknown;
  nivelDeRelacionamento?: unknown;
};

export function extractRelatedCpfs(payload: NetrinCompositePayload): RelatedCpf[] {
  const slug = (payload as Record<string, unknown>).pessoasRelacionadasCPF as
    | { entidadesRelacionadas?: unknown }
    | null
    | undefined;
  const list = slug?.entidadesRelacionadas;
  if (!Array.isArray(list)) return [];

  const seen = new Set<string>();
  const out: RelatedCpf[] = [];
  for (const item of list as Entidade[]) {
    if (item?.entidadeRelacionadadaTipoDeDocumento !== 'CPF') continue;
    const cpf =
      typeof item.entidadeRelacionadaDocumento === 'string'
        ? item.entidadeRelacionadaDocumento.replace(/\D/g, '')
        : '';
    if (cpf.length !== 11) continue;
    if (seen.has(cpf)) continue;
    seen.add(cpf);

    out.push({
      cpf,
      nome:
        typeof item.entidadeRelacionadaNome === 'string' ? item.entidadeRelacionadaNome : undefined,
      tipoRelacionamento:
        typeof item.tipoDeRelacionamento === 'string' ? item.tipoDeRelacionamento : 'INDEFINIDO',
      nivel:
        typeof item.nivelDeRelacionamento === 'string' ? item.nivelDeRelacionamento : undefined,
    });
  }
  return out;
}
