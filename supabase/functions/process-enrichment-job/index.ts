// supabase/functions/process-enrichment-job/index.ts
import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';
import { writeAuditLog } from '../../../lib/audit.ts';
import { decryptText } from '../../../lib/crypto/vault.ts';
import { upsertGraph } from '../../../lib/graph/writer.ts';
import { getNetrinCache, setNetrinCache } from '../../../lib/netrin/cache.ts';
import { NetrinClient } from '../../../lib/netrin/client.ts';
import { buildNetrinGraph } from '../../../lib/netrin/graph-bridge.ts';
import { runCpfSearch } from '../../../lib/netrin/hops/cpf-search.ts';
import { runCnpjSearch } from '../../../lib/netrin/hops/cnpj-search.ts';
import {
  recordCall,
  setJobStatus,
  setNetrinStatus,
} from '../../../lib/netrin/job-store.ts';
import { processEnrichmentJob } from '../../../lib/netrin/processor.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

type Body = { jobId?: unknown };

const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NETRIN_BASE_URL',
  'NETRIN_TOKEN',
] as const;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }
  if (typeof body.jobId !== 'string' || !body.jobId) {
    return jsonResponse({ error: 'missing jobId' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseSecret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseSecret) {
    return jsonResponse({ error: 'missing supabase connection env vars' }, 500);
  }

  const admin = createClient(supabaseUrl, supabaseSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const task = (async () => {
    const jobIdStr = body.jobId as string;
    try {
      const env: Record<string, string> = {
        SUPABASE_URL: supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: supabaseSecret,
      };
      for (const k of REQUIRED_ENV) {
        if (k === 'SUPABASE_URL' || k === 'SUPABASE_SERVICE_ROLE_KEY') continue;
        const v = Deno.env.get(k);
        if (!v) throw new Error(`missing env: ${k}`);
        env[k] = v;
      }

      const { data: job, error: jobError } = await admin
        .from('enrichment_jobs')
        .select('id, user_id, root_hash, root_type, status, document_encrypted')
        .eq('id', jobIdStr)
        .maybeSingle();
      if (jobError) throw new Error(`Database query error: ${jobError.message}`);
      if (!job) throw new Error('job not found');

      const jobStatus = (job as { status: string }).status;
      if (jobStatus === 'completed' || jobStatus === 'failed' || jobStatus === 'partial') {
        return;
      }

      const userId = (job as { user_id: string }).user_id;
      const rootHash = (job as { root_hash: string }).root_hash;
      const rootType = (job as { root_type: 'cpf' | 'cnpj' }).root_type;
      const documentEncrypted = (job as { document_encrypted: string | null }).document_encrypted;
      if (!documentEncrypted) {
        throw new Error('job has no document_encrypted; refusing to process');
      }
      const rootRaw = await decryptText(admin as never, documentEncrypted);

      const acuraciaRaw = Deno.env.get('NETRIN_PEP_ACURACIA');
      const pepAcuraciaParsed = acuraciaRaw ? Number.parseInt(acuraciaRaw, 10) : undefined;
      const pepAcuracia = Number.isFinite(pepAcuraciaParsed)
        ? (pepAcuraciaParsed as number)
        : undefined;

      const netrin = new NetrinClient({
        baseUrl: env.NETRIN_BASE_URL as string,
        token: env.NETRIN_TOKEN as string,
        pepAcuracia,
      });

      const { hashDocument } = await import('../../../lib/hash.ts');

      const auditFn = (event: Parameters<typeof writeAuditLog>[0]) =>
        writeAuditLog(event, admin as never, { allowFailure: true });
      const getCacheFn = (hash: string) => getNetrinCache(admin as never, hash);
      const setCacheFn = (
        hash: string,
        type: 'cpf' | 'cnpj',
        slugs: string[],
        payload: Record<string, unknown>,
      ) => setNetrinCache(admin as never, hash, type, slugs, payload);

      await processEnrichmentJob(jobIdStr, {
        job: { rootType, rootRaw, rootHash, userId },
        setJobStatus: (id, status, opts) => setJobStatus(admin as never, id, status, opts),
        setNetrinStatus: (id, s) => setNetrinStatus(admin as never, id, s),
        recordCall: (input) => recordCall(admin as never, input),
        runCpfSearch: () =>
          runCpfSearch({
            documentRaw: rootRaw,
            documentHash: rootHash,
            userId,
            jobId: jobIdStr,
            audit: auditFn,
            getCache: getCacheFn,
            setCache: setCacheFn,
            fetchComposta: (type, raw, slugs) => netrin.fetchComposta(type, raw, slugs),
          }),
        runCnpjSearch: (cnpjRaw) =>
          runCnpjSearch({
            cnpjRaw,
            cnpjHash: hashDocument('cnpj', cnpjRaw),
            userId,
            jobId: jobIdStr,
            audit: auditFn,
            getCache: getCacheFn,
            setCache: setCacheFn,
            fetchComposta: (type, raw, slugs) => netrin.fetchComposta(type, raw, slugs),
          }),
        finalize: async ({ payload, docType }) => {
          if (!payload) return;
          const graph = buildNetrinGraph({
            rootDocument: { type: rootType, raw: rootRaw },
            cpfPayload: docType === 'cpf' ? payload : null,
            cnpjPayloads: docType === 'cnpj' ? { [rootRaw]: payload } : {},
          });
          if (graph.nodes.length > 0) {
            await upsertGraph(admin as never, graph.nodes, graph.edges);
          }
        },
      });
    } catch (e) {
      console.error(`enrichment job ${jobIdStr} failed:`, e);
      try {
        await setJobStatus(admin as never, jobIdStr, 'failed', {
          error: e instanceof Error ? e.message : String(e),
          finished: true,
        });
      } catch (statusErr) {
        console.error('failed to mark job as failed:', statusErr);
      }
    }
  })();

  if (typeof EdgeRuntime !== 'undefined') {
    EdgeRuntime.waitUntil(task);
  } else {
    await task;
  }

  return jsonResponse({ jobId: body.jobId, status: 'started' }, 202);
});
