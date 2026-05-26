// lib/netrin/parsers/pivot-cnpjs.ts
import type { NetrinCompositePayload } from '@/lib/netrin/types.ts';

type Negocio = {
  entidadeRelacionadaDocumento?: unknown;
  entidadeRelacionadadaTipoDeDocumento?: unknown;
};

export function extractPivotCnpjs(payload: NetrinCompositePayload): string[] {
  const slug = (payload as Record<string, unknown>).empresasRelacionadasCPF as
    | { negociosRelacionados?: unknown }
    | null
    | undefined;
  const list = slug?.negociosRelacionados;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list as Negocio[]) {
    if (item?.entidadeRelacionadadaTipoDeDocumento !== 'CNPJ') continue;
    const raw =
      typeof item?.entidadeRelacionadaDocumento === 'string'
        ? item.entidadeRelacionadaDocumento.replace(/\D/g, '')
        : '';
    if (raw.length !== 14) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}
