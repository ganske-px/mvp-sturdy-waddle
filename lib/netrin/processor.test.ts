import { describe, expect, it } from 'vitest';
import { processEnrichmentJob } from './processor';

describe('processEnrichmentJob', () => {
  it('CPF root: roda cpf-search e marca completed', async () => {
    const calls: string[] = [];
    const result = await processEnrichmentJob('job1', {
      job: { rootType: 'cpf', rootRaw: '12345678909', rootHash: 'cpf:abc', userId: 'u1' },
      setJobStatus: async (_id, status) => {
        calls.push(`status:${status}`);
      },
      setNetrinStatus: async (_id, s) => {
        calls.push(`netrin:${s}`);
      },
      recordCall: async (input) => {
        calls.push(`record:${input.hop}:${input.status}`);
      },
      runCpfSearch: async () => ({ payload: {}, pivotCnpjs: [], cached: false }),
      runCnpjSearch: async () => {
        throw new Error('should not be called for CPF root');
      },
      finalize: async () => {
        calls.push('finalize');
      },
    });

    expect(result.status).toBe('completed');
    expect(calls).toEqual([
      'status:running',
      'record:1:success',
      'netrin:success',
      'finalize',
      'status:completed',
    ]);
  });

  it('CNPJ root: roda cnpj-search e marca completed', async () => {
    const calls: string[] = [];
    const result = await processEnrichmentJob('job1', {
      job: { rootType: 'cnpj', rootRaw: '12345678000190', rootHash: 'cnpj:abc', userId: 'u1' },
      setJobStatus: async (_id, status) => {
        calls.push(`status:${status}`);
      },
      setNetrinStatus: async (_id, s) => {
        calls.push(`netrin:${s}`);
      },
      recordCall: async (input) => {
        calls.push(`record:${input.hop}:${input.status}`);
      },
      runCpfSearch: async () => {
        throw new Error('should not be called for CNPJ root');
      },
      runCnpjSearch: async () => ({ payload: {}, pivotCpfs: [], cached: false }),
      finalize: async () => {
        calls.push('finalize');
      },
    });

    expect(result.status).toBe('completed');
    expect(calls).toEqual([
      'status:running',
      'record:2:success',
      'netrin:success',
      'finalize',
      'status:completed',
    ]);
  });

  it('cache hit: status cache_hit, ainda completed', async () => {
    const calls: string[] = [];
    const result = await processEnrichmentJob('job1', {
      job: { rootType: 'cpf', rootRaw: '12345678909', rootHash: 'cpf:abc', userId: 'u1' },
      setJobStatus: async () => {},
      setNetrinStatus: async (_id, s) => {
        calls.push(`netrin:${s}`);
      },
      recordCall: async (input) => {
        calls.push(`record:${input.cached ? 'cached' : 'fresh'}`);
      },
      runCpfSearch: async () => ({ payload: {}, pivotCnpjs: [], cached: true }),
      runCnpjSearch: async () => ({ payload: {}, pivotCpfs: [], cached: false }),
      finalize: async () => {},
    });

    expect(result.status).toBe('completed');
    expect(calls).toContain('netrin:cache_hit');
    expect(calls).toContain('record:cached');
  });

  it('netrin call falha: marca failed e propaga error', async () => {
    let recordedError: string | undefined;
    const result = await processEnrichmentJob('job1', {
      job: { rootType: 'cpf', rootRaw: '12345678909', rootHash: 'cpf:abc', userId: 'u1' },
      setJobStatus: async (_id, _status, opts) => {
        if (opts?.error) recordedError = opts.error;
      },
      setNetrinStatus: async () => {},
      recordCall: async () => {},
      runCpfSearch: async () => {
        throw new Error('netrin upstream 502');
      },
      runCnpjSearch: async () => ({ payload: {}, pivotCpfs: [], cached: false }),
      finalize: async () => {},
    });

    expect(result.status).toBe('failed');
    expect(recordedError).toBe('netrin upstream 502');
  });

  it('finalize falha nao muda status final', async () => {
    const result = await processEnrichmentJob('job1', {
      job: { rootType: 'cpf', rootRaw: '12345678909', rootHash: 'cpf:abc', userId: 'u1' },
      setJobStatus: async () => {},
      setNetrinStatus: async () => {},
      recordCall: async () => {},
      runCpfSearch: async () => ({ payload: {}, pivotCnpjs: [], cached: false }),
      runCnpjSearch: async () => ({ payload: {}, pivotCpfs: [], cached: false }),
      finalize: async () => {
        throw new Error('graph write failed');
      },
    });

    expect(result.status).toBe('completed');
  });
});
