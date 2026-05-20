import type { PredictusProcess } from '@/lib/predictus/types';
import { describe, expect, it, vi } from 'vitest';
import { type ItemProcessorDeps, processBulkItem } from './item-processor';
import type { BulkItemRow } from './job-store';

function makeItem(overrides: Partial<BulkItemRow> = {}): BulkItemRow {
  return {
    id: 'item-1',
    job_id: 'job-1',
    document_hash: 'hash-abc',
    document_encrypted: 'enc(11144477735)',
    document_type: 'cpf',
    document_preview: '111.***.***-35',
    status: 'pending',
    result_count: 0,
    error_message: null,
    processed_at: null,
    ...overrides,
  };
}

function buildStubDeps(
  opts: {
    cacheHit?: { results: PredictusProcess[]; fetchedAt: string } | null;
    predictusResults?: PredictusProcess[];
    predictusThrows?: Error;
    cacheGetThrows?: Error;
    cacheSetThrows?: Error;
    decryptDocumentImpl?: (ciphertext: string) => Promise<string>;
  } = {},
) {
  const getCachedResults = vi.fn(async (_admin: unknown, _hash: string) => {
    if (opts.cacheGetThrows) throw opts.cacheGetThrows;
    return opts.cacheHit ?? null;
  });

  const setCachedResults = vi.fn(
    async (_admin: unknown, _hash: string, _type: string, _results: unknown) => {
      if (opts.cacheSetThrows) throw opts.cacheSetThrows;
    },
  );

  const searchByCpf = vi.fn(async (_cpf: string) => {
    if (opts.predictusThrows) throw opts.predictusThrows;
    return opts.predictusResults ?? [];
  });

  const searchByCnpj = vi.fn(async (_cnpj: string) => {
    if (opts.predictusThrows) throw opts.predictusThrows;
    return opts.predictusResults ?? [];
  });

  const writeAuditLog = vi.fn(
    async (_event: unknown, _client: unknown, _opts?: unknown) => undefined,
  );

  // Default: strip the deterministic "enc(...)" wrapper from the test fixtures.
  const decryptDocument = vi.fn(
    opts.decryptDocumentImpl ??
      (async (ciphertext: string) =>
        ciphertext.startsWith('enc(') ? ciphertext.slice(4, -1) : ciphertext),
  );

  const deps: ItemProcessorDeps = {
    admin: {} as never,
    predictus: { searchByCpf, searchByCnpj } as never,
    audit: writeAuditLog,
    getCachedResults,
    setCachedResults,
    decryptDocument,
    userId: 'user-1',
    ip: '203.0.113.5',
    userAgent: 'EdgeFn/1.0',
  };

  return {
    deps,
    spies: {
      getCachedResults,
      setCachedResults,
      searchByCpf,
      searchByCnpj,
      writeAuditLog,
      decryptDocument,
    },
  };
}

const SAMPLE: PredictusProcess[] = [
  { numeroProcessoUnico: '0001-26', tribunal: 'TJSP' },
  { numeroProcessoUnico: '0002-26', tribunal: 'TRF4' },
];

