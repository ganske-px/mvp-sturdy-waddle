import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/predictus/server-client', () => ({
  createServerPredictusClient: vi.fn(),
}));
vi.mock('@/lib/predictus/cache', () => ({
  getCachedResults: vi.fn(),
  setCachedResults: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({
  writeAuditLog: vi.fn(),
}));
vi.mock('@/lib/netrin/job-store', () => ({
  findOrCreateJob: vi.fn(),
}));
vi.mock('@/lib/crypto/vault', () => ({
  encryptText: vi.fn(),
}));

import { encryptText } from '@/lib/crypto/vault';
import { findOrCreateJob } from '@/lib/netrin/job-store';
import { getCachedResults, setCachedResults } from '@/lib/predictus/cache';
import { createServerPredictusClient } from '@/lib/predictus/server-client';
import type { RunSearchContext } from './run-search';
import { runCnpjSearch, runCpfSearch } from './run-search';

const VALID_CPF = '529.982.247-25';
const VALID_CNPJ = '11.222.333/0001-81';

/**
 * Supabase mock that handles BOTH chain shapes used by run-search:
 *  - cache HIT path: `from('searches').insert(...)`  (awaited directly)
 *  - cache MISS path: `from('searches').insert(...).select('id').single()`
 *  - 23505 fallback: `from('searches').select('id').eq(...).eq(...).eq(...).maybeSingle()`
 *
 * The insert return is a thenable AND has `.select` so both styles work.
 */
type MockOpts = {
  insertError?: { code: string; message?: string } | null;
  existingPendingId?: string | null;
};

function makeSupabaseMock(opts: MockOpts = {}) {
  const insertError = opts.insertError ?? null;
  const existingPendingId = opts.existingPendingId ?? null;

  // Tracks the last inserted row so tests can assert on it.
  const inserts: Array<Record<string, unknown>> = [];

  // Single result for the `.insert(...).select('id').single()` chain.
  const singleAfterInsert = vi.fn().mockImplementation(() => {
    if (insertError) return Promise.resolve({ data: null, error: insertError });
    return Promise.resolve({ data: { id: 'search-row-id' }, error: null });
  });
  const selectAfterInsert = vi.fn(() => ({ single: singleAfterInsert }));

  // MaybeSingle for the 23505 fallback select chain.
  const maybeSingleAfterSelect = vi.fn().mockImplementation(() => {
    if (existingPendingId) return Promise.resolve({ data: { id: existingPendingId }, error: null });
    return Promise.resolve({ data: null, error: null });
  });
  // eq chain returns an object with eq (chained 3 times in run-search) and maybeSingle.
  const eqChain: { eq: () => typeof eqChain; maybeSingle: typeof maybeSingleAfterSelect } = {
    eq: () => eqChain,
    maybeSingle: maybeSingleAfterSelect,
  };
  const selectForFallback = vi.fn(() => ({
    eq: () => eqChain,
  }));

  const insertMock = vi.fn((row: Record<string, unknown>) => {
    inserts.push(row);
    // The insert return must be BOTH awaitable (cache hit: `await ...insert(...)`)
    // and chainable (cache miss: `...insert(...).select('id').single()`). A real
    // Promise with `.select` attached satisfies both without a custom thenable.
    const promise = Promise.resolve({ data: null, error: insertError ?? null });
    return Object.assign(promise, { select: selectAfterInsert });
  });

  const from = vi.fn((_table: string) => ({
    insert: insertMock,
    select: selectForFallback,
  }));

  const supabase = { from } as unknown as RunSearchContext['supabase'];

  return {
    supabase,
    inserts,
    from,
    insertMock,
    selectAfterInsert,
    singleAfterInsert,
    selectForFallback,
    maybeSingleAfterSelect,
  };
}

function makeCtx(overrides: Partial<RunSearchContext> = {}): RunSearchContext {
  const { supabase } = makeSupabaseMock();
  const admin = {} as never;
  return {
    userId: 'user-1',
    admin,
    supabase,
    ip: null,
    userAgent: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(encryptText).mockResolvedValue('enc-bytes');
});

describe('runCpfSearch', () => {
  it('rejects empty input with ok:false', async () => {
    const ctx = makeCtx();
    const result = await runCpfSearch('', ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/vazio/i);
  });

  it('rejects invalid CPF with ok:false', async () => {
    const ctx = makeCtx();
    const result = await runCpfSearch('111.111.111-11', ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/cpf/i);
  });

  it('cache HIT: inserts searches row with status=completed (no document_encrypted), encrypts once for the enrichment job, never calls predictus/setCache', async () => {
    vi.mocked(getCachedResults).mockResolvedValueOnce({
      results: [{ id: 'p1' } as never, { id: 'p2' } as never],
      fetchedAt: new Date().toISOString(),
    });
    vi.mocked(findOrCreateJob).mockResolvedValueOnce({ jobId: 'job-1', created: true });

    const mock = makeSupabaseMock();
    const ctx = makeCtx({ supabase: mock.supabase });
    const result = await runCpfSearch(VALID_CPF, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.documentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.termPreview).toBeTruthy();
    }

    expect(createServerPredictusClient).not.toHaveBeenCalled();
    expect(setCachedResults).not.toHaveBeenCalled();
    // Encryption still happens on hit: the enrichment job needs the ciphertext
    // for the Netrin edge function (which never depends on Predictus).
    expect(encryptText).toHaveBeenCalledOnce();
    expect(findOrCreateJob).toHaveBeenCalledOnce();
    expect(vi.mocked(findOrCreateJob).mock.calls[0]?.[1].documentEncrypted).toBe('enc-bytes');

    expect(mock.from).toHaveBeenCalledWith('searches');
    expect(mock.inserts).toHaveLength(1);
    const inserted = mock.inserts[0];
    expect(inserted?.status).toBe('completed');
    expect(inserted?.result_count).toBe(2);
    expect(inserted?.document_encrypted).toBeUndefined();
  });

  it('cache MISS: encrypts doc once, inserts searches row with status=pending + document_encrypted, ensures enrichment job, never calls predictus/setCache', async () => {
    vi.mocked(getCachedResults).mockResolvedValueOnce(null);
    vi.mocked(findOrCreateJob).mockResolvedValueOnce({ jobId: 'job-2', created: true });

    const mock = makeSupabaseMock();
    const ctx = makeCtx({ supabase: mock.supabase });
    const result = await runCpfSearch(VALID_CPF, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.documentHash).toMatch(/^[0-9a-f]{64}$/);
    }

    expect(createServerPredictusClient).not.toHaveBeenCalled();
    expect(setCachedResults).not.toHaveBeenCalled();
    expect(encryptText).toHaveBeenCalledOnce();
    expect(findOrCreateJob).toHaveBeenCalledOnce();

    expect(mock.inserts).toHaveLength(1);
    const inserted = mock.inserts[0];
    expect(inserted?.status).toBe('pending');
    expect(inserted?.result_count).toBe(0);
    expect(inserted?.document_encrypted).toBe('enc-bytes');
  });

  it('cache MISS + 23505 re-submit: falls back to existing pending search, still ensures job, returns ok:true', async () => {
    vi.mocked(getCachedResults).mockResolvedValueOnce(null);
    vi.mocked(findOrCreateJob).mockResolvedValueOnce({ jobId: 'job-3', created: false });

    const mock = makeSupabaseMock({
      insertError: { code: '23505', message: 'duplicate key' },
      existingPendingId: 'existing-pending-id',
    });
    const ctx = makeCtx({ supabase: mock.supabase });
    const result = await runCpfSearch(VALID_CPF, ctx);

    expect(result.ok).toBe(true);
    expect(findOrCreateJob).toHaveBeenCalledOnce();
    expect(mock.selectForFallback).toHaveBeenCalled();
  });

  it('encryptText throws on cache MISS: returns ok:false, does not insert searches, does not call findOrCreateJob', async () => {
    vi.mocked(getCachedResults).mockResolvedValueOnce(null);
    vi.mocked(encryptText).mockRejectedValueOnce(new Error('vault down'));

    const mock = makeSupabaseMock();
    const ctx = makeCtx({ supabase: mock.supabase });
    const result = await runCpfSearch(VALID_CPF, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Falha ao registrar a consulta/);
    expect(findOrCreateJob).not.toHaveBeenCalled();
    expect(mock.inserts).toHaveLength(0);
  });

  it('getCachedResults throws: treated as miss, flow continues, returns ok:true', async () => {
    vi.mocked(getCachedResults).mockRejectedValueOnce(new Error('cache lookup boom'));
    vi.mocked(findOrCreateJob).mockResolvedValueOnce({ jobId: 'job-4', created: true });

    const mock = makeSupabaseMock();
    const ctx = makeCtx({ supabase: mock.supabase });
    const result = await runCpfSearch(VALID_CPF, ctx);

    expect(result.ok).toBe(true);
    expect(encryptText).toHaveBeenCalledOnce();
    expect(findOrCreateJob).toHaveBeenCalledOnce();
    expect(mock.inserts).toHaveLength(1);
    expect(mock.inserts[0]?.status).toBe('pending');
  });
});

