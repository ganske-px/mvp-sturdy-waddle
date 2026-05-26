import { describe, expect, it } from 'vitest';
import { NETRIN_CACHE_TTL_DAYS, getNetrinCache, setNetrinCache } from './cache';
import type { NetrinCompositePayload } from './types';

function fakeClient(opts: {
  selectRow?: { encrypted_payload: string; slugs_fetched: string[]; fetched_at: string } | null;
  encryptReturns?: string;
  upsertSpy?: (row: unknown) => void;
}) {
  return {
    from(table: string) {
      if (table !== 'netrin_cache') throw new Error(`unexpected from(${table})`);
      return {
        select() {
          return {
            eq() {
              return {
                gt() {
                  return {
                    maybeSingle() {
                      return {
                        returns<T>() {
                          return Promise.resolve({ data: opts.selectRow as T | null, error: null });
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
        upsert(row: unknown) {
          opts.upsertSpy?.(row);
          return Promise.resolve({ error: null });
        },
      };
    },
    rpc(name: string, args: { plaintext?: string; ciphertext?: string }) {
      if (name === 'encrypt_netrin')
        return Promise.resolve({
          data: opts.encryptReturns ?? `enc(${args.plaintext})`,
          error: null,
        });
      if (name === 'decrypt_netrin')
        return Promise.resolve({
          data: (args.ciphertext ?? '').replace(/^enc\(/, '').replace(/\)$/, ''),
          error: null,
        });
      throw new Error(`unexpected rpc ${name}`);
    },
  } as never;
}

describe('netrin cache', () => {
  it('returns null on cache miss', async () => {
    const client = fakeClient({ selectRow: null });
    const result = await getNetrinCache(client, 'cpf:abc');
    expect(result).toBeNull();
  });

  it('decrypts payload on hit', async () => {
    const payload: NetrinCompositePayload = { 'esp-cpf': { ok: true } };
    const client = fakeClient({
      selectRow: {
        encrypted_payload: `enc(${JSON.stringify(payload)})`,
        slugs_fetched: ['esp-cpf'],
        fetched_at: '2026-05-26T00:00:00Z',
      },
    });
    const result = await getNetrinCache(client, 'cpf:abc');
    expect(result).not.toBeNull();
    expect(result?.payload).toEqual(payload);
    expect(result?.slugsFetched).toEqual(['esp-cpf']);
    expect(result?.fetchedAt).toBe('2026-05-26T00:00:00Z');
  });

  it('encrypts and upserts on set', async () => {
    let captured: {
      document_hash?: string;
      encrypted_payload?: string;
      slugs_fetched?: string[];
      expires_at?: string;
    } = {};
    const client = fakeClient({
      upsertSpy: (row) => {
        captured = row as typeof captured;
      },
    });
    const payload: NetrinCompositePayload = { 'esp-cpf': { ok: true } };

    await setNetrinCache(client, 'cpf:abc', 'cpf', ['esp-cpf'], payload);

    expect(captured.document_hash).toBe('cpf:abc');
    expect(captured.encrypted_payload).toContain('esp-cpf');
    expect(captured.slugs_fetched).toEqual(['esp-cpf']);
    expect(new Date(captured.expires_at as string).getTime()).toBeGreaterThan(
      Date.now() + (NETRIN_CACHE_TTL_DAYS - 1) * 86400000,
    );
  });
});
