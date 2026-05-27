// components/antifraude/types.ts
import type { MediaDetail } from '@/lib/netrin/parsers/media-detail';
import type { PepHistoryEntry } from '@/lib/netrin/parsers/pep-detail';
import type { SanctionMatch } from '@/lib/netrin/parsers/sanctions-detail';

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
  nomeMae?: string;
  idade?: number;
  genero?: string;
};

export type PepCardProps = {
  status: AntifraudeStatus;
  currentlyPEP?: boolean;
  currentlySanctioned?: boolean;
  previouslySanctioned?: boolean;
  historicoCount?: number;
  sanctions?: SanctionMatch[];
  pepHistory?: PepHistoryEntry[];
  bare?: boolean;
};

export type MediaCardProps = {
  status: AntifraudeStatus;
  mencoes?: number;
  qtdMidias?: number;
  qtdListas?: number;
  qtdGov?: number;
  qtdAmb?: number;
  mediaDetail?: MediaDetail;
  bare?: boolean;
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
  currentPath?: string;
  bare?: boolean;
};

export type RelatedPersonEntry = {
  cpfHash: string;
  maskedPreview: string;
  nome?: string;
  tipoRelacionamento?: string;
  hasCached: boolean;
};
