import type { AuditEvent } from '@/lib/audit.ts';
import type { CachedResult } from '@/lib/predictus/cache.ts';
import type { PredictusClient } from '@/lib/predictus/client.ts';
import type { PredictusProcess, PredictusSearchType } from '@/lib/predictus/types.ts';
import type { Database } from '@/lib/supabase/types.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BulkItemRow, ItemOutcome } from './job-store.ts';

/**
 * Combines cache lookup, Predictus call, cache write and audit log for a
 * single bulk item. Pure with respect to side effects — the cache, audit and
 * Predictus access are all injected.
 */
export type ItemProcessorDeps = {
  admin: SupabaseClient<Database>;
  predictus: Pick<PredictusClient, 'searchByCpf' | 'searchByCnpj'>;
  audit: (
    event: AuditEvent,
    client: SupabaseClient<Database>,
    options?: { allowFailure?: boolean },
  ) => Promise<void>;
  getCachedResults: (
    client: SupabaseClient<Database>,
    documentHash: string,
  ) => Promise<CachedResult | null>;
  setCachedResults: (
    client: SupabaseClient<Database>,
    documentHash: string,
    searchType: PredictusSearchType,
    results: PredictusProcess[],
  ) => Promise<void>;
  /**
   * Decrypts `bulk_job_items.document_encrypted` so the raw CPF/CNPJ can be
   * passed to Predictus. Plaintext lives only on the stack of this function.
   */
  decryptDocument: (ciphertext: string) => Promise<string>;
  /**
   * Dispara o job de enrichment (Netrin) em paralelo, reusando o ciphertext já
   * armazenado em `bulk_job_items.document_encrypted` (cifrado via
   * predictus_cache_key — mesma chave que `findOrCreateJob` espera). Opcional:
   * quando ausente, o bulk segue só com Predictus (comportamento legado).
   */
  dispatchEnrichment?: (input: {
    userId: string;
    rootHash: string;
    rootType: 'cpf' | 'cnpj';
    documentEncrypted: string;
  }) => Promise<void>;
  userId: string;
  ip?: string;
  userAgent?: string;
};

export async function processBulkItem(
  item: BulkItemRow,
  deps: ItemProcessorDeps,
): Promise<ItemOutcome> {
  if (deps.dispatchEnrichment) {
    try {
      await deps.dispatchEnrichment({
        userId: deps.userId,
        rootHash: item.document_hash,
        rootType: item.document_type,
        documentEncrypted: item.document_encrypted,
      });
    } catch (e) {
      console.warn('bulk item enrichment dispatch failed:', e);
    }
  }

  // Cache lookup. Failures don't block the call — we just miss the cache.
  let cached: CachedResult | null = null;
  let cacheLookupFailed = false;
  try {
    cached = await deps.getCachedResults(deps.admin, item.document_hash);
  } catch (e) {
    cacheLookupFailed = true;
    console.warn('bulk item cache lookup failed, falling through:', e);
  }

  // One audit row per item with the determined cache state. Fires before the
  // Predictus call so the trail records the attempt even if Predictus throws.
  await deps.audit(
    {
      userId: deps.userId,
      action: 'search_bulk_item',
      searchType: item.document_type,
      documentHash: item.document_hash,
      ip: deps.ip,
      userAgent: deps.userAgent,
      metadata: {
        job_id: item.job_id,
        item_id: item.id,
        cached: cached !== null,
        ...(cacheLookupFailed ? { cache_lookup_failed: true } : {}),
      },
    },
    deps.admin,
    { allowFailure: true },
  );

  if (cached) {
    return cached.results.length > 0
      ? { kind: 'found', resultCount: cached.results.length }
      : { kind: 'clean', resultCount: 0 };
  }

  // Cache miss — decrypt the stored document, then hit Predictus.
  let results: PredictusProcess[];
  try {
    const documentRaw = await deps.decryptDocument(item.document_encrypted);
    results =
      item.document_type === 'cpf'
        ? await deps.predictus.searchByCpf(documentRaw)
        : await deps.predictus.searchByCnpj(documentRaw);
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : String(e),
    };
  }

  // Best-effort cache write.
  try {
    await deps.setCachedResults(deps.admin, item.document_hash, item.document_type, results);
  } catch (e) {
    console.warn('bulk item cache write failed:', e);
  }

  return results.length > 0
    ? { kind: 'found', resultCount: results.length }
    : { kind: 'clean', resultCount: 0 };
}
