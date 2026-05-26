import { hashDocument } from '@/lib/hash';
import { describe, expect, it } from 'vitest';
import { loadEnrichmentForRoot } from './result-loader';

type JobRowFix = {
  id: string;
  user_id: string;
  root_hash: string;
  root_type: 'cpf' | 'cnpj';
  status: 'pending' | 'running' | 'completed' | 'partial' | 'failed';
  hop1_status: 'success' | 'error' | 'cache_hit' | 'skipped' | null;
  hop2_total: number;
  hop2_done: number;
  hop3_total: number;
  hop3_done: number;
  started_at: string;
  finished_at: string | null;
  error: string | null;
};

type CallRowFix = {
  id: string;
  hop: 1 | 2 | 3;
  document_hash: string;
  document_type: 'cpf' | 'cnpj';
  status: 'pending' | 'running' | 'success' | 'error' | 'cache_hit';
  cached: boolean;
  fetched_at: string | null;
  error: string | null;
};

type CacheRowFix = {
  document_hash: string;
  document_type: 'cpf' | 'cnpj';
  encrypted_payload: string;
};

type FakeOpts = {
  jobRow?: JobRowFix | null;
  jobError?: { message: string };
  callRows?: CallRowFix[];
  callsError?: { message: string };
  cacheRows?: CacheRowFix[];
  cacheError?: { message: string };
  decryptFails?: Set<string>;
};

