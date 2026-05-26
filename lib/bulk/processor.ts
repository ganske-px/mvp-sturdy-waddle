import type { BulkItemRow, BulkJobStatus, ItemOutcome, JobCounters } from './job-store.ts';

const DEFAULT_RATE_LIMIT_MS = 3600; // 1000 Predictus reqs/hour
const DEFAULT_BATCH_SIZE = 250;

export type ProcessorDeps = {
  getPendingItems: (jobId: string, limit: number) => Promise<BulkItemRow[]>;
  recordItemResult: (itemId: string, outcome: ItemOutcome) => Promise<void>;
  refreshJobCounters: (jobId: string) => Promise<JobCounters>;
  setJobStatus: (jobId: string, status: BulkJobStatus) => Promise<void>;
  processItem: (item: BulkItemRow) => Promise<ItemOutcome>;
  sleep: (ms: number) => Promise<void>;
};

export type ProcessorOptions = {
  /**
   * Milliseconds to wait between items. Defaults to 3600ms which keeps us
   * under the 1000 req/h Predictus contract.
   */
  rateLimitMs?: number;
  /**
   * Maximum number of items to pull from the queue in a single invocation.
   * Defaults to the full per-job cap (250), making this a one-shot processor.
   * Reduce when running under tight runtime limits (e.g. Edge Functions).
   */
  batchSize?: number;
};

export type ProcessorResult = {
  processed: number;
  errors: number;
  remaining: number;
  completed: boolean;
};

/**
 * Orchestrates the processing of a bulk job's pending items.
 *
 * Pure with respect to side effects — all I/O happens through the injected
 * `deps`, which makes the loop, rate limiting, and completion logic fully
 * unit-testable. The actual cache+Predictus+audit work lives behind
 * `deps.processItem`.
 *
 * Per-item errors are caught and converted to `recordItemResult({kind:'error'})`
 * so a single bad CPF cannot halt the entire batch. Errors from the deps
 * themselves (e.g. database goes away) propagate up.
 */
export async function processBulkJob(
  jobId: string,
  deps: ProcessorDeps,
  options: ProcessorOptions = {},
): Promise<ProcessorResult> {
  const rateLimitMs = options.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  await deps.setJobStatus(jobId, 'running');

  const items = await deps.getPendingItems(jobId, batchSize);
  let processed = 0;
  let errors = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i] as BulkItemRow;
    let outcome: ItemOutcome;
    try {
      outcome = await deps.processItem(item);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      outcome = { kind: 'error', message };
    }

    await deps.recordItemResult(item.id, outcome);

    if (outcome.kind === 'error') errors += 1;
    else processed += 1;

    if (i < items.length - 1 && rateLimitMs > 0) {
      await deps.sleep(rateLimitMs);
    }
  }

  const summary = await deps.refreshJobCounters(jobId);
  if (summary.completed) {
    await deps.setJobStatus(jobId, 'completed');
  }

  return {
    processed,
    errors,
    remaining: summary.pending,
    completed: summary.completed,
  };
}
