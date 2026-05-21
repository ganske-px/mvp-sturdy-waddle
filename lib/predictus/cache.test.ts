import { describe, expect, it } from 'vitest';
import { CACHE_TTL_DAYS, getCachedResults, setCachedResults } from './cache';
import type { PredictusProcess } from './types';

type CacheRow = {
  document_hash: string;
  search_type: 'cpf' | 'cnpj' | 'name';
  encrypted_payload: string;
  result_count: number;
  fetched_at: string;
  expires_at: string;
};

type FakeClientOpts = {
  storedRow?: CacheRow;
  selectError?: { message: string };
  decryptError?: { message: string };
  encryptError?: { message: string };
  upsertError?: { message: string };
  // Synthetic encrypt: returns a deterministic ciphertext given a plaintext.
  encrypt?: (plaintext: string) => string;
  // Synthetic decrypt: returns plaintext given the stored ciphertext.
  decrypt?: (ciphertext: string) => string;
};

function buildFakeClient(opts: FakeClientOpts = {}) {
  const rpcCalls: Array<{ name: string; params: unknown }> = [];
  const upsertCalls: CacheRow[] = [];
  let row: CacheRow | null = opts.storedRow ?? null;

  const encrypt = opts.encrypt ?? ((p) => `cipher:${p}`);
  const decrypt = opts.decrypt ?? ((c) => c.replace(/^cipher:/, ''));

  const client = {
    from(table: string) {
      if (table !== 'predictus_cache') throw new Error(`unexpected table: ${table}`);
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _value: string) {
              return {
                gt(_gtCol: string, _gtVal: string) {
                  return {
                    maybeSingle: () => ({
                      returns: () =>
                        Promise.resolve({
                          data: row,
                          error: opts.selectError ?? null,
                        }),
                    }),
                  };
                },
              };
            },
          };
        },
        upsert(values: CacheRow) {
          upsertCalls.push(values);
          if (opts.upsertError) {
            return Promise.resolve({ error: opts.upsertError });
          }
          row = values;
          return Promise.resolve({ error: null });
        },
      };
    },
    rpc(name: string, params: Record<string, unknown>) {
      rpcCalls.push({ name, params });
      if (name === 'encrypt_payload') {
        if (opts.encryptError) {
          return Promise.resolve({ data: null, error: opts.encryptError });
        }
        return Promise.resolve({ data: encrypt(String(params.plaintext)), error: null });
      }
      if (name === 'decrypt_payload') {
        if (opts.decryptError) {
          return Promise.resolve({ data: null, error: opts.decryptError });
        }
        return Promise.resolve({ data: decrypt(String(params.ciphertext)), error: null });
      }
      throw new Error(`unexpected rpc: ${name}`);
    },
  };
  return {
    client,
    rpcCalls,
    upsertCalls,
    getRow: () => row,
  };
}

const SAMPLE: PredictusProcess[] = [
  { numeroProcessoUnico: '0001-2026.8.21.0001', tribunal: 'TJSP' },
];

describe('getCachedResults', () => {
  it('returns null on cache miss (no row found)', async () => {
    const { client, rpcCalls } = buildFakeClient();
    expect(await getCachedResults(client as never, 'hash-1')).toBeNull();
    expect(rpcCalls).toHaveLength(0);
  });

  it('decrypts and parses the payload on cache hit', async () => {
    const { client } = buildFakeClient({
      storedRow: {
        document_hash: 'hash-1',
        search_type: 'cpf',
        encrypted_payload: `cipher:${JSON.stringify(SAMPLE)}`,
        result_count: SAMPLE.length,
        fetched_at: '2026-05-10T12:00:00Z',
        expires_at: '2026-06-10T12:00:00Z',
      },
    });
    const result = await getCachedResults(client as never, 'hash-1');
    expect(result).not.toBeNull();
    expect(result?.results).toEqual(SAMPLE);
    expect(result?.fetchedAt).toBe('2026-05-10T12:00:00Z');
  });

  it('throws when decrypt_payload fails', async () => {
    const { client } = buildFakeClient({
      storedRow: {
        document_hash: 'hash-1',
        search_type: 'cpf',
        encrypted_payload: 'cipher:whatever',
        result_count: 0,
        fetched_at: '2026-05-10T12:00:00Z',
        expires_at: '2026-06-10T12:00:00Z',
      },
      decryptError: { message: 'vault secret missing' },
    });
    await expect(getCachedResults(client as never, 'hash-1')).rejects.toThrow(
      /vault secret missing/,
    );
  });

  it('throws when the select fails', async () => {
    const { client } = buildFakeClient({ selectError: { message: 'rls denied' } });
    await expect(getCachedResults(client as never, 'hash-1')).rejects.toThrow(/rls denied/);
  });
});

