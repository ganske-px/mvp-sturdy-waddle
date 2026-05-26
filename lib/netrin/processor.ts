import { hashDocument } from '@/lib/hash.ts';
import type { RunHop1Result } from './hops/hop1.ts';
import type { RunHop2Result } from './hops/hop2.ts';
import type { RunHop3Result } from './hops/hop3.ts';
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
  setHop1Status: (
    jobId: string,
    status: 'success' | 'error' | 'cache_hit' | 'skipped',
  ) => Promise<void>;
  setHopTotals: (
    jobId: string,
    totals: { hop2_total?: number; hop3_total?: number },
  ) => Promise<void>;
  bumpHopDone: (jobId: string, hop: 2 | 3) => Promise<void>;
  recordCall: (input: RecordCallInput) => Promise<void>;
  runHop1: () => Promise<RunHop1Result>;
  runHop2: (cnpjRaw: string) => Promise<RunHop2Result>;
  runHop3: (cpfRaw: string) => Promise<RunHop3Result>;
  finalize: (collected: {
    hop1Payload: NetrinCompositePayload | null;
    hop2Payloads: Record<string, NetrinCompositePayload>;
    hop3Payloads: Record<string, NetrinCompositePayload>;
  }) => Promise<void>;
};

export type ProcessorResult = { status: 'completed' | 'partial' | 'failed' };

function statusFromCache(cached: boolean): EnrichmentCallStatus {
  return cached ? 'cache_hit' : 'success';
}

export async function processEnrichmentJob(
  jobId: string,
  deps: ProcessorDeps,
): Promise<ProcessorResult> {
  let anyError = false;
  let hop1Payload: NetrinCompositePayload | null = null;
  const hop2Payloads: Record<string, NetrinCompositePayload> = {};
  const hop3Payloads: Record<string, NetrinCompositePayload> = {};

  await deps.setJobStatus(jobId, 'running');

  let pivotCnpjs: string[] = [];
  if (deps.job.rootType === 'cpf') {
    try {
      const hop1 = await deps.runHop1();
      hop1Payload = hop1.payload;
      pivotCnpjs = hop1.pivotCnpjs;
      await deps.recordCall({
        jobId,
        hop: 1,
        documentHash: deps.job.rootHash,
        documentType: 'cpf',
        slugs: [],
        status: statusFromCache(hop1.cached),
        cached: hop1.cached,
      });
      await deps.setHop1Status(jobId, hop1.cached ? 'cache_hit' : 'success');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await deps.recordCall({
        jobId,
        hop: 1,
        documentHash: deps.job.rootHash,
        documentType: 'cpf',
        slugs: [],
        status: 'error',
        cached: false,
        error: message,
      });
      await deps.setHop1Status(jobId, 'error');
      await deps.setJobStatus(jobId, 'failed', { error: message, finished: true });
      return { status: 'failed' };
    }
  } else {
    pivotCnpjs = [deps.job.rootRaw];
    await deps.setHop1Status(jobId, 'skipped');
  }

  await deps.setHopTotals(jobId, { hop2_total: pivotCnpjs.length });

  const pivotCpfs: { cpf: string }[] = [];

  for (const cnpjRaw of pivotCnpjs) {
    const cnpjHash = hashDocument('cnpj', cnpjRaw);
    try {
      const hop2 = await deps.runHop2(cnpjRaw);
      hop2Payloads[cnpjRaw] = hop2.payload;
      await deps.recordCall({
        jobId,
        hop: 2,
        documentHash: cnpjHash,
        documentType: 'cnpj',
        slugs: [],
        status: statusFromCache(hop2.cached),
        cached: hop2.cached,
      });
      await deps.bumpHopDone(jobId, 2);
      for (const p of hop2.pivotCpfs) pivotCpfs.push({ cpf: p.cpf });
    } catch (e) {
      anyError = true;
      const message = e instanceof Error ? e.message : String(e);
      await deps.recordCall({
        jobId,
        hop: 2,
        documentHash: cnpjHash,
        documentType: 'cnpj',
        slugs: [],
        status: 'error',
        cached: false,
        error: message,
      });
      await deps.bumpHopDone(jobId, 2);
    }
  }

  const uniqueCpfs = Array.from(new Set(pivotCpfs.map((p) => p.cpf))).filter(
    (c) => !(deps.job.rootType === 'cpf' && c === deps.job.rootRaw),
  );
  await deps.setHopTotals(jobId, { hop3_total: uniqueCpfs.length });

  for (const cpfRaw of uniqueCpfs) {
    const cpfHash = hashDocument('cpf', cpfRaw);
    try {
      const hop3 = await deps.runHop3(cpfRaw);
      hop3Payloads[cpfRaw] = hop3.payload;
      await deps.recordCall({
        jobId,
        hop: 3,
        documentHash: cpfHash,
        documentType: 'cpf',
        slugs: [],
        status: statusFromCache(hop3.cached),
        cached: hop3.cached,
      });
      await deps.bumpHopDone(jobId, 3);
    } catch (e) {
      anyError = true;
      const message = e instanceof Error ? e.message : String(e);
      await deps.recordCall({
        jobId,
        hop: 3,
        documentHash: cpfHash,
        documentType: 'cpf',
        slugs: [],
        status: 'error',
        cached: false,
        error: message,
      });
      await deps.bumpHopDone(jobId, 3);
    }
  }

  try {
    await deps.finalize({ hop1Payload, hop2Payloads, hop3Payloads });
  } catch (e) {
    anyError = true;
    console.warn('finalize failed:', e);
  }

  const finalStatus: EnrichmentJobStatus = anyError ? 'partial' : 'completed';
  await deps.setJobStatus(jobId, finalStatus, { finished: true });
  return { status: finalStatus };
}
