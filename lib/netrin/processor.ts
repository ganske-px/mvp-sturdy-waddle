import type { RunCpfSearchResult } from './hops/cpf-search.ts';
import type { RunCnpjSearchResult } from './hops/cnpj-search.ts';
import type { EnrichmentCallStatus, EnrichmentJobStatus, RecordCallInput } from './job-store.ts';
import type { NetrinCompositePayload } from './types.ts';

export type ProcessorJob = {
  rootType: 'cpf' | 'cnpj';
  rootRaw: string;
  rootHash: string;
  userId: string;
};

export type ProcessorDeps = {
  job: ProcessorJob;
  setJobStatus: (
    jobId: string,
    status: EnrichmentJobStatus,
    opts?: { error?: string; finished?: boolean },
  ) => Promise<void>;
  setNetrinStatus: (
    jobId: string,
    status: 'success' | 'error' | 'cache_hit',
  ) => Promise<void>;
  recordCall: (input: RecordCallInput) => Promise<void>;
  runCpfSearch: () => Promise<RunCpfSearchResult>;
  runCnpjSearch: (cnpjRaw: string) => Promise<RunCnpjSearchResult>;
  finalize: (collected: {
    payload: NetrinCompositePayload | null;
    docType: 'cpf' | 'cnpj';
  }) => Promise<void>;
};

export type ProcessorResult = { status: 'completed' | 'failed' };

function statusFromCache(cached: boolean): EnrichmentCallStatus {
  return cached ? 'cache_hit' : 'success';
}

export async function processEnrichmentJob(
  jobId: string,
  deps: ProcessorDeps,
): Promise<ProcessorResult> {
  await deps.setJobStatus(jobId, 'running');

  let payload: NetrinCompositePayload | null = null;
  const docType = deps.job.rootType;
  const hopNumber: 1 | 2 = docType === 'cpf' ? 1 : 2;

  try {
    const result =
      docType === 'cpf'
        ? await deps.runCpfSearch()
        : await deps.runCnpjSearch(deps.job.rootRaw);
    payload = result.payload;
    await deps.recordCall({
      jobId,
      hop: hopNumber,
      documentHash: deps.job.rootHash,
      documentType: docType,
      slugs: [],
      status: statusFromCache(result.cached),
      cached: result.cached,
    });
    await deps.setNetrinStatus(jobId, result.cached ? 'cache_hit' : 'success');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await deps.recordCall({
      jobId,
      hop: hopNumber,
      documentHash: deps.job.rootHash,
      documentType: docType,
      slugs: [],
      status: 'error',
      cached: false,
      error: message,
    });
    await deps.setNetrinStatus(jobId, 'error');
    await deps.setJobStatus(jobId, 'failed', { error: message, finished: true });
    return { status: 'failed' };
  }

  try {
    await deps.finalize({ payload, docType });
  } catch (e) {
    console.warn('finalize failed:', e);
  }

  await deps.setJobStatus(jobId, 'completed', { finished: true });
  return { status: 'completed' };
}
