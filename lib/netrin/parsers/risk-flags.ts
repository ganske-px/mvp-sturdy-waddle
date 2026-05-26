// lib/netrin/parsers/risk-flags.ts
import type { NetrinCompositePayload } from '@/lib/netrin/types.ts';

export type RiskFlags = { isPep: boolean; hasSanction: boolean };

function isSim(v: unknown): boolean {
  return v === true || v === 'Sim' || v === 'SIM' || v === 'S';
}

export function extractCpfRisk(payload: NetrinCompositePayload): RiskFlags {
  const slug = (payload as Record<string, unknown>).pepKyc as
    | { currentlyPEP?: unknown; currentlySanctioned?: unknown; previouslySanctioned?: unknown }
    | null
    | undefined;
  return {
    isPep: isSim(slug?.currentlyPEP),
    hasSanction: isSim(slug?.currentlySanctioned) || isSim(slug?.previouslySanctioned),
  };
}

export function extractCnpjRisk(payload: NetrinCompositePayload): RiskFlags {
  const p = payload as Record<string, unknown>;
  const pep = p['pep-kyc-cnpj'] as { sancionado?: unknown } | null | undefined;
  const ceis = p['portal-transparencia-ceis'] as
    | { sancoes?: Array<{ ativo?: unknown }> }
    | null
    | undefined;
  const cnep = p['portal-transparencia-cnep'] as
    | { sancoes?: Array<{ ativo?: unknown }> }
    | null
    | undefined;
  const trab = p['trabalho-escravo'] as { empregador?: unknown[] } | null | undefined;

  const ceisAtivo = (ceis?.sancoes ?? []).some((c) => c?.ativo === true);
  const cnepAtivo = (cnep?.sancoes ?? []).some((c) => c?.ativo === true);
  const trabEscravo = Array.isArray(trab?.empregador) && trab.empregador.length > 0;

  return {
    isPep: false, // pep-kyc-cnpj não expõe PEP de PJ; só sanção
    hasSanction: isSim(pep?.sancionado) || ceisAtivo || cnepAtivo || trabEscravo,
  };
}
