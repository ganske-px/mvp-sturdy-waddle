import { describe, expect, it } from 'vitest';
import { processEnrichmentJob } from './processor';

describe('processEnrichmentJob', () => {
  it('runs hop1 → hop2 (per cnpj) → hop3 (per cpf), updates counters', async () => {
    const calls: string[] = [];
    const result = await processEnrichmentJob('job1', {
      job: { rootType: 'cpf', rootRaw: '12345678909', rootHash: 'cpf:abc', userId: 'u1' },
      setJobStatus: async (_id, status) => {
        calls.push(`status:${status}`);
      },
      setHop1Status: async (_id, s) => {
        calls.push(`hop1:${s}`);
      },
      setHopTotals: async (_id, t) => {
        calls.push(`totals:${JSON.stringify(t)}`);
      },
      bumpHopDone: async (_id, hop) => {
        calls.push(`bump:${hop}`);
      },
      recordCall: async (input) => {
        calls.push(`record:${input.hop}:${input.status}`);
      },
      runHop1: async () => ({
        payload: {},
        pivotCnpjs: ['11111111000111', '22222222000222'],
        cached: false,
      }),
      runHop2: async (cnpjRaw) => ({
        payload: {},
        pivotCpfs: [{ cpf: '33333333333', vinculo: 'SOCIO', ativo: true }],
        cached: cnpjRaw === '22222222000222',
      }),
      runHop3: async () => ({ payload: {}, cached: false }),
      finalize: async () => {
        calls.push('finalize');
      },
    });

    expect(result.status).toBe('completed');
    expect(calls).toContain('status:running');
    expect(calls).toContain('hop1:success');
    expect(calls).toContain('totals:{"hop2_total":2}');
    expect(calls.filter((c) => c === 'bump:2')).toHaveLength(2);
    expect(calls.filter((c) => c === 'bump:3').length).toBeGreaterThanOrEqual(1);
    expect(calls).toContain('finalize');
    expect(calls).toContain('status:completed');
  });

  it('marks partial when a hop2 throws', async () => {
    const result = await processEnrichmentJob('job1', {
      job: { rootType: 'cpf', rootRaw: '12345678909', rootHash: 'cpf:abc', userId: 'u1' },
      setJobStatus: async () => {},
      setHop1Status: async () => {},
      setHopTotals: async () => {},
      bumpHopDone: async () => {},
      recordCall: async () => {},
      runHop1: async () => ({ payload: {}, pivotCnpjs: ['11111111000111'], cached: false }),
      runHop2: async () => {
        throw new Error('boom');
      },
      runHop3: async () => ({ payload: {}, cached: false }),
      finalize: async () => {},
    });
    expect(result.status).toBe('partial');
  });

  it('marks failed when hop1 throws', async () => {
    const result = await processEnrichmentJob('job1', {
      job: { rootType: 'cpf', rootRaw: '12345678909', rootHash: 'cpf:abc', userId: 'u1' },
      setJobStatus: async () => {},
      setHop1Status: async () => {},
      setHopTotals: async () => {},
      bumpHopDone: async () => {},
      recordCall: async () => {},
      runHop1: async () => {
        throw new Error('upstream');
      },
      runHop2: async () => ({ payload: {}, pivotCpfs: [], cached: false }),
      runHop3: async () => ({ payload: {}, cached: false }),
      finalize: async () => {},
    });
    expect(result.status).toBe('failed');
  });

  it('skips hop1 when root_type=cnpj and starts from hop2', async () => {
    const calls: string[] = [];
    const result = await processEnrichmentJob('job1', {
      job: { rootType: 'cnpj', rootRaw: '12345678000190', rootHash: 'cnpj:abc', userId: 'u1' },
      setJobStatus: async () => {},
      setHop1Status: async (_id, s) => {
        calls.push(`hop1:${s}`);
      },
      setHopTotals: async () => {},
      bumpHopDone: async () => {},
      recordCall: async () => {},
      runHop1: async () => {
        throw new Error('should not be called');
      },
      runHop2: async () => ({
        payload: {},
        pivotCpfs: [{ cpf: '11111111111', vinculo: 'SOCIO', ativo: true }],
        cached: false,
      }),
      runHop3: async () => ({ payload: {}, cached: false }),
      finalize: async () => {},
    });
    expect(calls).toContain('hop1:skipped');
    expect(result.status).toBe('completed');
  });
});
