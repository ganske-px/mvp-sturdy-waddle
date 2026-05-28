// lib/netrin/parsers/cnpj-sanctions-detail.ts

export type CnpjSanctionEntry = { ativo: boolean; descricao?: string };

export type CnpjSanctions = {
  sancionado?: boolean;
  ceis?: CnpjSanctionEntry[];
  cnep?: CnpjSanctionEntry[];
  trabalhoEscravo?: boolean;
};

export type SanctionCounts = {
  ceisAtivos: number;
  ceisInativos: number;
  cnepAtivos: number;
  cnepInativos: number;
  total: number;
};

/**
 * Counts CEIS/CNEP entries by active/inactive. Operates on the already-extracted
 * sanction props shared by `SancoesCardCnpj` and its drawer — no payload parsing.
 */
export function countSanctions(s: Pick<CnpjSanctions, 'ceis' | 'cnep'>): SanctionCounts {
  const ceis = s.ceis ?? [];
  const cnep = s.cnep ?? [];
  const ceisAtivos = ceis.filter((c) => c.ativo).length;
  const cnepAtivos = cnep.filter((c) => c.ativo).length;
  return {
    ceisAtivos,
    ceisInativos: ceis.length - ceisAtivos,
    cnepAtivos,
    cnepInativos: cnep.length - cnepAtivos,
    total: ceis.length + cnep.length,
  };
}
