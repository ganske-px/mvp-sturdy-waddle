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

export type NetrinSlug = (typeof CPF_SLUGS)[number] | (typeof CNPJ_SLUGS)[number];

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
