// lib/netrin/parsers/sanctions-detail.ts
import type { NetrinCompositePayload } from '@/lib/netrin/types.ts';

export type SanctionMatch = {
  source?: string;
  type?: string;
  standardizedSanctionType?: string;
  matchRate?: number;
  nameUniquenessScore?: number;
  startDate?: string;
  endDate?: string;
  lastUpdateDate?: string;
  currentlyPresentOnSource?: boolean;
  recentlyPresentOnSource?: boolean;
  originalName?: string;
  sanctionName?: string;
  birthDate?: string;
  standardizedBirthDate?: string;
  nationalities?: string;
  charges?: string;
};

type RawDetails = {
  OriginalName?: unknown;
  SanctionName?: unknown;
  BirthDate?: unknown;
  StandardizedBirthDate?: unknown;
  Nationalities?: unknown;
  charges?: unknown;
};

type RawSanction = {
  source?: unknown;
  type?: unknown;
  standardizedSanctionType?: unknown;
  matchRate?: unknown;
  nameUniquenessScore?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  lastUpdateDate?: unknown;
  currentlyPresentOnSource?: unknown;
  recentlyPresentOnSource?: unknown;
  details?: RawDetails | null;
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const numOrUndef = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/**
 * Reads `pepKyc.sanctionsHistory[]`. These are name-similarity matches
 * (potential homonyms), so callers must surface `matchRate`. Sorted by
 * `matchRate` desc; rows without a matchRate sink to the bottom.
 */
export function extractSanctions(payload: NetrinCompositePayload): SanctionMatch[] {
  const slug = (payload as Record<string, unknown>).pepKyc as
    | { sanctionsHistory?: unknown }
    | null
    | undefined;
  const list = slug?.sanctionsHistory;
  if (!Array.isArray(list)) return [];

  const isNonEmpty = (row: unknown): boolean =>
    !!row &&
    typeof row === 'object' &&
    Object.values(row as Record<string, unknown>).some(
      (v) =>
        v !== '' &&
        v !== 0 &&
        v != null &&
        !(typeof v === 'object' && Object.keys(v as object).length === 0),
    );

  const out = (list as RawSanction[]).filter(isNonEmpty).map((row): SanctionMatch => {
    const d = row.details ?? {};
    return {
      source: str(row.source),
      type: str(row.type),
      standardizedSanctionType: str(row.standardizedSanctionType),
      matchRate: numOrUndef(row.matchRate),
      nameUniquenessScore: numOrUndef(row.nameUniquenessScore),
      startDate: str(row.startDate),
      endDate: str(row.endDate),
      lastUpdateDate: str(row.lastUpdateDate),
      currentlyPresentOnSource:
        typeof row.currentlyPresentOnSource === 'boolean'
          ? row.currentlyPresentOnSource
          : undefined,
      recentlyPresentOnSource:
        typeof row.recentlyPresentOnSource === 'boolean' ? row.recentlyPresentOnSource : undefined,
      originalName: str(d.OriginalName),
      sanctionName: str(d.SanctionName),
      birthDate: str(d.BirthDate),
      standardizedBirthDate: str(d.StandardizedBirthDate),
      nationalities: str(d.Nationalities),
      charges: str(d.charges),
    };
  });

  return out.sort((a, b) => (b.matchRate ?? -1) - (a.matchRate ?? -1));
}
