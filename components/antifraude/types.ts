// components/antifraude/types.ts
export type AntifraudeStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'cache_hit'
  | 'missing';

export type IdentityCardProps = {
  status: AntifraudeStatus;
  nome?: string;
  dataNascimento?: string;
  situacaoCadastral?: string;
};

export type PepCardProps = {
  status: AntifraudeStatus;
  currentlyPEP?: boolean;
  currentlySanctioned?: boolean;
  historicoCount?: number;
};

export type MediaCardProps = {
  status: AntifraudeStatus;
  mencoes?: number;
  itens?: { titulo: string; url?: string; data?: string }[];
};

export type RestrictionsCardProps = {
  status: AntifraudeStatus;
  apostasImpedido?: boolean;
};

export type RelatedCompanyEntry = {
  cnpj: string;
  razaoSocial?: string;
  vinculo?: string;
  ativo: boolean;
  dataInicio?: string;
  dataFim?: string;
  hop2?: {
    situacaoCadastral?: string;
    capitalSocial?: number;
    sancionado?: boolean;
    sociosCpfHashes?: string[];
  };
};
export type RelatedCompaniesProps = {
  status: AntifraudeStatus;
  items: RelatedCompanyEntry[];
};
