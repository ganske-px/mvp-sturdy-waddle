// Supabase Edge Function — runs in Deno.
//
// Triggered by the createBulkJobAction Server Action after a job is created.
// Processes pending items in `bulk_job_items` through the same TS modules
// exercised by Vitest under Node, then returns 202 while the background
// task continues via EdgeRuntime.waitUntil.

import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';
import { writeAuditLog } from '../../../lib/audit.ts';
import { processBulkItem } from '../../../lib/bulk/item-processor.ts';
import {
  getPendingItems,
  recordItemResult,
  refreshJobCounters,
  setJobStatus,
} from '../../../lib/bulk/job-store.ts';
import { processBulkJob } from '../../../lib/bulk/processor.ts';
import { decryptText } from '../../../lib/crypto/vault.ts';
import { findOrCreateJob } from '../../../lib/netrin/job-store.ts';
import { getCachedResults, setCachedResults } from '../../../lib/predictus/cache.ts';
import { PredictusClient } from '../../../lib/predictus/client.ts';
import { SupabaseTokenStore } from '../../../lib/predictus/token-store.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

type RequestBody = { jobId?: unknown };

const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'PREDICTUS_BASE_URL',
  'PREDICTUS_USERNAME',
  'PREDICTUS_PASSWORD',
] as const;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405);

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }
  if (typeof body.jobId !== 'string' || !body.jobId) {
    return jsonResponse({ error: 'missing jobId' }, 400);
  }
  const jobId = body.jobId;

  const env: Record<string, string> = {};
  for (const key of REQUIRED_ENV) {
    const value = Deno.env.get(key);
    if (!value) return jsonResponse({ error: `missing env: ${key}` }, 500);
    env[key] = value;
  }

  const admin = createClient(env.SUPABASE_URL as string, env.SUPABASE_SERVICE_ROLE_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: job, error: jobError } = await admin
    .from('bulk_jobs')
    .select('user_id, status')
    .eq('id', jobId)
    .maybeSingle();
  if (jobError) return jsonResponse({ error: jobError.message }, 500);
  if (!job) return jsonResponse({ error: 'job not found' }, 404);
  if (job.status === 'completed' || job.status === 'failed') {
    return jsonResponse({ jobId, status: job.status, skipped: true }, 200);
  }

  const tokenStore = new SupabaseTokenStore(admin as never);
  const initialToken = await tokenStore.get().catch(() => null);
  const predictus = new PredictusClient({
    baseUrl: env.PREDICTUS_BASE_URL as string,
    username: env.PREDICTUS_USERNAME as string,
    password: env.PREDICTUS_PASSWORD as string,
    initialToken: initialToken ?? undefined,
    onTokenChange: async (token) => {
      try {
        await tokenStore.set(token);
      } catch (e) {
        console.error('persist token failed:', e);
      }
    },
  });

  const userId = job.user_id as string;
  const task = (async () => {
    try {
      const _result = await processBulkJob(
        jobId,
        {
          getPendingItems: (id, limit) => getPendingItems(admin as never, id, limit),
          recordItemResult: (itemId, outcome) => recordItemResult(admin as never, itemId, outcome),
          refreshJobCounters: (id) => refreshJobCounters(admin as never, id),
          setJobStatus: (id, status) => setJobStatus(admin as never, id, status),
          processItem: (item) =>
            processBulkItem(item, {
              admin: admin as never,
              predictus,
              audit: writeAuditLog,
              getCachedResults,
              setCachedResults,
              decryptDocument: (ciphertext) => decryptText(admin as never, ciphertext),
              dispatchEnrichment: (input) =>
                findOrCreateJob(admin as never, input).then(() => undefined),
              userId,
            }),
          sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
        },
        { rateLimitMs: 3600, batchSize: 250 },
      );
    } catch (e) {
      console.error(`bulk job ${jobId} failed:`, e);
      try {
        await setJobStatus(admin as never, jobId, 'failed', {
          errorMessage: e instanceof Error ? e.message : String(e),
        });
      } catch (statusErr) {
        console.error('failed to mark job as failed:', statusErr);
      }
    }
  })();

  if (typeof EdgeRuntime !== 'undefined') {
    EdgeRuntime.waitUntil(task);
  } else {
    // Local fallback: process synchronously. Slower but works under
    // `supabase functions serve`.
    await task;
  }

  return jsonResponse({ jobId, status: 'started' }, 202);
});
