import type { AuditEvent } from '@/lib/audit';
import { extractPivotCpfs, type PivotCpf } from '@/lib/netrin/parsers/pivot-cpfs';
import {
  HOP2_SLUGS,
  type NetrinCompositePayload,
  type NetrinDocumentType,
  type NetrinSlug,
} from '@/lib/netrin/types';

export type RunHop2Deps = {
  cnpjRaw: string;
  cnpjHash: string;
  userId: string;
  jobId: string;
  audit: (event: AuditEvent) => Promise<void>;
  getCache: (hash: string) => Promise<{ payload: NetrinCompositePayload; slugsFetched: string[]; fetchedAt: string } | null>;
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

export type RunHop2Result = {
  payload: NetrinCompositePayload;
  pivotCpfs: PivotCpf[];
  cached: boolean;
};

export async function runHop2(deps: RunHop2Deps): Promise<RunHop2Result> {
  await deps.audit({
    userId: deps.userId,
    action: 'enrichment_call',
    documentHash: deps.cnpjHash,
    metadata: { hop: 2, jobId: deps.jobId, slugs: [...HOP2_SLUGS] },
  });

  const cached = await deps.getCache(deps.cnpjHash);
  if (cached) {
    return { payload: cached.payload, pivotCpfs: extractPivotCpfs(cached.payload), cached: true };
  }

  const payload = await deps.fetchComposta('cnpj', deps.cnpjRaw, HOP2_SLUGS);
  await deps.setCache(deps.cnpjHash, 'cnpj', [...HOP2_SLUGS], payload);
  return { payload, pivotCpfs: extractPivotCpfs(payload), cached: false };
}
