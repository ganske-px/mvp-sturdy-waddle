import type { AuditEvent } from '@/lib/audit.ts';
import { extractPivotCnpjs } from '@/lib/netrin/parsers/pivot-cnpjs.ts';
import {
  CPF_SLUGS,
  type NetrinCompositePayload,
  type NetrinDocumentType,
  type NetrinSlug,
} from '@/lib/netrin/types.ts';

export type CpfSearchDeps = {
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

export type RunCpfSearchResult = {
  payload: NetrinCompositePayload;
  pivotCnpjs: string[];
  cached: boolean;
};

export async function runCpfSearch(deps: CpfSearchDeps): Promise<RunCpfSearchResult> {
  await deps.audit({
    userId: deps.userId,
    action: 'enrichment_call',
    documentHash: deps.documentHash,
    metadata: { hop: 1, jobId: deps.jobId, slugs: [...CPF_SLUGS] },
  });

  const cached = await deps.getCache(deps.documentHash);
  if (cached) {
    return { payload: cached.payload, pivotCnpjs: extractPivotCnpjs(cached.payload), cached: true };
  }

  const payload = await deps.fetchComposta('cpf', deps.documentRaw, CPF_SLUGS);
  await deps.setCache(deps.documentHash, 'cpf', [...CPF_SLUGS], payload);
  return { payload, pivotCnpjs: extractPivotCnpjs(payload), cached: false };
}