describe('setCachedResults', () => {
  it('encrypts the payload and upserts a row with TTL', async () => {
    const { client, rpcCalls, upsertCalls } = buildFakeClient();
    await setCachedResults(client as never, 'hash-2', 'cpf', SAMPLE);

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]?.name).toBe('encrypt_payload');
    expect(rpcCalls[0]?.params).toEqual({ plaintext: JSON.stringify(SAMPLE) });

    expect(upsertCalls).toHaveLength(1);
    const row = upsertCalls[0] as CacheRow;
    expect(row.document_hash).toBe('hash-2');
    expect(row.search_type).toBe('cpf');
    expect(row.encrypted_payload).toBe(`cipher:${JSON.stringify(SAMPLE)}`);
    expect(row.result_count).toBe(1);

    const fetchedAtMs = new Date(row.fetched_at).getTime();
    const expiresAtMs = new Date(row.expires_at).getTime();
    const expectedTtlMs = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
    expect(expiresAtMs - fetchedAtMs).toBe(expectedTtlMs);
  });

  it('throws when encrypt_payload fails', async () => {
    const { client } = buildFakeClient({ encryptError: { message: 'vault key missing' } });
    await expect(setCachedResults(client as never, 'hash-2', 'cpf', SAMPLE)).rejects.toThrow(
      /vault key missing/,
    );
  });

  it('throws when the upsert fails', async () => {
    const { client } = buildFakeClient({ upsertError: { message: 'duplicate violation' } });
    await expect(setCachedResults(client as never, 'hash-2', 'cpf', SAMPLE)).rejects.toThrow(
      /duplicate violation/,
    );
  });

  it('round-trips: set then get returns the same payload', async () => {
    const { client } = buildFakeClient();
    await setCachedResults(client as never, 'hash-rt', 'cnpj', SAMPLE);
    const result = await getCachedResults(client as never, 'hash-rt');
    expect(result?.results).toEqual(SAMPLE);
  });
});

function buildGraphAwareClient() {
  const rpcCalls: Array<{ name: string; params: unknown }> = [];
  return {
    rpcCalls,
    client: {
      from(table: string) {
        if (table !== 'predictus_cache') throw new Error(`unexpected table: ${table}`);
        return {
          upsert(_values: unknown) {
            return Promise.resolve({ error: null });
          },
        };
      },
      rpc(name: string, params: Record<string, unknown>) {
        rpcCalls.push({ name, params });
        if (name === 'encrypt_payload') return Promise.resolve({ data: 'cipher', error: null });
        if (name === 'encrypt_graph_label')
          return Promise.resolve({ data: '\\x6869', error: null });
        if (name === 'upsert_graph') return Promise.resolve({ data: null, error: null });
        throw new Error(`unexpected rpc: ${name}`);
      },
    },
  };
}

describe('setCachedResults — graph hook', () => {
  it('calls upsert_graph after the cache upsert when payload yields nodes', async () => {
    const { client, rpcCalls } = buildGraphAwareClient();
    const payload = [
      {
        numeroProcessoUnico: 'P-1',
        partes: [
          { tipo: 'AUTOR', nome: 'Alice', cpf: '11144477735' },
          { tipo: 'RÉU', nome: 'Beto', cpf: '52998224725' },
        ],
      },
    ];
    await setCachedResults(client as never, 'hash-x', 'cpf', payload as never);

    const names = rpcCalls.map((c) => c.name);
    expect(names).toContain('encrypt_payload');
    expect(names).toContain('encrypt_graph_label');
    expect(names).toContain('upsert_graph');
  });

  it('does not call upsert_graph when payload has no extractable partes', async () => {
    const { client, rpcCalls } = buildGraphAwareClient();
    await setCachedResults(client as never, 'hash-empty', 'cpf', []);
    expect(rpcCalls.map((c) => c.name)).not.toContain('upsert_graph');
  });

  it('swallows graph errors and lets the cache write succeed', async () => {
    const client = {
      from(_t: string) {
        return {
          upsert(_v: unknown) {
            return Promise.resolve({ error: null });
          },
        };
      },
      rpc(name: string) {
        if (name === 'encrypt_payload') return Promise.resolve({ data: 'cipher', error: null });
        return Promise.resolve({ data: null, error: { message: 'boom' } });
      },
    };
    const payload = [
      {
        numeroProcessoUnico: 'P-1',
        partes: [
          { tipo: 'AUTOR', nome: 'A', cpf: '11144477735' },
          { tipo: 'RÉU', nome: 'B', cpf: '52998224725' },
        ],
      },
    ];
    await expect(
      setCachedResults(client as never, 'h', 'cpf', payload as never),
    ).resolves.toBeUndefined();
  });
});
