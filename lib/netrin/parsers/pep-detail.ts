// lib/netrin/parsers/pep-detail.ts
import type { NetrinCompositePayload } from '@/lib/netrin/types.ts';
import { maskDocument } from './mask-document';

export type PepHistoryEntry = {
  level?: string;
  jobTitle?: string;
  department?: string;
  motive?: string;
  source?: string;
  document?: string;
  documentPEP?: string;
  startDate?: string;
  endDate?: string;
  lastUpdateDate?: string;
};

type RawPep = {
  level?: unknown;
  jobTitle?: unknown;
  department?: unknown;
  motive?: unknown;
  source?: unknown;
  document?: unknown;
  documentPEP?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  lastUpdateDate?: unknown;
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/**
 * Reads `pepKyc.historyPEP[]`, dropping placeholder rows (the API ships rows
 * where every field is empty). `document`/`documentPEP` are masked so no
 * CPF/CNPJ reaches the client in cleartext.
 */
export function extractPepHistory(payload: NetrinCompositePayload): PepHistoryEntry[] {
  const slug = (payload as Record<string, unknown>).pepKyc as
    | { historyPEP?: unknown }
    | null
    | undefined;
  const list = slug?.historyPEP;
  if (!Array.isArray(list)) return [];

  const isNonEmpty = (row: unknown): boolean =>
    !!row &&
    typeof row === 'object' &&
    Object.values(row as Record<string, unknown>).some((v) => v !== '' && v !== 0 && v != null);

  return (list as RawPep[]).filter(isNonEmpty).map(
    (row): PepHistoryEntry => ({
      level: str(row.level),
      jobTitle: str(row.jobTitle),
      department: str(row.department),
      motive: str(row.motive),
      source: str(row.source),
      document: maskDocument(row.document),
      documentPEP: maskDocument(row.documentPEP),
      startDate: str(row.startDate),
      endDate: str(row.endDate),
      lastUpdateDate: str(row.lastUpdateDate),
    }),
  );
}
