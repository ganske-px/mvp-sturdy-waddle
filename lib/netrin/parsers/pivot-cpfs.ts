// lib/netrin/parsers/pivot-cpfs.ts
import type { NetrinCompositePayload } from '@/lib/netrin/types';

export type PivotCpf = {
  cpf: string;
  vinculo: string;
  dataInicio?: string;
  dataFim?: string;
  percentualParticipacao?: number;
  ativo: boolean;
};

type Entidade = {
  cpf?: unknown;
  vinculoDoRelacionamento?: unknown;
  dataInicioRelacionamento?: unknown;
  dataFimRelacionamento?: unknown;
  percentualParticipacaoSociedade?: unknown;
};

export function extractPivotCpfs(payload: NetrinCompositePayload): PivotCpf[] {
  const slug = payload['pessoas-relacionadas-cnpj'] as
    | { entidadesRelacionadas?: unknown }
    | null
    | undefined;
  const list = slug?.entidadesRelacionadas;
  if (!Array.isArray(list)) return [];

  const seen = new Set<string>();
  const out: PivotCpf[] = [];
  for (const itemUnknown of list as Entidade[]) {
    const item = itemUnknown;
    const cpfRaw = typeof item?.cpf === 'string' ? item.cpf.replace(/\D/g, '') : '';
    if (cpfRaw.length !== 11) continue;
    if (seen.has(cpfRaw)) continue;
    seen.add(cpfRaw);

    const vinculo =
      typeof item.vinculoDoRelacionamento === 'string'
        ? item.vinculoDoRelacionamento
        : 'INDEFINIDO';
    const dataInicio =
      typeof item.dataInicioRelacionamento === 'string'
        ? item.dataInicioRelacionamento
        : undefined;
    const dataFim =
      typeof item.dataFimRelacionamento === 'string' ? item.dataFimRelacionamento : undefined;
    const pct =
      typeof item.percentualParticipacaoSociedade === 'number'
        ? item.percentualParticipacaoSociedade
        : undefined;
    const ativo = !dataFim || dataFim === '9999-12-31';

    out.push({ cpf: cpfRaw, vinculo, dataInicio, dataFim, percentualParticipacao: pct, ativo });
  }
  return out;
}
