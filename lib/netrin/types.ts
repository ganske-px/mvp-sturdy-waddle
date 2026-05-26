// lib/netrin/types.ts

export type NetrinDocumentType = 'cpf' | 'cnpj';

export const CPF_SLUGS = [
  'pep-kyc-cpf',
  'empresas-relacionadas-cpf',
  'receita-federal-cpf-data-nascimento',
  'midias-consolidado',
] as const;

export const CNPJ_SLUGS = [
  'esp-cnpj-completo',
  'receita-federal-cnpj',
  'receita-federal-cnpj-qsa',
  'informacoes-socios-pj',
  'pessoas-relacionadas-cnpj',
  'pep-kyc-cnpj',
  'midias-consolidado',
  'processos-cnpj',
  'portal-transparencia-ceis',
  'portal-transparencia-cnep',
  'trabalho-escravo',
] as const;

// Deprecated — kept until Tasks 2 (delete hop3.ts) and 8 (drop hop3 from graph-bridge) land.
// At that point this const and its contribution to NetrinSlug can be removed.
export const HOP3_SLUGS = [
  'esp-cpf',
  'pep-kyc-cpf',
  'midias-consolidado',
  'processos-cpf',
  'empresas-relacionadas-cpf',
] as const;

export type NetrinSlug =
  | (typeof CPF_SLUGS)[number]
  | (typeof CNPJ_SLUGS)[number]
  | (typeof HOP3_SLUGS)[number];

export type NetrinCompositePayload = Partial<Record<NetrinSlug, unknown>>;

export class NetrinError extends Error {
  readonly status: number | undefined;
  readonly slugs: readonly NetrinSlug[];
  constructor(message: string, opts: { status?: number; slugs: readonly NetrinSlug[] }) {
    super(message);
    this.name = 'NetrinError';
    this.status = opts.status;
    this.slugs = opts.slugs;
  }
}

export type NetrinClientConfig = {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  initialBackoffMs?: number;
  pepAcuracia?: number;
};
