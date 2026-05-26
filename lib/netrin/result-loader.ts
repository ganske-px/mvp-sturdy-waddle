// lib/netrin/result-loader.ts
//
// Server-side loader for the enrichment section on the search result page.
// Fetches the latest enrichment job for a given root document hash, all
// associated calls, then bulk-fetches netrin_cache rows and decrypts them.
// Designed to be called from a Next.js Server Component (no browser APIs).

import { decryptNetrinText } from '@/lib/crypto/vault';
import type { Database } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractPivotCnpjs } from './parsers/pivot-cnpjs';
import type { NetrinCompositePayload, NetrinDocumentType } from './types';

// ── Row shapes ──────────────────────────────────────────────────────────────

export type LoadedJob = {
  id: string;
  userId: string;
  rootHash: string;
  rootType: 'cpf' | 'cnpj';
  status: 'pending' | 'running' | 'completed' | 'partial' | 'failed';
  hop1Status: 'success' | 'error' | 'cache_hit' | 'skipped' | null;
  hop2Total: number;
  hop2Done: number;
  hop3Total: number;
  hop3Done: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};

export type LoadedCall = {
  id: string;
  hop: 1 | 2 | 3;
  documentHash: string;
  documentType: 'cpf' | 'cnpj';
  status: 'pending' | 'running' | 'success' | 'error' | 'cache_hit';
  cached: boolean;
  fetchedAt: string | null;
  error: string | null;
};

// ── Decrypted payload container ─────────────────────────────────────────────

export type LoadedPayloads = {
  /** Hop-1 payload: always the root CPF (or CNPJ when rootType === 'cnpj'). */
  hop1: NetrinCompositePayload | null;
  /** Hop-2 payloads keyed by document_hash (CNPJ companies related to the CPF). */
  byCnpj: Record<string, NetrinCompositePayload>;
  /** Hop-3 payloads keyed by document_hash (CPFs related to each CNPJ). */
  byCpf: Record<string, NetrinCompositePayload>;
};

// ── Internal DB row types ─────────────────────────────────────────────────

type JobRow = {
  id: string;
  user_id: string;
  root_hash: string;
  root_type: 'cpf' | 'cnpj';
  status: 'pending' | 'running' | 'completed' | 'partial' | 'failed';
  hop1_status: 'success' | 'error' | 'cache_hit' | 'skipped' | null;
  hop2_total: number;
  hop2_done: number;
  hop3_total: number;
  hop3_done: number;
  started_at: string;
  finished_at: string | null;
  error: string | null;
};

type CallRow = {
  id: string;
  hop: 1 | 2 | 3;
  document_hash: string;
  document_type: 'cpf' | 'cnpj';
  status: 'pending' | 'running' | 'success' | 'error' | 'cache_hit';
  cached: boolean;
  fetched_at: string | null;
  error: string | null;
};

type CacheRow = {
  document_hash: string;
  document_type: NetrinDocumentType;
  encrypted_payload: string;
};

// ── Loader ───────────────────────────────────────────────────────────────────

export type LoadEnrichmentInput = {
  userId: string;
  rootHash: string;
  rootType: 'cpf' | 'cnpj';
};

export type LoadEnrichmentResult = {
  job: LoadedJob;
  calls: LoadedCall[];
  payloads: LoadedPayloads;
} | null;

/**
 * Fetches the latest enrichment job for `rootHash`, all its calls, then
 * decrypts the corresponding `netrin_cache` rows.
 *
 * Returns `null` when no enrichment job has been created for this hash yet.
 * Never throws on decryption errors — failures are logged as warnings and the
 * affected payload is omitted.
 */
