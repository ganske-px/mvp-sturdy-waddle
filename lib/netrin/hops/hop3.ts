import type { AuditEvent } from '@/lib/audit';
import {
  HOP3_SLUGS,
  type NetrinCompositePayload,
  type NetrinDocumentType,
  type NetrinSlug,
} from '@/lib/netrin/types';

export type RunHop3Deps = {
  cpfRaw: string;
  cpfHash: string;
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

export type RunHop3Result = { payload: NetrinCompositePayload; cached: boolean };

export async function runHop3(deps: RunHop3Deps): Promise<RunHop3Result> {
  await deps.audit({
    userId: deps.userId,
    action: 'enrichment_call',
    documentHash: deps.cpfHash,
    metadata: { hop: 3, jobId: deps.jobId, slugs: [...HOP3_SLUGS] },
  });

  const cached = await deps.getCache(deps.cpfHash);
  if (cached) return { payload: cached.payload, cached: true };

  const payload = await deps.fetchComposta('cpf', deps.cpfRaw, HOP3_SLUGS);
  await deps.setCache(deps.cpfHash, 'cpf', [...HOP3_SLUGS], payload);
  return { payload, cached: false };
}