function fakeClient(opts: FakeOpts) {
  return {
    from(table: string) {
      if (table === 'enrichment_jobs') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () => ({
                    returns<T>() {
                      return Promise.resolve({
                        data: (opts.jobRow ?? null) as T | null,
                        error: opts.jobError ?? null,
                      });
                    },
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'enrichment_job_calls') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                returns<T>() {
                  return Promise.resolve({
                    data: (opts.callRows ?? []) as T,
                    error: opts.callsError ?? null,
                  });
                },
              }),
            }),
          }),
        };
      }
      if (table === 'netrin_cache') {
        return {
          select: () => ({
            in: () => ({
              gt: () => ({
                returns<T>() {
                  return Promise.resolve({
                    data: (opts.cacheRows ?? []) as T,
                    error: opts.cacheError ?? null,
                  });
                },
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected from(${table})`);
    },
    rpc(name: string, args: { ciphertext?: string }) {
      if (name === 'decrypt_netrin') {
        const ct = args.ciphertext ?? '';
        if (opts.decryptFails?.has(ct)) {
          return Promise.resolve({ data: null, error: { message: 'boom' } });
        }
        // Convention: ciphertext is `enc(<plain>)`
        const plain = ct.replace(/^enc\(/, '').replace(/\)$/, '');
        return Promise.resolve({ data: plain, error: null });
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  } as never;
}

function jobFix(over: Partial<JobRowFix> = {}): JobRowFix {
  return {
    id: 'j-1',
    user_id: 'u-1',
    root_hash: 'cpf:abc',
    root_type: 'cpf',
    status: 'completed',
    hop1_status: 'success',
    hop2_total: 1,
    hop2_done: 1,
    hop3_total: 1,
    hop3_done: 1,
    started_at: '2026-05-26T00:00:00Z',
    finished_at: '2026-05-26T00:01:00Z',
    error: null,
    ...over,
  };
}

describe('loadEnrichmentForRoot', () => {
  it('returns null when no job exists for the root hash', async () => {
    const client = fakeClient({ jobRow: null });
    const result = await loadEnrichmentForRoot(client, {
      userId: 'u-1',
      rootHash: 'cpf:abc',
      rootType: 'cpf',
    });
    expect(result).toBeNull();
  });

  it('returns null when the job query errors', async () => {
    const client = fakeClient({ jobError: { message: 'db down' } });
    const result = await loadEnrichmentForRoot(client, {
      userId: 'u-1',
      rootHash: 'cpf:abc',
      rootType: 'cpf',
    });
    expect(result).toBeNull();
  });

  it('returns job with empty calls and payloads when no calls exist', async () => {
    const client = fakeClient({ jobRow: jobFix(), callRows: [] });
    const result = await loadEnrichmentForRoot(client, {
      userId: 'u-1',
      rootHash: 'cpf:abc',
      rootType: 'cpf',
    });
    expect(result).not.toBeNull();
    expect(result?.job.id).toBe('j-1');
    expect(result?.calls).toEqual([]);
    expect(result?.payloads).toEqual({ hop1: null, byCnpj: {}, byCpf: {} });
  });

  it('maps call rows but skips cache lookup when none are success/cache_hit', async () => {
    const client = fakeClient({
      jobRow: jobFix(),
      callRows: [
        {
          id: 'c-1',
          hop: 1,
          document_hash: 'cpf:abc',
          document_type: 'cpf',
          status: 'error',
          cached: false,
          fetched_at: null,
          error: 'upstream 500',
        },
      ],
    });

    const result = await loadEnrichmentForRoot(client, {
      userId: 'u-1',
      rootHash: 'cpf:abc',
      rootType: 'cpf',
    });
    expect(result?.calls).toHaveLength(1);
    expect(result?.calls[0]?.status).toBe('error');
    expect(result?.payloads).toEqual({ hop1: null, byCnpj: {}, byCpf: {} });
  });

  it('decrypts and routes payloads into hop1 / byCnpj / byCpf by hop number', async () => {
    const hop1Payload = { 'pep-kyc-cpf': { nome: 'JOAO' } };
    const hop2Payload = { 'esp-cnpj-completo': { razaoSocial: 'ACME' } };
    const hop3Payload = { 'pep-kyc-cpf': { nome: 'MARIA' } };

    const client = fakeClient({
      jobRow: jobFix(),
      callRows: [
        {
          id: 'c1',
          hop: 1,
          document_hash: 'cpf:abc',
          document_type: 'cpf',
          status: 'success',
          cached: false,
          fetched_at: '2026-05-26T00:00:01Z',
          error: null,
        },
        {
          id: 'c2',
          hop: 2,
          document_hash: 'cnpj:xyz',
          document_type: 'cnpj',
          status: 'cache_hit',
          cached: true,
          fetched_at: '2026-05-26T00:00:02Z',
          error: null,
        },
        {
          id: 'c3',
          hop: 3,
          document_hash: 'cpf:def',
          document_type: 'cpf',
          status: 'success',
          cached: false,
          fetched_at: '2026-05-26T00:00:03Z',
          error: null,
        },
      ],
      cacheRows: [
        {
          document_hash: 'cpf:abc',
          document_type: 'cpf',
          encrypted_payload: `enc(${JSON.stringify(hop1Payload)})`,
        },
        {
          document_hash: 'cnpj:xyz',
          document_type: 'cnpj',
          encrypted_payload: `enc(${JSON.stringify(hop2Payload)})`,
        },
        {
          document_hash: 'cpf:def',
          document_type: 'cpf',
          encrypted_payload: `enc(${JSON.stringify(hop3Payload)})`,
        },
      ],
    });

    const result = await loadEnrichmentForRoot(client, {
      userId: 'u-1',
      rootHash: 'cpf:abc',
      rootType: 'cpf',
    });
    expect(result?.payloads.hop1).toEqual(hop1Payload);
    expect(result?.payloads.byCnpj['cnpj:xyz']).toEqual(hop2Payload);
    expect(result?.payloads.byCpf['cpf:def']).toEqual(hop3Payload);
  });

  it('omits a payload when decryption fails for that row', async () => {
    const hop1Payload = { 'pep-kyc-cpf': { nome: 'JOAO' } };
    const badCipher = 'enc(BROKEN)';

    const client = fakeClient({
      jobRow: jobFix(),
      callRows: [
        {
          id: 'c1',
          hop: 1,
          document_hash: 'cpf:abc',
          document_type: 'cpf',
          status: 'success',
          cached: false,
          fetched_at: null,
          error: null,
        },
        {
          id: 'c2',
          hop: 2,
          document_hash: 'cnpj:xyz',
          document_type: 'cnpj',
          status: 'success',
          cached: false,
          fetched_at: null,
          error: null,
        },
      ],
      cacheRows: [
        {
          document_hash: 'cpf:abc',
          document_type: 'cpf',
          encrypted_payload: `enc(${JSON.stringify(hop1Payload)})`,
        },
        { document_hash: 'cnpj:xyz', document_type: 'cnpj', encrypted_payload: badCipher },
      ],
      decryptFails: new Set([badCipher]),
    });

    const result = await loadEnrichmentForRoot(client, {
      userId: 'u-1',
      rootHash: 'cpf:abc',
      rootType: 'cpf',
    });
    expect(result?.payloads.hop1).toEqual(hop1Payload);
    expect(result?.payloads.byCnpj).toEqual({});
  });

  it('returns job + calls but empty payloads when the cache query errors', async () => {
    const client = fakeClient({
      jobRow: jobFix(),
      callRows: [
        {
          id: 'c1',
          hop: 1,
          document_hash: 'cpf:abc',
          document_type: 'cpf',
          status: 'success',
          cached: false,
          fetched_at: null,
          error: null,
        },
      ],
      cacheError: { message: 'cache down' },
    });

    const result = await loadEnrichmentForRoot(client, {
      userId: 'u-1',
      rootHash: 'cpf:abc',
      rootType: 'cpf',
    });
    expect(result?.calls).toHaveLength(1);
    expect(result?.payloads).toEqual({ hop1: null, byCnpj: {}, byCpf: {} });
  });
});

// ── pivotAwareFakeClient ──────────────────────────────────────────────────────

type PivotAwareOpts = FakeOpts & {
  firstCacheRows?: CacheRowFix[];
  pivotCacheRows?: CacheRowFix[];
};

function pivotAwareFakeClient(opts: PivotAwareOpts) {
  let cacheCallCount = 0;
  return {
    from(table: string) {
      if (table === 'enrichment_jobs') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () => ({
                    returns<T>() {
                      return Promise.resolve({
                        data: (opts.jobRow ?? null) as T | null,
                        error: opts.jobError ?? null,
                      });
                    },
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'enrichment_job_calls') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                returns<T>() {
                  return Promise.resolve({
                    data: (opts.callRows ?? []) as T,
                    error: opts.callsError ?? null,
                  });
                },
              }),
            }),
          }),
        };
      }
      if (table === 'netrin_cache') {
        cacheCallCount += 1;
        const currentCall = cacheCallCount;
        return {
          select: () => ({
            in: (_col: string, hashes: string[]) => ({
              gt: () => ({
                returns<T>() {
                  if (currentCall === 1) {
                    const rows = (opts.firstCacheRows ?? []).filter((r) =>
                      hashes.includes(r.document_hash),
                    );
                    return Promise.resolve({ data: rows as T, error: opts.cacheError ?? null });
                  }
                  // currentCall >= 2 → pivot lookup
                  const rows = (opts.pivotCacheRows ?? []).filter((r) =>
                    hashes.includes(r.document_hash),
                  );
                  return Promise.resolve({ data: rows as T, error: null });
                },
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected from(${table})`);
    },
    rpc(name: string, args: { ciphertext?: string }) {
      if (name === 'decrypt_netrin') {
        const ct = args.ciphertext ?? '';
        if (opts.decryptFails?.has(ct)) {
          return Promise.resolve({ data: null, error: { message: 'boom' } });
        }
        const plain = ct.replace(/^enc\(/, '').replace(/\)$/, '');
        return Promise.resolve({ data: plain, error: null });
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  } as never;
}

describe('loadEnrichmentForRoot – pivot cache lookup', () => {
  it('decifra cache de CNPJ pivô do payload raiz mesmo sem call no job', async () => {
    // Root CPF has 2 related CNPJs in its payload.
    // Only one of them has a netrin_cache entry (was drilled in another session).
    const hop1Payload = {
      empresasRelacionadasCPF: {
        negociosRelacionados: [
          {
            entidadeRelacionadadaTipoDeDocumento: 'CNPJ',
            entidadeRelacionadaDocumento: '11111111000111',
          },
          {
            entidadeRelacionadadaTipoDeDocumento: 'CNPJ',
            entidadeRelacionadaDocumento: '22222222000122',
          },
        ],
      },
    };
    const drilledCnpjHash = hashDocument('cnpj', '11111111000111');
    const cnpj1Payload = { 'esp-cnpj-completo': { razaoSocial: 'DRILLED LTDA' } };

    const client = pivotAwareFakeClient({
      jobRow: jobFix(),
      callRows: [
        {
          id: 'c1',
          hop: 1,
          document_hash: 'cpf:abc',
          document_type: 'cpf',
          status: 'success',
          cached: false,
          fetched_at: '2026-05-26T00:00:01Z',
          error: null,
        },
      ],
      firstCacheRows: [
        {
          document_hash: 'cpf:abc',
          document_type: 'cpf',
          encrypted_payload: `enc(${JSON.stringify(hop1Payload)})`,
        },
      ],
      pivotCacheRows: [
        {
          document_hash: drilledCnpjHash,
          document_type: 'cnpj',
          encrypted_payload: `enc(${JSON.stringify(cnpj1Payload)})`,
        },
      ],
    });

    const result = await loadEnrichmentForRoot(client, {
      userId: 'u-1',
      rootHash: 'cpf:abc',
      rootType: 'cpf',
    });
    expect(result).not.toBeNull();
    // hop1 payload still decrypted from first cache pass:
    expect(result?.payloads.hop1).toEqual(hop1Payload);
    // pivot cache decoded from second cache pass:
    expect(Object.keys(result?.payloads.byCnpj ?? {})).toContain(drilledCnpjHash);
    expect(result?.payloads.byCnpj[drilledCnpjHash]).toEqual(cnpj1Payload);
  });

  it('decifra cache de CPF relacionado (família) do payload raiz CPF mesmo sem call no job', async () => {
    // Root CPF has a related person (pessoasRelacionadasCPF) drilled in another
    // session — cache exists but no call in this job.
    const hop1Payload = {
      pessoasRelacionadasCPF: {
        entidadesRelacionadas: [
          {
            entidadeRelacionadaDocumento: '02264486732',
            entidadeRelacionadadaTipoDeDocumento: 'CPF',
            tipoDeRelacionamento: 'MOTHER',
          },
          {
            entidadeRelacionadaDocumento: '06917562793',
            entidadeRelacionadadaTipoDeDocumento: 'CPF',
            tipoDeRelacionamento: 'GRANDPARENT',
          },
        ],
      },
    };
    const drilledCpfHash = hashDocument('cpf', '02264486732');
    const motherPayload = { 'pep-kyc-cpf': { currentlyPEP: 'N' } };

    const client = pivotAwareFakeClient({
      jobRow: jobFix(),
      callRows: [
        {
          id: 'c1',
          hop: 1,
          document_hash: 'cpf:abc',
          document_type: 'cpf',
          status: 'success',
          cached: false,
          fetched_at: '2026-05-26T00:00:01Z',
          error: null,
        },
      ],
      firstCacheRows: [
        {
          document_hash: 'cpf:abc',
          document_type: 'cpf',
          encrypted_payload: `enc(${JSON.stringify(hop1Payload)})`,
        },
      ],
      pivotCacheRows: [
        {
          document_hash: drilledCpfHash,
          document_type: 'cpf',
          encrypted_payload: `enc(${JSON.stringify(motherPayload)})`,
        },
      ],
    });

    const result = await loadEnrichmentForRoot(client, {
      userId: 'u-1',
      rootHash: 'cpf:abc',
      rootType: 'cpf',
    });

    expect(result).not.toBeNull();
    expect(result?.payloads.hop1).toEqual(hop1Payload);
    expect(result?.payloads.byCpf[drilledCpfHash]).toEqual(motherPayload);
  });

  it('decifra cache de CPF sócio do payload raiz CNPJ mesmo sem call no job', async () => {
    // Root CNPJ has 2 sócios in its pessoas-relacionadas-cnpj payload.
    // One of them was drilled in another session — cache exists but no call in this job.
    const rootCnpjPayload = {
      'pessoas-relacionadas-cnpj': {
        entidadesRelacionadas: [
          { cpf: '11111111111', nome: 'JOAO' },
          { cpf: '22222222222', nome: 'MARIA' }, // not cached
        ],
      },
    };
    const drilledCpfHash = hashDocument('cpf', '11111111111');
    const cpfDrilledPayload = { 'pep-kyc-cpf': { currentlyPEP: 'S' } };

    const client = pivotAwareFakeClient({
      jobRow: jobFix({ root_type: 'cnpj', root_hash: 'cnpj:root' }),
      callRows: [
        {
          id: 'c1',
          hop: 2,
          document_hash: 'cnpj:root',
          document_type: 'cnpj',
          status: 'success',
          cached: false,
          fetched_at: '2026-05-26T00:00:01Z',
          error: null,
        },
      ],
      firstCacheRows: [
        {
          document_hash: 'cnpj:root',
          document_type: 'cnpj',
          encrypted_payload: `enc(${JSON.stringify(rootCnpjPayload)})`,
        },
      ],
      pivotCacheRows: [
        {
          document_hash: drilledCpfHash,
          document_type: 'cpf',
          encrypted_payload: `enc(${JSON.stringify(cpfDrilledPayload)})`,
        },
      ],
    });

    const result = await loadEnrichmentForRoot(client, {
      userId: 'u-1',
      rootHash: 'cnpj:root',
      rootType: 'cnpj',
    });

    expect(result).not.toBeNull();
    // Root CNPJ payload landed in byCnpj keyed by rootHash:
    expect(result?.payloads.byCnpj['cnpj:root']).toEqual(rootCnpjPayload);
    // Drilled CPF sócio cache was decoded:
    expect(result?.payloads.byCpf[drilledCpfHash]).toEqual(cpfDrilledPayload);
  });
});
