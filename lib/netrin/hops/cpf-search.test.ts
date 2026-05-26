// lib/netrin/hops/cpf-search.test.ts
import { describe, expect, it, vi } from 'vitest';
import { runCpfSearch } from './cpf-search';

describe('runCpfSearch', () => {
  it('returns cached payload + extracts CNPJ pivots, no fetch', async () => {
    const auditSpy = vi.fn(async () => {});
    const fetchSpy = vi.fn();
    const result = await runCpfSearch({
      documentRaw: '12345678909',
      documentHash: 'cpf:abc',
      userId: 'u1',
      jobId: 'j1',
      audit: auditSpy,
      getCache: async () => ({
        payload: {
          empresasRelacionadasCPF: {
            negociosRelacionados: [
              {
                entidadeRelacionadaDocumento: '12345678000190',
                entidadeRelacionadadaTipoDeDocumento: 'CNPJ',
              },
            ],
          },
        } as never,
        slugsFetched: ['pep-kyc-cpf', 'empresas-relacionadas-cpf'],
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
      CpfBirthdate: { nome: 'JOAO' },
      empresasRelacionadasCPF: {
        negociosRelacionados: [
          {
            entidadeRelacionadaDocumento: '98765432000110',
            entidadeRelacionadadaTipoDeDocumento: 'CNPJ',
          },
        ],
      },
      // as never: mock payload uses friendly camelCase (CpfBirthdate), but Netrin returns snake_case; cast bridges the shape
    } as never));
    const setSpy = vi.fn(async () => {});
    const result = await runCpfSearch({
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
