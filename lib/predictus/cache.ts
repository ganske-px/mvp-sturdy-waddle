import { decryptText, encryptText } from '@/lib/crypto/vault.ts';
import { extractGraph } from '@/lib/graph/extractor.ts';
import { upsertGraph } from '@/lib/graph/writer.ts';
import type { Database } from '@/lib/supabase/types.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PredictusProcess, PredictusSearchType } from './types.ts';

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

  const plaintext = await decryptText(client, data.encrypted_payload);
  return {
    results: JSON.parse(plaintext) as PredictusProcess[],
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
  const ciphertext = await encryptText(client, JSON.stringify(results));

  const now = new Date();
  const expiresAt = new Date(now.getTime() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const { error } = await client.from('predictus_cache').upsert({
    document_hash: documentHash,
    search_type: searchType,
    encrypted_payload: ciphertext,
    result_count: results.length,
    fetched_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  } as never);
  if (error) {
    throw new Error(`cache.setCachedResults failed: ${error.message}`);
  }

  try {
    const { nodes, edges } = extractGraph({ payload: results, searchedHash: documentHash });
    if (nodes.length > 0) {
      await upsertGraph(client, nodes, edges);
    }
  } catch (e) {
    console.warn('graph upsert failed; cache write succeeded:', e);
  }
}
