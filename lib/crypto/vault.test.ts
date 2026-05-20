import { describe, expect, it } from 'vitest';
import { decryptText, encryptText } from './vault';

function buildClient(opts: {
  encryptResult?: { data: unknown; error: { message: string } | null };
  decryptResult?: { data: unknown; error: { message: string } | null };
}) {
  const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const client = {
    rpc(name: string, params: Record<string, unknown>) {
      rpcCalls.push({ name, params });
      if (name === 'encrypt_payload') {
        return Promise.resolve(opts.encryptResult ?? { data: null, error: null });
      }
      if (name === 'decrypt_payload') {
        return Promise.resolve(opts.decryptResult ?? { data: null, error: null });
      }
      throw new Error(`unexpected rpc: ${name}`);
    },
  };
  return { client, rpcCalls };
}

describe('encryptText', () => {
  it('calls encrypt_payload with the plaintext and returns the ciphertext', async () => {
    const { client, rpcCalls } = buildClient({
      encryptResult: { data: 'ciphertext-base64', error: null },
    });
    const result = await encryptText(client as never, 'hello');
    expect(result).toBe('ciphertext-base64');
    expect(rpcCalls).toEqual([{ name: 'encrypt_payload', params: { plaintext: 'hello' } }]);
  });

  it('throws when the RPC returns an error', async () => {
    const { client } = buildClient({
      encryptResult: { data: null, error: { message: 'vault secret missing' } },
    });
    await expect(encryptText(client as never, 'hello')).rejects.toThrow(/vault secret missing/);
  });

  it('throws when the RPC returns a non-string payload', async () => {
    const { client } = buildClient({
      encryptResult: { data: 42, error: null },
    });
    await expect(encryptText(client as never, 'hello')).rejects.toThrow(/non-string/);
  });
});

describe('decryptText', () => {
  it('calls decrypt_payload with the ciphertext and returns the plaintext', async () => {
    const { client, rpcCalls } = buildClient({
      decryptResult: { data: 'plain', error: null },
    });
    const result = await decryptText(client as never, 'ciphertext-base64');
    expect(result).toBe('plain');
    expect(rpcCalls).toEqual([
      { name: 'decrypt_payload', params: { ciphertext: 'ciphertext-base64' } },
    ]);
  });

  it('throws when the RPC returns an error', async () => {
    const { client } = buildClient({
      decryptResult: { data: null, error: { message: 'bad ciphertext' } },
    });
    await expect(decryptText(client as never, 'bad')).rejects.toThrow(/bad ciphertext/);
  });

  it('throws when the RPC returns a non-string payload', async () => {
    const { client } = buildClient({
      decryptResult: { data: null, error: null },
    });
    await expect(decryptText(client as never, 'whatever')).rejects.toThrow(/non-string/);
  });
});
