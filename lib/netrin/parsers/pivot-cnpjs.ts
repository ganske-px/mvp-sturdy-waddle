// lib/netrin/parsers/pivot-cnpjs.ts
import type { NetrinCompositePayload } from '@/lib/netrin/types';

type Negocio = { cnpj?: unknown };

export function extractPivotCnpjs(payload: NetrinCompositePayload): string[] {
  const slug = payload['empresas-relacionadas-cpf'] as
    | { negociosRelacionados?: unknown }
    | null
    | undefined;
  const list = slug?.negociosRelacionados;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list as Negocio[]) {
    const raw = typeof item?.cnpj === 'string' ? item.cnpj.replace(/\D/g, '') : '';
    if (raw.length !== 14) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}