describe('processBulkItem — cache hit', () => {
  it('returns the cached results without calling Predictus', async () => {
    const { deps, spies } = buildStubDeps({
      cacheHit: { results: SAMPLE, fetchedAt: '2026-05-10T12:00:00Z' },
    });
    const outcome = await processBulkItem(makeItem(), deps);

    expect(outcome).toEqual({ kind: 'found', resultCount: 2 });
    expect(spies.searchByCpf).not.toHaveBeenCalled();
    expect(spies.searchByCnpj).not.toHaveBeenCalled();
    expect(spies.setCachedResults).not.toHaveBeenCalled();
  });

  it('returns clean when the cache hit is empty', async () => {
    const { deps } = buildStubDeps({
      cacheHit: { results: [], fetchedAt: '2026-05-10T12:00:00Z' },
    });
    const outcome = await processBulkItem(makeItem(), deps);
    expect(outcome).toEqual({ kind: 'clean', resultCount: 0 });
  });

  it('still writes an audit log for the cache hit', async () => {
    const { deps, spies } = buildStubDeps({ cacheHit: { results: SAMPLE, fetchedAt: 'now' } });
    await processBulkItem(makeItem({ document_hash: 'h-audit' }), deps);

    expect(spies.writeAuditLog).toHaveBeenCalledTimes(1);
    const firstCall = spies.writeAuditLog.mock.calls[0];
    const event = firstCall?.[0] as Record<string, unknown>;
    expect(event.action).toBe('search_bulk_item');
    expect(event.userId).toBe('user-1');
    expect(event.documentHash).toBe('h-audit');
    expect(event.searchType).toBe('cpf');
    expect(event.ip).toBe('203.0.113.5');
    expect(event.metadata).toMatchObject({ cached: true });
  });
});

describe('processBulkItem — cache miss', () => {
  it('falls through to Predictus, writes the cache, and returns found', async () => {
    const { deps, spies } = buildStubDeps({ predictusResults: SAMPLE });
    const outcome = await processBulkItem(makeItem(), deps);

    expect(outcome).toEqual({ kind: 'found', resultCount: 2 });
    expect(spies.searchByCpf).toHaveBeenCalledTimes(1);
    expect(spies.setCachedResults).toHaveBeenCalledTimes(1);
  });

  it('returns clean and still caches an empty result', async () => {
    const { deps, spies } = buildStubDeps({ predictusResults: [] });
    const outcome = await processBulkItem(makeItem(), deps);

    expect(outcome).toEqual({ kind: 'clean', resultCount: 0 });
    expect(spies.setCachedResults).toHaveBeenCalledTimes(1);
  });

  it('routes CNPJ items to searchByCnpj', async () => {
    const { deps, spies } = buildStubDeps({ predictusResults: SAMPLE });
    const item = makeItem({ document_type: 'cnpj' });
    await processBulkItem(item, deps);

    expect(spies.searchByCnpj).toHaveBeenCalledTimes(1);
    expect(spies.searchByCpf).not.toHaveBeenCalled();
  });

  it('survives a setCachedResults failure (best-effort)', async () => {
    const { deps, spies } = buildStubDeps({
      predictusResults: SAMPLE,
      cacheSetThrows: new Error('vault down'),
    });
    const outcome = await processBulkItem(makeItem(), deps);
    expect(outcome).toEqual({ kind: 'found', resultCount: 2 });
    expect(spies.setCachedResults).toHaveBeenCalledTimes(1);
  });

  it('survives a getCachedResults failure (falls through to Predictus)', async () => {
    const { deps, spies } = buildStubDeps({
      cacheGetThrows: new Error('cache table missing'),
      predictusResults: SAMPLE,
    });
    const outcome = await processBulkItem(makeItem(), deps);
    expect(outcome).toEqual({ kind: 'found', resultCount: 2 });
    expect(spies.searchByCpf).toHaveBeenCalledTimes(1);
  });
});

describe('processBulkItem — predictus failure', () => {
  it('returns an error outcome with the upstream message', async () => {
    const { deps } = buildStubDeps({ predictusThrows: new Error('http 500 after retries') });
    const outcome = await processBulkItem(makeItem(), deps);
    expect(outcome).toEqual({ kind: 'error', message: 'http 500 after retries' });
  });

  it('records audit BEFORE the Predictus call', async () => {
    const { deps, spies } = buildStubDeps({ predictusThrows: new Error('boom') });

    // Track order via a sequence array.
    const order: string[] = [];
    spies.writeAuditLog.mockImplementation(async () => {
      order.push('audit');
    });
    spies.searchByCpf.mockImplementation(async () => {
      order.push('predictus');
      throw new Error('boom');
    });

    await processBulkItem(makeItem(), deps);
    expect(order).toEqual(['audit', 'predictus']);
  });
});
