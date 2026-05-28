import { describe, expect, it, vi } from 'vitest';
import {
  type BulkItemInput,
  createBulkJob,
  getPendingItems,
  recordItemResult,
  refreshJobCounters,
  setJobStatus,
} from './job-store';

type BulkJobRow = {
  id: string;
  user_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  total_items: number;
  done_items: number;
  error_items: number;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
};

type BulkItemRow = {
  id: string;
  job_id: string;
  document_hash: string;
  document_encrypted: string;
  document_type: 'cpf' | 'cnpj';
  document_preview: string;
  status: 'pending' | 'processing' | 'found' | 'clean' | 'error';
  result_count: number;
  error_message: string | null;
  processed_at: string | null;
};

type FakeState = {
  jobs: BulkJobRow[];
  items: BulkItemRow[];
  nextId: number;
};

function buildFake() {
  const state: FakeState = { jobs: [], items: [], nextId: 1 };
  const nextId = () => `id-${state.nextId++}`;
  const encryptDocument = vi.fn(async (raw: string) => `enc(${raw})`);

  const buildItemQuery = (filtered: BulkItemRow[]) => {
    const query = {
      eq(col: keyof BulkItemRow, value: unknown) {
        return buildItemQuery(filtered.filter((r) => r[col] === value));
      },
      order(_col: string, _opts?: unknown) {
        return query;
      },
      limit(n: number) {
        const data = filtered.slice(0, n);
        const promise = Promise.resolve({ data, error: null });
        return Object.assign(promise, {
          returns: () => Promise.resolve({ data, error: null }),
        });
      },
    };
    return query;
  };

  const client = {
    from(table: string) {
      if (table === 'bulk_jobs') {
        return {
          insert(row: { user_id: string; total_items: number; status?: string }) {
            const id = nextId();
            const inserted: BulkJobRow = {
              id,
              user_id: row.user_id,
              status: (row.status as BulkJobRow['status']) ?? 'pending',
              total_items: row.total_items,
              done_items: 0,
              error_items: 0,
              error_message: null,
              started_at: null,
              finished_at: null,
            };
            state.jobs.push(inserted);
            return {
              select(_cols: string) {
                return {
                  single: () => Promise.resolve({ data: { id }, error: null }),
                };
              },
            };
          },
          update(patch: Partial<BulkJobRow>) {
            return {
              eq(col: keyof BulkJobRow, value: unknown) {
                const job = state.jobs.find((j) => j[col] === value);
                if (job) Object.assign(job, patch);
                return Promise.resolve({ error: null });
              },
            };
          },
          select(_cols: string) {
            return {
              eq(col: keyof BulkJobRow, value: unknown) {
                const job = state.jobs.find((j) => j[col] === value);
                return {
                  single: () => Promise.resolve({ data: job ?? null, error: null }),
                };
              },
            };
          },
        };
      }
      if (table === 'bulk_job_items') {
        return {
          insert(
            rows: Array<Omit<BulkItemRow, 'id' | 'status' | 'result_count' | 'processed_at'>>,
          ) {
            const arr = Array.isArray(rows) ? rows : [rows];
            for (const r of arr) {
              const inserted: BulkItemRow = {
                id: nextId(),
                job_id: r.job_id,
                document_hash: r.document_hash,
                document_encrypted: r.document_encrypted,
                document_type: r.document_type,
                document_preview: r.document_preview,
                status: 'pending',
                result_count: 0,
                error_message: null,
                processed_at: null,
              };
              state.items.push(inserted);
            }
            return Promise.resolve({ error: null });
          },
          update(patch: Partial<BulkItemRow>) {
            return {
              eq(col: keyof BulkItemRow, value: unknown) {
                const item = state.items.find((i) => i[col] === value);
                if (item) Object.assign(item, patch);
                return Promise.resolve({ error: null });
              },
            };
          },
          select(_cols: string) {
            return buildItemQuery(state.items);
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
  return { client, state, encryptDocument };
}

const SAMPLE_ITEMS: BulkItemInput[] = [
  {
    documentHash: 'h1',
    documentRaw: '11144477735',
    documentType: 'cpf',
    documentPreview: '111.***.***-35',
  },
  {
    documentHash: 'h2',
    documentRaw: '11222333000181',
    documentType: 'cnpj',
    documentPreview: '11.***.***/****-81',
  },
];

describe('createBulkJob', () => {
  it('inserts a bulk_jobs row with status=pending and total_items=N', async () => {
    const { client, state, encryptDocument } = buildFake();
    const { jobId } = await createBulkJob({
      client: client as never,
      userId: 'user-1',
      items: SAMPLE_ITEMS,
      encryptDocument,
    });

    expect(jobId).toBeTruthy();
    expect(state.jobs).toHaveLength(1);
    const job = state.jobs[0] as BulkJobRow;
    expect(job.id).toBe(jobId);
    expect(job.user_id).toBe('user-1');
    expect(job.status).toBe('pending');
    expect(job.total_items).toBe(2);
  });

  it('inserts one bulk_job_items row per input item, all pending', async () => {
    const { client, state, encryptDocument } = buildFake();
    const { jobId } = await createBulkJob({
      client: client as never,
      userId: 'user-1',
      items: SAMPLE_ITEMS,
      encryptDocument,
    });

    expect(state.items).toHaveLength(2);
    expect(state.items.every((i) => i.job_id === jobId)).toBe(true);
    expect(state.items.every((i) => i.status === 'pending')).toBe(true);
    expect(state.items.map((i) => i.document_hash).sort()).toEqual(['h1', 'h2']);
  });

  it('encrypts the raw document before persistence', async () => {
    const { client, state, encryptDocument } = buildFake();
    await createBulkJob({
      client: client as never,
      userId: 'user-1',
      items: SAMPLE_ITEMS,
      encryptDocument,
    });

    expect(encryptDocument).toHaveBeenCalledTimes(2);
    expect(encryptDocument).toHaveBeenCalledWith('11144477735');
    expect(encryptDocument).toHaveBeenCalledWith('11222333000181');
    // Persisted items should hold the ciphertext returned by the stub,
    // never the raw input.
    for (const item of state.items) {
      expect(item.document_encrypted.startsWith('enc(')).toBe(true);
    }
  });

  it('rejects when items is empty', async () => {
    const { client, encryptDocument } = buildFake();
    await expect(
      createBulkJob({ client: client as never, userId: 'user-1', items: [], encryptDocument }),
    ).rejects.toThrow(/at least 1 item/);
  });

  it('rejects when items exceeds the 250 cap', async () => {
    const { client, encryptDocument } = buildFake();
    const tooMany: BulkItemInput[] = Array.from({ length: 251 }, (_, i) => ({
      documentHash: `h-${i}`,
      documentRaw: `${i.toString().padStart(11, '0')}`,
      documentType: 'cpf',
      documentPreview: `***-${i.toString().padStart(2, '0')}`,
    }));
    await expect(
      createBulkJob({ client: client as never, userId: 'user-1', items: tooMany, encryptDocument }),
    ).rejects.toThrow(/250/);
  });
});

describe('setJobStatus', () => {
  it("transitions to 'running' and stamps started_at", async () => {
    const { client, state, encryptDocument } = buildFake();
    const { jobId } = await createBulkJob({
      client: client as never,
      userId: 'user-1',
      items: SAMPLE_ITEMS,
      encryptDocument,
    });
    await setJobStatus(client as never, jobId, 'running');
    const job = state.jobs[0] as BulkJobRow;
    expect(job.status).toBe('running');
    expect(job.started_at).not.toBeNull();
  });

  it("transitions to 'completed' and stamps finished_at", async () => {
    const { client, state, encryptDocument } = buildFake();
    const { jobId } = await createBulkJob({
      client: client as never,
      userId: 'user-1',
      items: SAMPLE_ITEMS,
      encryptDocument,
    });
    await setJobStatus(client as never, jobId, 'completed');
    const job = state.jobs[0] as BulkJobRow;
    expect(job.status).toBe('completed');
    expect(job.finished_at).not.toBeNull();
  });

  it("transitions to 'failed' with an error message", async () => {
    const { client, state, encryptDocument } = buildFake();
    const { jobId } = await createBulkJob({
      client: client as never,
      userId: 'user-1',
      items: SAMPLE_ITEMS,
      encryptDocument,
    });
    await setJobStatus(client as never, jobId, 'failed', { errorMessage: 'predictus down' });
    const job = state.jobs[0] as BulkJobRow;
    expect(job.status).toBe('failed');
    expect(job.error_message).toBe('predictus down');
    expect(job.finished_at).not.toBeNull();
  });
});

describe('getPendingItems', () => {
  it('returns only items in pending status, up to the limit', async () => {
    const { client, state, encryptDocument } = buildFake();
    const { jobId } = await createBulkJob({
      client: client as never,
      userId: 'user-1',
      items: SAMPLE_ITEMS,
      encryptDocument,
    });

    (state.items[0] as BulkItemRow).status = 'found';

    const pending = await getPendingItems(client as never, jobId, 10);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.document_hash).toBe('h2');
  });

  it('respects the limit argument', async () => {
    const { client, encryptDocument } = buildFake();
    const many: BulkItemInput[] = Array.from({ length: 5 }, (_, i) => ({
      documentHash: `h-${i}`,
      documentRaw: `${i.toString().padStart(11, '0')}`,
      documentType: 'cpf',
      documentPreview: `mask-${i}`,
    }));
    const { jobId } = await createBulkJob({
      client: client as never,
      userId: 'user-1',
      items: many,
      encryptDocument,
    });
    const slice = await getPendingItems(client as never, jobId, 3);
    expect(slice).toHaveLength(3);
  });
});

describe('recordItemResult', () => {
  it("flips an item to 'found' with the result count", async () => {
    const { client, state, encryptDocument } = buildFake();
    await createBulkJob({
      client: client as never,
      userId: 'user-1',
      items: SAMPLE_ITEMS,
      encryptDocument,
    });
    const item = state.items[0] as BulkItemRow;
    await recordItemResult(client as never, item.id, { kind: 'found', resultCount: 4 });
    expect(item.status).toBe('found');
    expect(item.result_count).toBe(4);
    expect(item.processed_at).not.toBeNull();
  });

  it("flips an item to 'clean' with result_count=0", async () => {
    const { client, state, encryptDocument } = buildFake();
    await createBulkJob({
      client: client as never,
      userId: 'user-1',
      items: SAMPLE_ITEMS,
      encryptDocument,
    });
    const item = state.items[0] as BulkItemRow;
    await recordItemResult(client as never, item.id, { kind: 'clean', resultCount: 0 });
    expect(item.status).toBe('clean');
  });

  it("flips an item to 'error' and stamps the message", async () => {
    const { client, state, encryptDocument } = buildFake();
    await createBulkJob({
      client: client as never,
      userId: 'user-1',
      items: SAMPLE_ITEMS,
      encryptDocument,
    });
    const item = state.items[0] as BulkItemRow;
    await recordItemResult(client as never, item.id, { kind: 'error', message: 'timeout' });
    expect(item.status).toBe('error');
    expect(item.error_message).toBe('timeout');
  });
});

describe('refreshJobCounters', () => {
  it('counts processed items and reports completed=true when all are done', async () => {
    const { client, state, encryptDocument } = buildFake();
    const { jobId } = await createBulkJob({
      client: client as never,
      userId: 'user-1',
      items: SAMPLE_ITEMS,
      encryptDocument,
    });

    (state.items[0] as BulkItemRow).status = 'found';
    (state.items[0] as BulkItemRow).result_count = 2;
    (state.items[1] as BulkItemRow).status = 'clean';

    const summary = await refreshJobCounters(client as never, jobId);

    expect(summary.done).toBe(2);
    expect(summary.errors).toBe(0);
    expect(summary.completed).toBe(true);

    const job = state.jobs[0] as BulkJobRow;
    expect(job.done_items).toBe(2);
    expect(job.error_items).toBe(0);
  });

  it('reports completed=false when at least one item is still pending', async () => {
    const { client, state, encryptDocument } = buildFake();
    const { jobId } = await createBulkJob({
      client: client as never,
      userId: 'user-1',
      items: SAMPLE_ITEMS,
      encryptDocument,
    });
    (state.items[0] as BulkItemRow).status = 'found';

    const summary = await refreshJobCounters(client as never, jobId);
    expect(summary.done).toBe(1);
    expect(summary.completed).toBe(false);
  });

  it('counts errors separately from successful items', async () => {
    const { client, state, encryptDocument } = buildFake();
    const { jobId } = await createBulkJob({
      client: client as never,
      userId: 'user-1',
      items: SAMPLE_ITEMS,
      encryptDocument,
    });

    (state.items[0] as BulkItemRow).status = 'error';
    (state.items[0] as BulkItemRow).error_message = 'boom';
    (state.items[1] as BulkItemRow).status = 'found';

    const summary = await refreshJobCounters(client as never, jobId);
    expect(summary.done).toBe(1);
    expect(summary.errors).toBe(1);
    expect(summary.completed).toBe(true);
  });
});