describe('runCnpjSearch', () => {
  it('rejects empty input with ok:false', async () => {
    const ctx = makeCtx();
    const result = await runCnpjSearch('', ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/vazio/i);
  });

  it('rejects invalid CNPJ with ok:false', async () => {
    const ctx = makeCtx();
    const result = await runCnpjSearch('00.000.000/0000-00', ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/cnpj/i);
  });

  it('cache HIT: inserts searches row with status=completed (no document_encrypted), encrypts once for the enrichment job, never calls predictus/setCache', async () => {
    vi.mocked(getCachedResults).mockResolvedValueOnce({
      results: [{ id: 'c1' } as never],
      fetchedAt: new Date().toISOString(),
    });
    vi.mocked(findOrCreateJob).mockResolvedValueOnce({ jobId: 'job-cnpj-1', created: true });

    const mock = makeSupabaseMock();
    const ctx = makeCtx({ supabase: mock.supabase });
    const result = await runCnpjSearch(VALID_CNPJ, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.documentHash).toMatch(/^[0-9a-f]{64}$/);

    expect(createServerPredictusClient).not.toHaveBeenCalled();
    expect(setCachedResults).not.toHaveBeenCalled();
    expect(encryptText).toHaveBeenCalledOnce();
    expect(findOrCreateJob).toHaveBeenCalledOnce();
    expect(vi.mocked(findOrCreateJob).mock.calls[0]?.[1].documentEncrypted).toBe('enc-bytes');

    expect(mock.inserts).toHaveLength(1);
    const inserted = mock.inserts[0];
    expect(inserted?.status).toBe('completed');
    expect(inserted?.result_count).toBe(1);
    expect(inserted?.document_encrypted).toBeUndefined();
  });

  it('cache MISS: encrypts doc once, inserts pending row + document_encrypted, ensures job, never calls predictus/setCache', async () => {
    vi.mocked(getCachedResults).mockResolvedValueOnce(null);
    vi.mocked(findOrCreateJob).mockResolvedValueOnce({ jobId: 'job-cnpj-2', created: true });

    const mock = makeSupabaseMock();
    const ctx = makeCtx({ supabase: mock.supabase });
    const result = await runCnpjSearch(VALID_CNPJ, ctx);

    expect(result.ok).toBe(true);
    expect(createServerPredictusClient).not.toHaveBeenCalled();
    expect(setCachedResults).not.toHaveBeenCalled();
    expect(encryptText).toHaveBeenCalledOnce();
    expect(findOrCreateJob).toHaveBeenCalledOnce();
    expect(mock.inserts).toHaveLength(1);
    const inserted = mock.inserts[0];
    expect(inserted?.status).toBe('pending');
    expect(inserted?.result_count).toBe(0);
    expect(inserted?.document_encrypted).toBe('enc-bytes');
  });

  it('cache MISS + 23505 re-submit: falls back to existing pending, returns ok:true', async () => {
    vi.mocked(getCachedResults).mockResolvedValueOnce(null);
    vi.mocked(findOrCreateJob).mockResolvedValueOnce({ jobId: 'job-cnpj-3', created: false });

    const mock = makeSupabaseMock({
      insertError: { code: '23505', message: 'duplicate key' },
      existingPendingId: 'existing-cnpj-pending',
    });
    const ctx = makeCtx({ supabase: mock.supabase });
    const result = await runCnpjSearch(VALID_CNPJ, ctx);

    expect(result.ok).toBe(true);
    expect(findOrCreateJob).toHaveBeenCalledOnce();
    expect(mock.selectForFallback).toHaveBeenCalled();
  });

  it('encryptText throws on cache MISS: returns ok:false, no findOrCreateJob, no insert', async () => {
    vi.mocked(getCachedResults).mockResolvedValueOnce(null);
    vi.mocked(encryptText).mockRejectedValueOnce(new Error('vault down'));

    const mock = makeSupabaseMock();
    const ctx = makeCtx({ supabase: mock.supabase });
    const result = await runCnpjSearch(VALID_CNPJ, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Falha ao registrar a consulta/);
    expect(findOrCreateJob).not.toHaveBeenCalled();
    expect(mock.inserts).toHaveLength(0);
  });

  it('getCachedResults throws: treated as miss, flow continues, returns ok:true', async () => {
    vi.mocked(getCachedResults).mockRejectedValueOnce(new Error('cache lookup boom'));
    vi.mocked(findOrCreateJob).mockResolvedValueOnce({ jobId: 'job-cnpj-4', created: true });

    const mock = makeSupabaseMock();
    const ctx = makeCtx({ supabase: mock.supabase });
    const result = await runCnpjSearch(VALID_CNPJ, ctx);

    expect(result.ok).toBe(true);
    expect(encryptText).toHaveBeenCalledOnce();
    expect(findOrCreateJob).toHaveBeenCalledOnce();
    expect(mock.inserts).toHaveLength(1);
    expect(mock.inserts[0]?.status).toBe('pending');
  });
});
