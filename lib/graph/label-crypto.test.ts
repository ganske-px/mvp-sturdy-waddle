import { describe, expect, it } from 'vitest';
import { decryptLabel, decryptLabels, encryptLabel } from './label-crypto';

function buildFakeClient(
  opts: {
    encryptError?: string;
    decryptError?: string;
    decryptLabelsError?: string;
    decryptLabelsResult?: string[];
  } = {},
) {
  const calls: Array<{ name: string; params: unknown }> = [];
  return {
    calls,
    client: {
      rpc(name: string, params: Record<string, unknown>) {
        calls.push({ name, params });
        if (name === 'encrypt_graph_label') {
          if (opts.encryptError) {
            return Promise.resolve({ data: null, error: { message: opts.encryptError } });
          }
          return Promise.resolve({ data: `cipher:${params.plaintext}`, error: null });
        }
        if (name === 'decrypt_graph_label') {
          if (opts.decryptError) {
            return Promise.resolve({ data: null, error: { message: opts.decryptError } });
          }
          return Promise.resolve({
            data: String(params.ciphertext).replace(/^cipher:/, ''),
            error: null,
          });
        }
        if (name === 'decrypt_graph_labels') {
          if (opts.decryptLabelsError) {
            return Promise.resolve({ data: null, error: { message: opts.decryptLabelsError } });
          }
          const ciphertexts = params.ciphertexts as string[];
          const result =
            opts.decryptLabelsResult ?? ciphertexts.map((c) => c.replace(/^cipher:/, ''));
          return Promise.resolve({ data: result, error: null });
        }
        throw new Error(`unexpected rpc: ${name}`);
      },
    },
  };
}

describe('encryptLabel', () => {
  it('calls encrypt_graph_label and returns ciphertext', async () => {
    const { client, calls } = buildFakeClient();
    const result = await encryptLabel(client as never, '{"name":"X"}');
    expect(result).toBe('cipher:{"name":"X"}');
    expect(calls).toEqual([{ name: 'encrypt_graph_label', params: { plaintext: '{"name":"X"}' } }]);
  });

  it('throws when the RPC fails', async () => {
    const { client } = buildFakeClient({ encryptError: 'vault key missing' });
    await expect(encryptLabel(client as never, 'x')).rejects.toThrow(/vault key missing/);
  });
});

describe('decryptLabel', () => {
  it('calls decrypt_graph_label and returns plaintext', async () => {
    const { client } = buildFakeClient();
    const result = await decryptLabel(client as never, 'cipher:{"name":"Y"}');
    expect(result).toBe('{"name":"Y"}');
  });

  it('throws when the RPC fails', async () => {
    const { client } = buildFakeClient({ decryptError: 'no secret' });
    await expect(decryptLabel(client as never, 'whatever')).rejects.toThrow(/no secret/);
  });
});

describe('decryptLabels', () => {
  it('returns [] for empty input without calling rpc', async () => {
    const { client, calls } = buildFakeClient();
    const result = await decryptLabels(client as never, []);
    expect(result).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('calls decrypt_graph_labels and returns plaintext array in order', async () => {
    const { client, calls } = buildFakeClient();
    const ciphertexts = ['cipher:{"name":"A"}', 'cipher:{"name":"B"}', 'cipher:{"name":"C"}'];
    const result = await decryptLabels(client as never, ciphertexts);
    expect(result).toEqual(['{"name":"A"}', '{"name":"B"}', '{"name":"C"}']);
    expect(calls).toEqual([{ name: 'decrypt_graph_labels', params: { ciphertexts } }]);
  });

  it('throws an error starting with "decryptLabels failed:" when rpc returns error', async () => {
    const { client } = buildFakeClient({ decryptLabelsError: 'vault key missing' });
    await expect(decryptLabels(client as never, ['cipher:x'])).rejects.toThrow(
      /^decryptLabels failed:/,
    );
  });
});
