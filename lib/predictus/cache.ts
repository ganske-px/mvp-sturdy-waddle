import type { Database } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PredictusProcess, PredictusSearchType } from './types';

export const CACHE_TTL_DAYS = 30;

export type CachedResult = {
  results: PredictusProcess[];
  fetchedAt: string;
};

type CacheSelectRow = {
  encrypted_payload: string;
  fetched_at: string;
};

/**
 * Fetches a still-fresh cache row for the given document_hash and decrypts
 * the payload via the `decrypt_payload` RPC. Returns null on cache miss.
 *
 * Requires a Supabase client with read access to `predictus_cache` (any
 * authenticated user) and execute permission on `decrypt_payload`
 * (service_role only — pass the admin client).
 */
export async function getCachedResults(
  client: SupabaseClient<Database>,
  documentHash: string,
): Promise<CachedResult | null> {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from('predictus_cache')
    .select('encrypted_payload, fetched_at')
    .eq('document_hash', documentHash)
    .gt('expires_at', now)
    .maybeSingle()
    .returns<CacheSelectRow>();
  if (error) {
    throw new Error(`cache.getCachedResults failed: ${error.message}`);
  }
  if (!data) return null;

  const { data: decrypted, error: decryptError } = await client.rpc(
    'decrypt_payload' as never,
    {
      ciphertext: data.encrypted_payload,
    } as never,
  );
  if (decryptError) {
    throw new Error(`cache.decrypt failed: ${decryptError.message}`);
  }
  if (typeof decrypted !== 'string') {
    throw new Error('cache.decrypt returned a non-string payload');
  }
  return {
    results: JSON.parse(decrypted) as PredictusProcess[],
    fetchedAt: data.fetched_at,
  };
}

/**
 * Encrypts the results via the `encrypt_payload` RPC and upserts a row in
 * `predictus_cache` with a 30-day TTL. Caller is responsible for passing
 * the service-role client.
 */
export async function setCachedResults(
  client: SupabaseClient<Database>,
  documentHash: string,
  searchType: PredictusSearchType,
  results: PredictusProcess[],
): Promise<void> {
  const { data: encrypted, error: encryptError } = await client.rpc(
    'encrypt_payload' as never,
    {
      plaintext: JSON.stringify(results),
    } as never,
  );
  if (encryptError) {
    throw new Error(`cache.encrypt failed: ${encryptError.message}`);
  }
  if (typeof encrypted !== 'string') {
    throw new Error('cache.encrypt returned a non-string ciphertext');
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const { error } = await client.from('predictus_cache').upsert({
    document_hash: documentHash,
    search_type: searchType,
    encrypted_payload: encrypted,
    result_count: results.length,
    fetched_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  } as never);
  if (error) {
    throw new Error(`cache.setCachedResults failed: ${error.message}`);
  }
}
