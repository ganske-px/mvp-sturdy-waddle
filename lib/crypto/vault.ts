import type { Database } from '@/lib/supabase/types.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Encrypts plaintext via the `encrypt_payload` Postgres function, which
 * pulls a 32-byte key from `vault.decrypted_secrets` and applies
 * `pgp_sym_encrypt`. The returned ciphertext is the bytea encoded as a
 * base64-ish string by Supabase JS — opaque to callers; only feed it back
 * through `decryptText`.
 *
 * Requires the service-role client (the function is `SECURITY DEFINER`
 * and only granted to service_role).
 */
export async function encryptText(
  client: SupabaseClient<Database>,
  plaintext: string,
): Promise<string> {
  const { data, error } = await client.rpc(
    'encrypt_payload' as never,
    {
      plaintext,
    } as never,
  );
  if (error) {
    throw new Error(`encryptText failed: ${error.message}`);
  }
  if (typeof data !== 'string') {
    throw new Error('encryptText returned a non-string ciphertext');
  }
  return data;
}

export async function decryptText(
  client: SupabaseClient<Database>,
  ciphertext: string,
): Promise<string> {
  const { data, error } = await client.rpc(
    'decrypt_payload' as never,
    {
      ciphertext,
    } as never,
  );
  if (error) {
    throw new Error(`decryptText failed: ${error.message}`);
  }
  if (typeof data !== 'string') {
    throw new Error('decryptText returned a non-string plaintext');
  }
  return data;
}

/**
 * Encrypts plaintext via the `encrypt_netrin` Postgres function, which uses
 * the `netrin_cache_key` Vault secret. Mirror of `encryptText` for the
 * Netrin cache table — kept separate so Netrin and Predictus keys are
 * independently rotatable.
 */
export async function encryptNetrinText(
  client: SupabaseClient<Database>,
  plaintext: string,
): Promise<string> {
  const { data, error } = await client.rpc('encrypt_netrin' as never, { plaintext } as never);
  if (error) throw new Error(`encrypt_netrin RPC failed: ${error.message}`);
  if (typeof data !== 'string') throw new Error('encrypt_netrin returned non-string');
  return data;
}

export async function decryptNetrinText(
  client: SupabaseClient<Database>,
  ciphertext: string,
): Promise<string> {
  const { data, error } = await client.rpc('decrypt_netrin' as never, { ciphertext } as never);
  if (error) throw new Error(`decrypt_netrin RPC failed: ${error.message}`);
  if (typeof data !== 'string') throw new Error('decrypt_netrin returned non-string');
  return data;
}
