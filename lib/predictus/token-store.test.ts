import { describe, expect, it } from 'vitest';
import { SupabaseTokenStore } from './token-store';

type StoredRow = { id: number; access_token: string; refreshed_at: string };

function buildFakeClient(initial?: StoredRow) {
  let row: StoredRow | null = initial ?? null;
  let nextError: { message: string } | null = null;
  const upsertCalls: Array<{ id: number; access_token: string }> = [];

  const client = {
    from(table: string) {
      if (table !== 'predictus_token') throw new Error(`unexpected table: ${table}`);
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _value: number) {
              return {
                maybeSingle: () => ({
                  returns: () =>
                    Promise.resolve({
                      data: row ? { access_token: row.access_token } : null,
                      error: null,
                    }),
                }),
              };
            },
          };
        },
        upsert(values: { id: number; access_token: string; refreshed_at?: string }) {
          upsertCalls.push({ id: values.id, access_token: values.access_token });
          if (nextError) {
            const err = nextError;
            nextError = null;
            return Promise.resolve({ error: err });
          }
          row = {
            id: values.id,
            access_token: values.access_token,
            refreshed_at: values.refreshed_at ?? new Date().toISOString(),
          };
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return {
    client,
    upsertCalls,
    failNextWith: (message: string) => {
      nextError = { message };
    },
    getRow: () => row,
  };
}

describe('SupabaseTokenStore.get', () => {
  it('returns the stored token when row exists', async () => {
    const { client } = buildFakeClient({
      id: 1,
      access_token: 'tok-abc',
      refreshed_at: '2026-01-01T00:00:00Z',
    });
    const store = new SupabaseTokenStore(client as never);
    expect(await store.get()).toBe('tok-abc');
  });

  it('returns null when no row is present', async () => {
    const { client } = buildFakeClient();
    const store = new SupabaseTokenStore(client as never);
    expect(await store.get()).toBeNull();
  });
});

describe('SupabaseTokenStore.set', () => {
  it('upserts to id=1 with the new token', async () => {
    const { client, upsertCalls } = buildFakeClient();
    const store = new SupabaseTokenStore(client as never);

    await store.set('tok-new');

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]).toEqual({ id: 1, access_token: 'tok-new' });
  });

  it('throws when the upsert fails', async () => {
    const { client, failNextWith } = buildFakeClient();
    failNextWith('rls denied');
    const store = new SupabaseTokenStore(client as never);
    await expect(store.set('tok-fail')).rejects.toThrow(/rls denied/);
  });

  it('round-trips a token: set then get returns the same value', async () => {
    const { client } = buildFakeClient();
    const store = new SupabaseTokenStore(client as never);
    await store.set('round-trip');
    expect(await store.get()).toBe('round-trip');
  });
});
