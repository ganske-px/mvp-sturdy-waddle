import { decryptNetrinText, encryptNetrinText } from '@/lib/crypto/vault';
import type { Database } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NetrinCompositePayload, NetrinDocumentType } from './types';

export const NETRIN_CACHE_TTL_DAYS = 30;

export type NetrinCacheHit = {
  payload: NetrinCompositePayload;
  slugsFetched: string[];
  fetchedAt: string;
};

type SelectRow = {
  encrypted_payload: string;
  slugs_fetched: string[];
  fetched_at: string;
};

export async function getNetrinCache(
  client: SupabaseClient<Database>,
  documentHash: string,
): Promise<NetrinCacheHit | null> {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from('netrin_cache')
    .select('encrypted_payload, slugs_fetched, fetched_at')
    .eq('document_hash', documentHash)
    .gt('expires_at', now)
    .maybeSingle()
    .returns<SelectRow>();
  if (error) throw new Error(`getNetrinCache failed: ${error.message}`);
  if (!data) return null;

  const plaintext = await decryptNetrinText(client, data.encrypted_payload);
  return {
    payload: JSON.parse(plaintext) as NetrinCompositePayload,
    slugsFetched: data.slugs_fetched,
    fetchedAt: data.fetched_at,
  };
}

export async function setNetrinCache(
  client: SupabaseClient<Database>,
  documentHash: string,
  documentType: NetrinDocumentType,
  slugsFetched: string[],
  payload: NetrinCompositePayload,
): Promise<void> {
  const ciphertext = await encryptNetrinText(client, JSON.stringify(payload));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + NETRIN_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const { error } = await client.from('netrin_cache').upsert({
    document_hash: documentHash,
    document_type: documentType,
    encrypted_payload: ciphertext,
    slugs_fetched: slugsFetched,
    fetched_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  } as never);
  if (error) throw new Error(`setNetrinCache failed: ${error.message}`);
}
