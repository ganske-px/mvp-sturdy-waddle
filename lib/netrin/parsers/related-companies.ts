// lib/netrin/parsers/related-companies.ts
import type { NetrinCompositePayload } from '@/lib/netrin/types.ts';

export type RelatedCompany = {
  cnpj: string;
  razaoSocial?: string;
  vinculo: string;
  dataInicio?: string;
  dataFim?: string;
};

type Negocio = {
  entidadeRelacionadaDocumento?: unknown;
  entidadeRelacionadadaTipoDeDocumento?: unknown;
  entidadeRelacionadaNome?: unknown;
  tipoDeRelacionamento?: unknown;
  dataInicioRelacionamento?: unknown;
  dataFimRelacionamento?: unknown;
};

export function extractRelatedCompanies(payload: NetrinCompositePayload): RelatedCompany[] {
  const slug = (payload as Record<string, unknown>).empresasRelacionadasCPF as
    | { negociosRelacionados?: unknown }
    | null
    | undefined;
  const list = slug?.negociosRelacionados;
  if (!Array.isArray(list)) return [];

  const seen = new Set<string>();
  const out: RelatedCompany[] = [];
  for (const item of list as Negocio[]) {
    if (item?.entidadeRelacionadadaTipoDeDocumento !== 'CNPJ') continue;
    const cnpj =
      typeof item.entidadeRelacionadaDocumento === 'string'
        ? item.entidadeRelacionadaDocumento.replace(/\D/g, '')
        : '';
    if (cnpj.length !== 14) continue;
    if (seen.has(cnpj)) continue;
    seen.add(cnpj);
    out.push({
      cnpj,
      razaoSocial:
        typeof item.entidadeRelacionadaNome === 'string' ? item.entidadeRelacionadaNome : undefined,
      vinculo:
        typeof item.tipoDeRelacionamento === 'string' ? item.tipoDeRelacionamento : 'INDEFINIDO',
      dataInicio:
        typeof item.dataInicioRelacionamento === 'string'
          ? item.dataInicioRelacionamento
          : undefined,
      dataFim:
        typeof item.dataFimRelacionamento === 'string' ? item.dataFimRelacionamento : undefined,
    });
  }
  return out;
}
