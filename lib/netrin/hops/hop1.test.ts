// lib/netrin/hops/hop1.test.ts
import { describe, expect, it, vi } from 'vitest';
import { runHop1 } from './hop1';

describe('runHop1', () => {
  it('returns cached payload + extracts CNPJ pivots, no fetch', async () => {
    const auditSpy = vi.fn(async () => {});
    const fetchSpy = vi.fn();
    const result = await runHop1({
      documentRaw: '12345678909',
      documentHash: 'cpf:abc',
      userId: 'u1',
      jobId: 'j1',
      audit: auditSpy,
      getCache: async () => ({
        payload: {
          'empresas-relacionadas-cpf': {
            negociosRelacionados: [{ cnpj: '12345678000190' }],
          },
        },
        slugsFetched: ['esp-cpf', 'empresas-relacionadas-cpf'],
        fetchedAt: '2026-05-26T00:00:00Z',
      }),
      setCache: async () => {},
      fetchComposta: fetchSpy,
    });

    expect(result.cached).toBe(true);
    expect(result.pivotCnpjs).toEqual(['12345678000190']);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'enrichment_call',
        documentHash: 'cpf:abc',
        metadata: expect.objectContaining({ hop: 1, jobId: 'j1' }),
      }),
    );
  });

  it('calls Netrin and writes cache on miss', async () => {
    const fetchSpy = vi.fn(async () => ({
      'esp-cpf': { nome: 'JOAO' },
      'empresas-relacionadas-cpf': { negociosRelacionados: [{ cnpj: '98765432000110' }] },
    }));
    const setSpy = vi.fn(async () => {});
    const result = await runHop1({
      documentRaw: '12345678909',
      documentHash: 'cpf:abc',
      userId: 'u1',
      jobId: 'j1',
      audit: async () => {},
      getCache: async () => null,
      setCache: setSpy,
      fetchComposta: fetchSpy,
    });

    expect(result.cached).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(result.pivotCnpjs).toEqual(['98765432000110']);
  });
});