export async function loadEnrichmentForRoot(
  admin: SupabaseClient<Database>,
  input: LoadEnrichmentInput,
): Promise<LoadEnrichmentResult> {
  // 1. Latest job for the root document (any status)
  const { data: jobRow, error: jobError } = await admin
    .from('enrichment_jobs')
    .select(
      'id, user_id, root_hash, root_type, status, hop1_status, hop2_total, hop2_done, hop3_total, hop3_done, started_at, finished_at, error',
    )
    .eq('root_hash', input.rootHash)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
    .returns<JobRow>();

  if (jobError) {
    console.warn('loadEnrichmentForRoot: job query failed', jobError.message);
    return null;
  }
  if (!jobRow) return null;

  const job: LoadedJob = {
    id: jobRow.id,
    userId: jobRow.user_id,
    rootHash: jobRow.root_hash,
    rootType: jobRow.root_type,
    status: jobRow.status,
    hop1Status: jobRow.hop1_status,
    hop2Total: jobRow.hop2_total,
    hop2Done: jobRow.hop2_done,
    hop3Total: jobRow.hop3_total,
    hop3Done: jobRow.hop3_done,
    startedAt: jobRow.started_at,
    finishedAt: jobRow.finished_at,
    error: jobRow.error,
  };

  // 2. All calls for this job
  const { data: callRows, error: callsError } = await admin
    .from('enrichment_job_calls')
    .select('id, hop, document_hash, document_type, status, cached, fetched_at, error')
    .eq('job_id', job.id)
    .order('hop', { ascending: true })
    .returns<CallRow[]>();

  if (callsError) {
    console.warn('loadEnrichmentForRoot: calls query failed', callsError.message);
  }

  const calls: LoadedCall[] = (callRows ?? []).map((r) => ({
    id: r.id,
    hop: r.hop,
    documentHash: r.document_hash,
    documentType: r.document_type,
    status: r.status,
    cached: r.cached,
    fetchedAt: r.fetched_at,
    error: r.error,
  }));

  // 3. Collect unique document hashes that have a non-error call result
  const successStatuses = new Set<string>(['success', 'cache_hit']);
  const uniqueHashes = [
    ...new Set(
      (callRows ?? []).filter((c) => successStatuses.has(c.status)).map((c) => c.document_hash),
    ),
  ];

  const payloads: LoadedPayloads = { hop1: null, byCnpj: {}, byCpf: {} };

  if (uniqueHashes.length === 0) {
    return { job, calls, payloads };
  }

  // 4. Bulk-fetch netrin_cache rows for those hashes
  const now = new Date().toISOString();
  const { data: cacheRows, error: cacheError } = await admin
    .from('netrin_cache')
    .select('document_hash, document_type, encrypted_payload')
    .in('document_hash', uniqueHashes)
    .gt('expires_at', now)
    .returns<CacheRow[]>();

  if (cacheError) {
    console.warn('loadEnrichmentForRoot: cache query failed', cacheError.message);
    return { job, calls, payloads };
  }

  // 5. Build a lookup: document_hash → call row (to know hop)
  const hashToCall = new Map<string, CallRow>();
  for (const c of callRows ?? []) {
    // prefer the earliest hop if duplicated
    if (!hashToCall.has(c.document_hash)) hashToCall.set(c.document_hash, c);
  }

  // 6. Decrypt each cache row and route into hop1 / byCnpj / byCpf
  await Promise.all(
    (cacheRows ?? []).map(async (row) => {
      let parsed: NetrinCompositePayload;
      try {
        const plaintext = await decryptNetrinText(admin, row.encrypted_payload);
        parsed = JSON.parse(plaintext) as NetrinCompositePayload;
      } catch (e) {
        console.warn(
          'loadEnrichmentForRoot: decrypt failed for hash',
          row.document_hash.slice(0, 8),
          e,
        );
        return;
      }

      const call = hashToCall.get(row.document_hash);
      const hop = call?.hop ?? 99;

      if (hop === 1) {
        // Hop-1 is always the root document
        payloads.hop1 = parsed;
      } else if (hop === 2 || row.document_type === 'cnpj') {
        payloads.byCnpj[row.document_hash] = parsed;
      } else {
        // hop === 3 or cpf
        payloads.byCpf[row.document_hash] = parsed;
      }
    }),
  );

  return { job, calls, payloads };
}

// ── Helper re-export ─────────────────────────────────────────────────────────

/**
 * Re-exports `extractPivotCnpjs` under a name that's idiomatic at the page
 * layer — given the hop-1 payload, returns the raw 14-digit CNPJ strings of
 * all related companies.
 */
export function pivotCnpjsFromHop1(payload: NetrinCompositePayload): string[] {
  return extractPivotCnpjs(payload);
}
