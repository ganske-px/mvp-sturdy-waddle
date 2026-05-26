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
  encryptText: vi.fn().mockResolvedValue('enc-bytes'),
}));

import { findOrCreateJob } from '@/lib/netrin/job-store';
import { getCachedResults, setCachedResults } from '@/lib/predictus/cache';
import { createServerPredictusClient } from '@/lib/predictus/server-client';
import type { RunSearchContext } from './run-search';
import { runCnpjSearch, runCpfSearch } from './run-search';

function makeCtx(overrides: Partial<RunSearchContext> = {}): RunSearchContext {
  const insertMock = vi.fn().mockResolvedValue({ error: null });
  const supabase = {
    from: vi.fn(() => ({ insert: insertMock })),
  } as never;
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

const VALID_CPF = '529.982.247-25'; // valid check-digit CPF
const VALID_CNPJ = '11.222.333/0001-81'; // valid check-digit CNPJ

beforeEach(() => {
  vi.clearAllMocks();
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

  it('cache hit: inserts searches row + ensures enrichment job + returns success without calling predictus', async () => {
    vi.mocked(getCachedResults).mockResolvedValueOnce({
      results: [{ id: 'p1' } as never],
      fetchedAt: new Date().toISOString(),
    });
    vi.mocked(findOrCreateJob).mockResolvedValueOnce({ jobId: 'job-1', created: true });

    const ctx = makeCtx();
    const result = await runCpfSearch(VALID_CPF, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // SHA-256 hex output is 64 hex chars (no prefix in the returned value)
      expect(result.documentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.termPreview).toBeTruthy();
    }
    expect(createServerPredictusClient).not.toHaveBeenCalled();
    expect(findOrCreateJob).toHaveBeenCalledOnce();
    // supabase searches insert was called
    const supabaseMock = ctx.supabase as unknown as { from: ReturnType<typeof vi.fn> };
    expect(supabaseMock.from).toHaveBeenCalledWith('searches');
  });

  it('cache miss: calls predictus, writes cache, inserts searches row, ensures job, returns hash', async () => {
    vi.mocked(getCachedResults).mockResolvedValueOnce(null);
    const mockClient = { searchByCpf: vi.fn().mockResolvedValue([{ id: 'p2' }]) };
    vi.mocked(createServerPredictusClient).mockResolvedValueOnce(mockClient as never);
    vi.mocked(setCachedResults).mockResolvedValueOnce(undefined);
    vi.mocked(findOrCreateJob).mockResolvedValueOnce({ jobId: 'job-2', created: true });

    const ctx = makeCtx();
    const result = await runCpfSearch(VALID_CPF, ctx);

    expect(result.ok).toBe(true);
    expect(mockClient.searchByCpf).toHaveBeenCalledOnce();
    expect(setCachedResults).toHaveBeenCalledOnce();
    expect(findOrCreateJob).toHaveBeenCalledOnce();
    const supabaseMock = ctx.supabase as unknown as { from: ReturnType<typeof vi.fn> };
    expect(supabaseMock.from).toHaveBeenCalledWith('searches');
  });

  it('predictus error: inserts searches row with error_message, returns ok:false', async () => {
    vi.mocked(getCachedResults).mockResolvedValueOnce(null);
    const mockClient = { searchByCpf: vi.fn().mockRejectedValue(new Error('upstream error')) };
    vi.mocked(createServerPredictusClient).mockResolvedValueOnce(mockClient as never);

    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const ctx = makeCtx({
      supabase: { from: vi.fn(() => ({ insert: insertMock })) } as never,
    });
    const result = await runCpfSearch(VALID_CPF, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('upstream error');
    expect(insertMock).toHaveBeenCalledOnce();
    const insertArg = insertMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(insertArg?.error_message).toBe('upstream error');
    expect(insertArg?.result_count).toBe(0);
  });
});

describe('runCnpjSearch', () => {
  it('rejects invalid CNPJ with ok:false', async () => {
    const ctx = makeCtx();
    const result = await runCnpjSearch('00.000.000/0000-00', ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/cnpj/i);
  });

  it('cache hit path: returns success without calling predictus', async () => {
    vi.mocked(getCachedResults).mockResolvedValueOnce({
      results: [{ id: 'c1' } as never],
      fetchedAt: new Date().toISOString(),
    });
    vi.mocked(findOrCreateJob).mockResolvedValueOnce({ jobId: 'job-cnpj-1', created: true });

    const ctx = makeCtx();
    const result = await runCnpjSearch(VALID_CNPJ, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // SHA-256 hex output is 64 hex chars
      expect(result.documentHash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(createServerPredictusClient).not.toHaveBeenCalled();
  });

  it('cache miss path: calls predictus, inserts row, ensures enrichment job', async () => {
    vi.mocked(getCachedResults).mockResolvedValueOnce(null);
    const mockClient = { searchByCnpj: vi.fn().mockResolvedValue([{ id: 'c2' }]) };
    vi.mocked(createServerPredictusClient).mockResolvedValueOnce(mockClient as never);
    vi.mocked(setCachedResults).mockResolvedValueOnce(undefined);
    vi.mocked(findOrCreateJob).mockResolvedValueOnce({ jobId: 'job-cnpj-2', created: true });

    const ctx = makeCtx();
    const result = await runCnpjSearch(VALID_CNPJ, ctx);

    expect(result.ok).toBe(true);
    expect(mockClient.searchByCnpj).toHaveBeenCalledOnce();
    expect(setCachedResults).toHaveBeenCalledOnce();
    expect(findOrCreateJob).toHaveBeenCalledOnce();
  });
});
