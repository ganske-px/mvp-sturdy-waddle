// lib/netrin/hops/cnpj-search.test.ts
import { describe, expect, it, vi } from 'vitest';
import { runCnpjSearch } from './cnpj-search';

describe('runCnpjSearch', () => {
  it('extracts CPF socios from cache hit', async () => {
    const result = await runCnpjSearch({
      cnpjRaw: '12345678000190',
      cnpjHash: 'cnpj:hh',
      userId: 'u1',
      jobId: 'j1',
      audit: async () => {},
      getCache: async () => ({
        payload: {
          'pessoas-relacionadas-cnpj': {
            entidadesRelacionadas: [{ cpf: '12345678909', vinculoDoRelacionamento: 'SOCIO' }],
          },
        },
        slugsFetched: ['pessoas-relacionadas-cnpj'],
        fetchedAt: '2026-05-26T00:00:00Z',
      }),
      setCache: async () => {},
      fetchComposta: vi.fn(),
    });
    expect(result.cached).toBe(true);
    expect(result.pivotCpfs.map((p) => p.cpf)).toEqual(['12345678909']);
  });

  it('fetches on miss', async () => {
    const fetchSpy = vi.fn(async () => ({
      'pessoas-relacionadas-cnpj': { entidadesRelacionadas: [] },
    }));
    await runCnpjSearch({
      cnpjRaw: '12345678000190',
      cnpjHash: 'cnpj:hh',
      userId: 'u1',
      jobId: 'j1',
      audit: async () => {},
      getCache: async () => null,
      setCache: async () => {},
      fetchComposta: fetchSpy,
    });
    expect(fetchSpy).toHaveBeenCalled();
  });
});
