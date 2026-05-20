import { describe, expect, it, vi } from 'vitest';
import type { BulkItemRow, ItemOutcome, JobCounters } from './job-store';
import { processBulkJob } from './processor';

function makeItem(overrides: Partial<BulkItemRow>): BulkItemRow {
  return {
    id: 'item-1',
    job_id: 'job-1',
    document_hash: 'h1',
    document_value: '11144477735',
    document_type: 'cpf',
    document_preview: '***',
    status: 'pending',
    result_count: 0,
    error_message: null,
    processed_at: null,
    ...overrides,
  };
}

type CallLog = string[];

function buildDeps(opts: {
  pendingItems: BulkItemRow[][];
  processItem?: (item: BulkItemRow) => Promise<ItemOutcome>;
  countersAfter?: JobCounters;
  log?: CallLog;
}) {
  const log = opts.log ?? [];
  let getPendingCallIdx = 0;

  const getPendingItems = vi.fn(async (_jobId: string, _limit: number) => {
    log.push(`getPendingItems#${getPendingCallIdx}`);
    return opts.pendingItems[getPendingCallIdx++] ?? [];
  });

  const recordItemResult = vi.fn(async (itemId: string, outcome: ItemOutcome) => {
    log.push(`recordItemResult:${itemId}:${outcome.kind}`);
  });

  const refreshJobCounters = vi.fn(async (_jobId: string) => {
    log.push('refreshJobCounters');
    return (
      opts.countersAfter ?? {
        done: 0,
        errors: 0,
        pending: 0,
        total: 0,
        completed: true,
      }
    );
  });

  const setJobStatus = vi.fn(async (_jobId: string, status: string) => {
    log.push(`setJobStatus:${status}`);
  });

  const processItem =
    opts.processItem ??
    vi.fn(async (_item: BulkItemRow): Promise<ItemOutcome> => ({ kind: 'clean', resultCount: 0 }));

  const sleep = vi.fn(async (_ms: number) => {
    log.push('sleep');
  });

  return {
    deps: {
      getPendingItems,
      recordItemResult,
      refreshJobCounters,
      setJobStatus,
      processItem,
      sleep,
    },
    spies: {
      getPendingItems,
      recordItemResult,
      refreshJobCounters,
      setJobStatus,
      processItem,
      sleep,
    },
    log,
  };
}

describe('processBulkJob — happy path', () => {
  it('sets job to running, processes all items, and marks the job completed', async () => {
    const items = [makeItem({ id: 'i1' }), makeItem({ id: 'i2', document_hash: 'h2' })];
    const { deps, spies, log } = buildDeps({
      pendingItems: [items],
      countersAfter: { done: 2, errors: 0, pending: 0, total: 2, completed: true },
    });

    const result = await processBulkJob('job-1', deps, { rateLimitMs: 0, batchSize: 250 });

    expect(result).toEqual({ processed: 2, errors: 0, remaining: 0, completed: true });
    expect(spies.processItem).toHaveBeenCalledTimes(2);
    expect(spies.recordItemResult).toHaveBeenCalledTimes(2);
    expect(spies.setJobStatus).toHaveBeenNthCalledWith(1, 'job-1', 'running');
    expect(spies.setJobStatus).toHaveBeenLastCalledWith('job-1', 'completed');
    expect(log[0]).toBe('setJobStatus:running');
    expect(log[log.length - 1]).toBe('setJobStatus:completed');
  });

  it('paces requests by awaiting sleep(rateLimitMs) BETWEEN items', async () => {
    const items = [makeItem({ id: 'i1' }), makeItem({ id: 'i2' }), makeItem({ id: 'i3' })];
    const { deps, spies } = buildDeps({
      pendingItems: [items],
      countersAfter: { done: 3, errors: 0, pending: 0, total: 3, completed: true },
    });

    await processBulkJob('job-1', deps, { rateLimitMs: 3600 });

    // 3 items → 2 sleeps between them (no sleep after the last).
    expect(spies.sleep).toHaveBeenCalledTimes(2);
    expect(spies.sleep).toHaveBeenNthCalledWith(1, 3600);
    expect(spies.sleep).toHaveBeenNthCalledWith(2, 3600);
  });

  it('does not sleep when only a single item is processed', async () => {
    const { deps, spies } = buildDeps({
      pendingItems: [[makeItem({ id: 'i1' })]],
      countersAfter: { done: 1, errors: 0, pending: 0, total: 1, completed: true },
    });
    await processBulkJob('job-1', deps, { rateLimitMs: 3600 });
    expect(spies.sleep).not.toHaveBeenCalled();
  });
});

