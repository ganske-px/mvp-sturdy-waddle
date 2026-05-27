// lib/netrin/parsers/media-detail.ts
import type { NetrinCompositePayload } from '@/lib/netrin/types.ts';
import { maskDocument } from './mask-document';

export type MediaMention = {
  titulo?: string;
  fonte?: string;
  dataNoticia?: string;
  uf?: string;
  regiao?: string;
  tipoSuspeita?: string;
  envolvimento?: string;
  atividade?: string;
  citacao?: string;
  linkNoticia?: string;
  nomeCpf?: string;
  cpfMascarado?: string;
  nomeExato?: string;
};

export type MediaListItem = Record<string, string>;

export type MediaDetail = {
  mentions: MediaMention[];
  restritivas: MediaListItem[];
  governamentais: MediaListItem[];
  socioambientais: MediaListItem[];
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/**
 * Sanitizes an arbitrary list-item record for the client: stringifies scalar
 * values, masks any document-like value (LGPD), and drops nested/empty fields.
 */
function sanitizeListItem(raw: unknown): MediaListItem {
  if (!raw || typeof raw !== 'object') return {};
  const out: MediaListItem = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') {
      if (value === '') continue;
      out[key] = maskDocument(value) ?? value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = String(value);
    }
  }
  return out;
}

function sanitizeList(
  parent: Record<string, unknown> | null | undefined,
  slugKey: string,
  innerKey: string,
): MediaListItem[] {
  const slug = parent?.[slugKey] as Record<string, unknown> | null | undefined;
  const inner = slug?.[innerKey];
  if (!Array.isArray(inner)) return [];
  return inner.map(sanitizeListItem).filter((item) => Object.keys(item).length > 0);
}

type RawMidia = {
  titulo?: unknown;
  fonte?: unknown;
  data_noticia?: unknown;
  uf?: unknown;
  regiao?: unknown;
  tipo_suspeita?: unknown;
  envolvimento?: unknown;
  atividade?: unknown;
  citacao?: unknown;
  dtec_link_noticia?: unknown;
  nome_cpf?: unknown;
  cpf?: unknown;
  nome_exato?: unknown;
};

/**
 * Reads `midiasConsolidado` — individual media mentions plus the restritivas /
 * governamentais / socioambientais lists. Any CPF/CNPJ is masked before
 * crossing to the client; news text and proper names go through in cleartext
 * (that is the content the operator must evaluate).
 */
export function extractMediaDetail(payload: NetrinCompositePayload): MediaDetail {
  const slug = (payload as Record<string, unknown>).midiasConsolidado as
    | Record<string, unknown>
    | null
    | undefined;

  const publicas = slug?.midiasPublicas as { midias?: unknown } | null | undefined;
  const midias = Array.isArray(publicas?.midias) ? (publicas.midias as RawMidia[]) : [];

  const mentions = midias.map(
    (m): MediaMention => ({
      titulo: str(m.titulo),
      fonte: str(m.fonte),
      dataNoticia: str(m.data_noticia),
      uf: str(m.uf),
      regiao: str(m.regiao),
      tipoSuspeita: str(m.tipo_suspeita),
      envolvimento: str(m.envolvimento),
      atividade: str(m.atividade),
      citacao: str(m.citacao),
      linkNoticia: str(m.dtec_link_noticia),
      nomeCpf: str(m.nome_cpf),
      cpfMascarado: maskDocument(m.cpf),
      nomeExato: str(m.nome_exato),
    }),
  );

  return {
    mentions,
    restritivas: sanitizeList(slug, 'midiasListasRestritivas', 'listas'),
    governamentais: sanitizeList(slug, 'midiasListasGovernamentais', 'governamentais'),
    socioambientais: sanitizeList(slug, 'midiasListasSocioambientais', 'socioambientais'),
  };
}
