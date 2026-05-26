// lib/netrin/hops/hop3.test.ts
import { describe, expect, it, vi } from 'vitest';
import { runHop3 } from './hop3';

describe('runHop3', () => {
  it('audits and fetches reduced slug set; terminal (no pivots returned)', async () => {
    const auditSpy = vi.fn(async () => {});
    // as never: mock payload shape needs a type assertion for vitest mocking
    const fetchSpy = vi.fn(async () => ({ 'esp-cpf': {} } as never));
    const result = await runHop3({
      cpfRaw: '98765432100',
      cpfHash: 'cpf:hh',
      userId: 'u1',
      jobId: 'j1',
      audit: auditSpy,
      getCache: async () => null,
      setCache: async () => {},
      fetchComposta: fetchSpy,
    });
    expect(result.cached).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, , slugs] = fetchSpy.mock.calls[0] as unknown as [unknown, unknown, readonly string[]];
    expect(slugs).toContain('esp-cpf');
    expect(slugs).toContain('pep-kyc-cpf');
    expect(slugs).toContain('processos-cpf');
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ hop: 3 }),
      }),
    );
  });
});