describe('processBulkJob — error handling per item', () => {
  it("converts a processItem throw into a 'error' outcome and continues", async () => {
    const items = [
      makeItem({ id: 'i1' }),
      makeItem({ id: 'i2', document_hash: 'h2' }),
      makeItem({ id: 'i3', document_hash: 'h3' }),
    ];
    const processItem = vi.fn(async (item: BulkItemRow): Promise<ItemOutcome> => {
      if (item.id === 'i2') throw new Error('predictus exploded');
      return { kind: 'clean', resultCount: 0 };
    });
    const { deps, spies } = buildDeps({
      pendingItems: [items],
      processItem,
      countersAfter: { done: 2, errors: 1, pending: 0, total: 3, completed: true },
    });

    const result = await processBulkJob('job-1', deps, { rateLimitMs: 0 });

    expect(result.processed).toBe(2);
    expect(result.errors).toBe(1);
    expect(spies.processItem).toHaveBeenCalledTimes(3);
    expect(spies.recordItemResult).toHaveBeenCalledWith('i2', {
      kind: 'error',
      message: 'predictus exploded',
    });
  });

  it('also records a non-Error throw as a string error message', async () => {
    const processItem = vi.fn(async (): Promise<ItemOutcome> => {
      throw 'plain-string-error';
    });
    const { deps, spies } = buildDeps({
      pendingItems: [[makeItem({ id: 'i1' })]],
      processItem,
      countersAfter: { done: 0, errors: 1, pending: 0, total: 1, completed: true },
    });
    await processBulkJob('job-1', deps, { rateLimitMs: 0 });
    expect(spies.recordItemResult).toHaveBeenCalledWith('i1', {
      kind: 'error',
      message: 'plain-string-error',
    });
  });
});

describe('processBulkJob — completion logic', () => {
  it('leaves the job in running when refreshJobCounters reports completed=false', async () => {
    const { deps, spies } = buildDeps({
      pendingItems: [[makeItem({ id: 'i1' })]],
      countersAfter: { done: 1, errors: 0, pending: 4, total: 5, completed: false },
    });

    const result = await processBulkJob('job-1', deps, { rateLimitMs: 0, batchSize: 1 });

    expect(result.completed).toBe(false);
    expect(result.remaining).toBe(4);
    // setJobStatus is called once with 'running' at the start, and never with 'completed'.
    const completedCalls = spies.setJobStatus.mock.calls.filter(
      ([, status]) => status === 'completed',
    );
    expect(completedCalls).toHaveLength(0);
  });

  it('returns immediately when there are no pending items', async () => {
    const { deps, spies } = buildDeps({
      pendingItems: [[]],
      countersAfter: { done: 0, errors: 0, pending: 0, total: 0, completed: false },
    });

    const result = await processBulkJob('job-1', deps, { rateLimitMs: 1000 });

    expect(result.processed).toBe(0);
    expect(spies.processItem).not.toHaveBeenCalled();
    expect(spies.sleep).not.toHaveBeenCalled();
  });
});

describe('processBulkJob — batchSize cap', () => {
  it('requests only batchSize items from the store', async () => {
    const items = Array.from({ length: 5 }, (_, i) => makeItem({ id: `i${i}` }));
    const { deps, spies } = buildDeps({
      pendingItems: [items],
      countersAfter: { done: 5, errors: 0, pending: 0, total: 5, completed: true },
    });

    await processBulkJob('job-1', deps, { rateLimitMs: 0, batchSize: 20 });

    expect(spies.getPendingItems).toHaveBeenCalledWith('job-1', 20);
  });
});
