import type { AuditEvent } from '@/lib/audit.ts';
import { type PivotCpf, extractPivotCpfs } from '@/lib/netrin/parsers/pivot-cpfs.ts';
import {
  CNPJ_SLUGS,
  type NetrinCompositePayload,
  type NetrinDocumentType,
  type NetrinSlug,
} from '@/lib/netrin/types.ts';

export type CnpjSearchDeps = {
  cnpjRaw: string;
  cnpjHash: string;
  userId: string;
  jobId: string;
  audit: (event: AuditEvent) => Promise<void>;
  getCache: (hash: string) => Promise<{
    payload: NetrinCompositePayload;
    slugsFetched: string[];
    fetchedAt: string;
  } | null>;
  setCache: (
    hash: string,
    type: NetrinDocumentType,
    slugs: string[],
    payload: NetrinCompositePayload,
  ) => Promise<void>;
  fetchComposta: (
    type: NetrinDocumentType,
    documentRaw: string,
    slugs: readonly NetrinSlug[],
  ) => Promise<NetrinCompositePayload>;
};

export type RunCnpjSearchResult = {
  payload: NetrinCompositePayload;
  pivotCpfs: PivotCpf[];
  cached: boolean;
};

export async function runCnpjSearch(deps: CnpjSearchDeps): Promise<RunCnpjSearchResult> {
  await deps.audit({
    userId: deps.userId,
    action: 'enrichment_call',
    documentHash: deps.cnpjHash,
    metadata: { hop: 2, jobId: deps.jobId, slugs: [...CNPJ_SLUGS] },
  });

  const cached = await deps.getCache(deps.cnpjHash);
  if (cached) {
    return { payload: cached.payload, pivotCpfs: extractPivotCpfs(cached.payload), cached: true };
  }

  const payload = await deps.fetchComposta('cnpj', deps.cnpjRaw, CNPJ_SLUGS);
  await deps.setCache(deps.cnpjHash, 'cnpj', [...CNPJ_SLUGS], payload);
  return { payload, pivotCpfs: extractPivotCpfs(payload), cached: false };
}
