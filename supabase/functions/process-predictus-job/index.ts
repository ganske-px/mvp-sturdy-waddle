// supabase/functions/process-predictus-job/index.ts
import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';
import { decryptText } from '../../../lib/crypto/vault.ts';
import { getCachedResults, setCachedResults } from '../../../lib/predictus/cache.ts';
import { PredictusClient } from '../../../lib/predictus/client.ts';
import { SupabaseTokenStore } from '../../../lib/predictus/token-store.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

type Body = { searchId?: unknown };

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

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }
  if (typeof body.searchId !== 'string' || !body.searchId) {
    return jsonResponse({ error: 'missing searchId' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseSecret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const predictusBaseUrl = Deno.env.get('PREDICTUS_BASE_URL');
  const predictusUsername = Deno.env.get('PREDICTUS_USERNAME');
  const predictusPassword = Deno.env.get('PREDICTUS_PASSWORD');

  for (const k of REQUIRED_ENV) {
    if (!Deno.env.get(k)) {
      return jsonResponse({ error: `missing env: ${k}` }, 500);
    }
  }

  // Narrow nullability for TS after the loop above.
  if (
    !supabaseUrl ||
    !supabaseSecret ||
    !predictusBaseUrl ||
    !predictusUsername ||
    !predictusPassword
  ) {
    return jsonResponse({ error: 'missing required env vars' }, 500);
  }

  const admin = createClient(supabaseUrl, supabaseSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const searchIdStr = body.searchId;

  const task = (async () => {
    try {
      const { data: search, error: searchError } = await admin
        .from('searches')
        .select('id, user_id, search_type, document_hash, status, document_encrypted')
        .eq('id', searchIdStr)
        .maybeSingle();
      if (searchError) throw new Error(`Database query error: ${searchError.message}`);
      if (!search) throw new Error('search not found');

      const row = search as {
        id: string;
        user_id: string;
        search_type: 'cpf' | 'cnpj' | 'name';
        document_hash: string;
        status: 'pending' | 'completed' | 'failed';
        document_encrypted: string | null;
      };

      if (row.status === 'completed' || row.status === 'failed') {
        return;
      }

      if (row.search_type === 'name') {
        await admin
          .from('searches')
          .update({
            status: 'failed',
            error_message: 'name searches not supported via async dispatch',
            document_encrypted: null,
          } as never)
          .eq('id', searchIdStr);
        return;
      }

      if (!row.document_encrypted) {
        await admin
          .from('searches')
          .update({
            status: 'failed',
            error_message: 'missing document_encrypted',
          } as never)
          .eq('id', searchIdStr);
        return;
      }

      // Plaintext lives only in this stack frame. Never log it.
      const documentRaw = (await decryptText(admin as never, row.document_encrypted)).replace(
        /\D/g,
        '',
      );

      try {
        const cached = await getCachedResults(admin as never, row.document_hash);
        if (cached) {
          await admin
            .from('searches')
            .update({
              status: 'completed',
              result_count: cached.results.length,
              document_encrypted: null,
            } as never)
            .eq('id', searchIdStr);
          return;
        }

        const store = new SupabaseTokenStore(admin as never);
        const initialToken = await store.get().catch(() => null);
        const predictus = new PredictusClient({
          baseUrl: predictusBaseUrl,
          username: predictusUsername,
          password: predictusPassword,
          initialToken: initialToken ?? undefined,
          onTokenChange: async (t) => {
            try {
              await store.set(t);
            } catch (e) {
              console.error('failed to persist predictus token:', e);
            }
          },
        });

        const results =
          row.search_type === 'cpf'
            ? await predictus.searchByCpf(documentRaw)
            : await predictus.searchByCnpj(documentRaw);

        await setCachedResults(admin as never, row.document_hash, row.search_type, results);

        await admin
          .from('searches')
          .update({
            status: 'completed',
            result_count: results.length,
            document_encrypted: null,
          } as never)
          .eq('id', searchIdStr);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`predictus job ${searchIdStr} failed during processing:`, msg);
        await admin
          .from('searches')
          .update({
            status: 'failed',
            error_message: msg,
            document_encrypted: null,
          } as never)
          .eq('id', searchIdStr);
      }
    } catch (e) {
      console.error(`predictus job ${searchIdStr} failed:`, e);
      try {
        await admin
          .from('searches')
          .update({
            status: 'failed',
            error_message: e instanceof Error ? e.message : String(e),
            document_encrypted: null,
          } as never)
          .eq('id', searchIdStr);
      } catch (statusErr) {
        console.error('failed to mark search as failed:', statusErr);
      }
    }
  })();

  if (typeof EdgeRuntime !== 'undefined') {
    EdgeRuntime.waitUntil(task);
  } else {
    await task;
  }

  return jsonResponse({ searchId: searchIdStr, status: 'started' }, 202);
});
