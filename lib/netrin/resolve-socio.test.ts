import { hashDocument } from '@/lib/hash';
import { describe, expect, it } from 'vitest';
import { resolveSocioCpf } from './resolve-socio';

function makeAdmin(opts: {
  row?: { encrypted_payload: string } | null;
  error?: { message: string };
  decryptedJson?: string;
  decryptFails?: boolean;
}) {
  return {
    from(table: string) {
      if (table !== 'netrin_cache') throw new Error(`unexpected from(${table})`);
      return {
        select: () => ({
          eq: () => ({
            gt: () => ({
              maybeSingle: () => ({
                returns<T>() {
                  return Promise.resolve({
                    data: (opts.row ?? null) as T | null,
                    error: opts.error ?? null,
                  });
                },
              }),
            }),
          }),
        }),
      };
    },
    rpc(name: string, _args: unknown) {
      if (name !== 'decrypt_netrin') throw new Error(`unexpected rpc ${name}`);
      if (opts.decryptFails) {
        return Promise.resolve({ data: null, error: { message: 'boom' } });
      }
      return Promise.resolve({ data: opts.decryptedJson ?? '{}', error: null });
    },
  } as never;
}

describe('resolveSocioCpf', () => {
  it('returns null when parent cache row not found', async () => {
    const result = await resolveSocioCpf(makeAdmin({ row: null }), {
      parentCnpjHash: 'cnpj:nope',
      cpfHash: 'cpf:nope',
    });
    expect(result).toBeNull();
  });

  it('returns null when DB query errors', async () => {
    const result = await resolveSocioCpf(makeAdmin({ error: { message: 'db down' } }), {
      parentCnpjHash: 'cnpj:x',
      cpfHash: 'cpf:x',
    });
    expect(result).toBeNull();
  });

  it('returns null when decrypt fails', async () => {
    const result = await resolveSocioCpf(
      makeAdmin({
        row: { encrypted_payload: 'ciphertext' },
        decryptFails: true,
      }),
      { parentCnpjHash: 'cnpj:x', cpfHash: 'cpf:x' },
    );
    expect(result).toBeNull();
  });

  it('returns raw CPF when payload contains a CPF whose hash matches', async () => {
    const targetCpf = '11111111111';
    const payload = {
      'pessoas-relacionadas-cnpj': {
        entidadesRelacionadas: [
          { cpf: '22222222222', nome: 'OTHER' },
          { cpf: targetCpf, nome: 'TARGET' },
        ],
      },
    };
    const expectedHash = hashDocument('cpf', targetCpf);
    const result = await resolveSocioCpf(
      makeAdmin({
        row: { encrypted_payload: 'ct' },
        decryptedJson: JSON.stringify(payload),
      }),
      { parentCnpjHash: 'cnpj:x', cpfHash: expectedHash },
    );
    expect(result).toBe(targetCpf);
  });

  it('returns null when no CPF in payload matches the target hash', async () => {
    const payload = {
      'pessoas-relacionadas-cnpj': {
        entidadesRelacionadas: [{ cpf: '22222222222' }, { cpf: '33333333333' }],
      },
    };
    const result = await resolveSocioCpf(
      makeAdmin({
        row: { encrypted_payload: 'ct' },
        decryptedJson: JSON.stringify(payload),
      }),
      { parentCnpjHash: 'cnpj:x', cpfHash: 'cpf:unmatched-hash-value' },
    );
    expect(result).toBeNull();
  });

  it('skips malformed CPFs (length != 11)', async () => {
    const payload = {
      'pessoas-relacionadas-cnpj': {
        entidadesRelacionadas: [
          { cpf: '123' }, // invalid length
          { cpf: 'not-a-string' },
          { cpf: '11111111111' },
        ],
      },
    };
    const expectedHash = hashDocument('cpf', '11111111111');
    const result = await resolveSocioCpf(
      makeAdmin({
        row: { encrypted_payload: 'ct' },
        decryptedJson: JSON.stringify(payload),
      }),
      { parentCnpjHash: 'cnpj:x', cpfHash: expectedHash },
    );
    expect(result).toBe('11111111111');
  });
});
