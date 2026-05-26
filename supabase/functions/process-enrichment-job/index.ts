// supabase/functions/process-enrichment-job/index.ts
import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';
import { writeAuditLog } from '../../../lib/audit.ts';
import { upsertGraph } from '../../../lib/graph/writer.ts';
import { getNetrinCache, setNetrinCache } from '../../../lib/netrin/cache.ts';
import { NetrinClient } from '../../../lib/netrin/client.ts';
import { buildNetrinGraph } from '../../../lib/netrin/graph-bridge.ts';
import { runHop1 } from '../../../lib/netrin/hops/hop1.ts';
import { runHop2 } from '../../../lib/netrin/hops/hop2.ts';
import { runHop3 } from '../../../lib/netrin/hops/hop3.ts';
import {
  bumpHopDone,
  recordCall,
  setHop1Status,
  setHopTotals,
  setJobStatus,
} from '../../../lib/netrin/job-store.ts';
import { processEnrichmentJob } from '../../../lib/netrin/processor.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

type Body = { jobId?: unknown; documentRaw?: unknown };

const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
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
  const rootRaw = typeof body.documentRaw === 'string' ? body.documentRaw : null;
  if (!rootRaw) return jsonResponse({ error: 'missing documentRaw' }, 400);

  const env: Record<string, string> = {};
  for (const k of REQUIRED_ENV) {
    const v = Deno.env.get(k);
    if (!v) return jsonResponse({ error: `missing env: ${k}` }, 500);
    env[k] = v;
  }
  const acuraciaRaw = Deno.env.get('NETRIN_PEP_ACURACIA');
  const pepAcuraciaParsed = acuraciaRaw ? Number.parseInt(acuraciaRaw, 10) : undefined;
  const pepAcuracia = Number.isFinite(pepAcuraciaParsed) ? (pepAcuraciaParsed as number) : undefined;

  const admin = createClient(env.SUPABASE_URL as string, env.SUPABASE_SECRET_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: job, error: jobError } = await admin
    .from('enrichment_jobs')
    .select('id, user_id, root_hash, root_type, status')
    .eq('id', body.jobId)
    .maybeSingle();
  if (jobError) return jsonResponse({ error: jobError.message }, 500);
  if (!job) return jsonResponse({ error: 'job not found' }, 404);
  const jobStatus = (job as { status: string }).status;
  if (jobStatus === 'completed' || jobStatus === 'failed' || jobStatus === 'partial') {
    return jsonResponse({ jobId: body.jobId, status: jobStatus, skipped: true }, 200);
  }

  const userId = (job as { user_id: string }).user_id;
  const rootHash = (job as { root_hash: string }).root_hash;
  const rootType = (job as { root_type: 'cpf' | 'cnpj' }).root_type;

  const netrin = new NetrinClient({
    baseUrl: env.NETRIN_BASE_URL as string,
    token: env.NETRIN_TOKEN as string,
    pepAcuracia,
  });

  const { hashDocument } = await import('../../../lib/hash.ts');

  const auditFn = (event: Parameters<typeof writeAuditLog>[0]) =>
    writeAuditLog(event, admin as never, { allowFailure: true });
  const getCacheFn = (hash: string) => getNetrinCache(admin as never, hash);
  const setCacheFn = (hash: string, type: 'cpf' | 'cnpj', slugs: string[], payload: Record<string, unknown>) =>
    setNetrinCache(admin as never, hash, type, slugs, payload);

  const task = (async () => {
    try {
      const jobIdStr = body.jobId as string;
      await processEnrichmentJob(jobIdStr, {
        job: { rootType, rootRaw, rootHash, userId },
        setJobStatus: (id, status, opts) => setJobStatus(admin as never, id, status, opts),
        setHop1Status: (id, s) => setHop1Status(admin as never, id, s),
        setHopTotals: (id, t) => setHopTotals(admin as never, id, t),
        bumpHopDone: (id, hop) => bumpHopDone(admin as never, id, hop),
        recordCall: (input) => recordCall(admin as never, input),
        runHop1: () => runHop1({
          documentRaw: rootRaw,
          documentHash: rootHash,
          userId,
          jobId: jobIdStr,
          audit: auditFn,
          getCache: getCacheFn,
          setCache: setCacheFn,
          fetchComposta: (type, raw, slugs) => netrin.fetchComposta(type, raw, slugs),
        }),
        runHop2: (cnpjRaw) => runHop2({
          cnpjRaw,
          cnpjHash: hashDocument('cnpj', cnpjRaw),
          userId,
          jobId: jobIdStr,
          audit: auditFn,
          getCache: getCacheFn,
          setCache: setCacheFn,
          fetchComposta: (type, raw, slugs) => netrin.fetchComposta(type, raw, slugs),
        }),
        runHop3: (cpfRaw) => runHop3({
          cpfRaw,
          cpfHash: hashDocument('cpf', cpfRaw),
          userId,
          jobId: jobIdStr,
          audit: auditFn,
          getCache: getCacheFn,
          setCache: setCacheFn,
          fetchComposta: (type, raw, slugs) => netrin.fetchComposta(type, raw, slugs),
        }),
        finalize: async ({ hop1Payload, hop2Payloads }) => {
          const graph = buildNetrinGraph({
            rootDocument: { type: rootType, raw: rootRaw },
            hop1Payload,
            hop2Payloads,
          });
          if (graph.nodes.length > 0) {
            await upsertGraph(admin as never, graph.nodes, graph.edges);
          }
        },
      });
    } catch (e) {
      console.error(`enrichment job ${body.jobId} failed:`, e);
      try {
        await setJobStatus(admin as never, body.jobId as string, 'failed', {
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
