import type { AuditEvent } from '@/lib/audit';
import { extractPivotCnpjs } from '@/lib/netrin/parsers/pivot-cnpjs';
import {
  HOP1_SLUGS,
  type NetrinCompositePayload,
  type NetrinDocumentType,
  type NetrinSlug,
} from '@/lib/netrin/types';

export type RunHop1Deps = {
  documentRaw: string;
  documentHash: string;
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

export type RunHop1Result = {
  payload: NetrinCompositePayload;
  pivotCnpjs: string[];
  cached: boolean;
};

export async function runHop1(deps: RunHop1Deps): Promise<RunHop1Result> {
  await deps.audit({
    userId: deps.userId,
    action: 'enrichment_call',
    documentHash: deps.documentHash,
    metadata: { hop: 1, jobId: deps.jobId, slugs: [...HOP1_SLUGS] },
  });

  const cached = await deps.getCache(deps.documentHash);
  if (cached) {
    return { payload: cached.payload, pivotCnpjs: extractPivotCnpjs(cached.payload), cached: true };
  }

  const payload = await deps.fetchComposta('cpf', deps.documentRaw, HOP1_SLUGS);
  await deps.setCache(deps.documentHash, 'cpf', [...HOP1_SLUGS], payload);
  return { payload, pivotCnpjs: extractPivotCnpjs(payload), cached: false };
}
