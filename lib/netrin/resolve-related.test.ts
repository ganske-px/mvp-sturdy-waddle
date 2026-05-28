import { hashDocument } from '@/lib/hash';
import { describe, expect, it } from 'vitest';
import { resolveRelatedCpf } from './resolve-related';

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

describe('resolveRelatedCpf', () => {
  it('returns null when parent cache row not found', async () => {
    const result = await resolveRelatedCpf(makeAdmin({ row: null }), {
      parentCpfHash: 'cpf:nope',
      cpfHash: 'cpf:nope',
    });
    expect(result).toBeNull();
  });

  it('returns null when DB query errors', async () => {
    const result = await resolveRelatedCpf(makeAdmin({ error: { message: 'db down' } }), {
      parentCpfHash: 'cpf:x',
      cpfHash: 'cpf:x',
    });
    expect(result).toBeNull();
  });

  it('returns null when decrypt fails', async () => {
    const result = await resolveRelatedCpf(
      makeAdmin({ row: { encrypted_payload: 'ciphertext' }, decryptFails: true }),
      { parentCpfHash: 'cpf:x', cpfHash: 'cpf:x' },
    );
    expect(result).toBeNull();
  });

  it('returns raw CPF when a related person hash matches', async () => {
    const targetCpf = '02264486732';
    const payload = {
      pessoasRelacionadasCPF: {
        entidadesRelacionadas: [
          {
            entidadeRelacionadaDocumento: '06917562793',
            entidadeRelacionadadaTipoDeDocumento: 'CPF',
          },
          {
            entidadeRelacionadaDocumento: '022.644.867-32',
            entidadeRelacionadadaTipoDeDocumento: 'CPF',
            tipoDeRelacionamento: 'MOTHER',
          },
        ],
      },
    };
    const expectedHash = hashDocument('cpf', targetCpf);
    const result = await resolveRelatedCpf(
      makeAdmin({ row: { encrypted_payload: 'ct' }, decryptedJson: JSON.stringify(payload) }),
      { parentCpfHash: 'cpf:root', cpfHash: expectedHash },
    );
    expect(result).toBe(targetCpf);
  });

  it('returns null when no related CPF matches the target hash', async () => {
    const payload = {
      pessoasRelacionadasCPF: {
        entidadesRelacionadas: [
          {
            entidadeRelacionadaDocumento: '06917562793',
            entidadeRelacionadadaTipoDeDocumento: 'CPF',
          },
        ],
      },
    };
    const result = await resolveRelatedCpf(
      makeAdmin({ row: { encrypted_payload: 'ct' }, decryptedJson: JSON.stringify(payload) }),
      { parentCpfHash: 'cpf:root', cpfHash: 'cpf:unmatched' },
    );
    expect(result).toBeNull();
  });
});
