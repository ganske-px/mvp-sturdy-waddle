import { writeAuditLog } from '@/lib/audit';
import { encryptText } from '@/lib/crypto/vault';
import { hashDocument } from '@/lib/hash';
import { findOrCreateJob } from '@/lib/netrin/job-store';
import { getCachedResults } from '@/lib/predictus/cache';
import type { PredictusProcess } from '@/lib/predictus/types';
import type { createAdminClient } from '@/lib/supabase/admin';
import type { createClient } from '@/lib/supabase/server';
import { isValid as isCnpjValid, mask as maskCnpj } from '@/lib/validators/cnpj';
import { isValid as isCpfValid, mask as maskCpf } from '@/lib/validators/cpf';

type Admin = ReturnType<typeof createAdminClient>;
type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type RunSearchContext = {
  userId: string;
  admin: Admin;
  supabase: ServerClient;
  ip: string | null;
  userAgent: string | null;
};

export type RunSearchSuccess = {
  ok: true;
  documentHash: string;
  termPreview: string;
};

export type RunSearchFailure = { ok: false; error: string };
export type RunSearchResult = RunSearchSuccess | RunSearchFailure;

const REGISTER_FAIL_ERROR = 'Falha ao registrar a consulta. Tente novamente.';

export async function runCpfSearch(
  rawInput: string,
  ctx: RunSearchContext,
): Promise<RunSearchResult> {
  const trimmed = rawInput.trim();
  if (!trimmed) return { ok: false, error: 'Termo de busca vazio.' };
  if (!isCpfValid(trimmed)) return { ok: false, error: 'CPF inválido.' };

  return runSearch(trimmed, 'cpf', hashDocument('cpf', trimmed), maskCpf(trimmed), ctx);
}

export async function runCnpjSearch(
  rawInput: string,
  ctx: RunSearchContext,
): Promise<RunSearchResult> {
  const trimmed = rawInput.trim();
  if (!trimmed) return { ok: false, error: 'Termo de busca vazio.' };
  if (!isCnpjValid(trimmed)) return { ok: false, error: 'CNPJ inválido.' };

  return runSearch(trimmed, 'cnpj', hashDocument('cnpj', trimmed), maskCnpj(trimmed), ctx);
}

async function runSearch(
  trimmed: string,
  searchType: 'cpf' | 'cnpj',
  documentHash: string,
  termPreview: string,
  ctx: RunSearchContext,
): Promise<RunSearchResult> {
  await writeAuditLog(
    {
      userId: ctx.userId,
      action: 'search_single',
      searchType,
      documentHash,
      ip: ctx.ip ?? undefined,
      userAgent: ctx.userAgent ?? undefined,
    },
    ctx.admin,
    { allowFailure: true },
  );

  let cached: { results: PredictusProcess[]; fetchedAt: string } | null = null;
  try {
    cached = await getCachedResults(ctx.admin, documentHash);
  } catch (e) {
    console.warn('cache lookup failed:', e);
  }

  // Both the pending searches row (Predictus dispatch via pg_net) and the
  // enrichment job (Netrin dispatch) need the document ciphertext, so encrypt
  // once. On cache hit, getCachedResults already exercised the Vault decrypt
  // path successfully, so a failure here is effectively impossible — treat it
  // as fatal rather than partially registering the search.
  let documentEncrypted: string;
  try {
    documentEncrypted = await encryptText(ctx.admin, trimmed.replace(/\D/g, ''));
  } catch (e) {
    console.error('encryptText failed during search registration:', e);
    return { ok: false, error: REGISTER_FAIL_ERROR };
  }

  if (cached) {
    // Predictus already resolved (cache). Register the search as completed and
    // fire the Netrin enrichment in parallel — the two sources never chain.
    // No document_encrypted on this row: status='completed' means the pg_net
    // dispatch trigger is a no-op, so there is nothing for it to decrypt.
    await Promise.all([
      ctx.supabase.from('searches').insert({
        user_id: ctx.userId,
        search_type: searchType,
        document_hash: documentHash,
        term_preview: termPreview,
        result_count: cached.results.length,
        status: 'completed',
      } as never),
      ensureEnrichmentJob(ctx.admin, ctx.userId, documentHash, searchType, documentEncrypted),
    ]);
    return { ok: true, documentHash, termPreview };
  }

  try {
    // Parallel: pending search insert (triggers Predictus dispatch via pg_net)
    // and enrichment job creation (triggers Netrin dispatch) are independent.
    await Promise.all([
      findOrCreatePendingSearch(ctx.supabase, {
        userId: ctx.userId,
        searchType,
        documentHash,
        termPreview,
        documentEncrypted,
      }),
      ensureEnrichmentJob(ctx.admin, ctx.userId, documentHash, searchType, documentEncrypted),
    ]);
  } catch (e) {
    console.error('findOrCreatePendingSearch failed:', e);
    return { ok: false, error: REGISTER_FAIL_ERROR };
  }

  return { ok: true, documentHash, termPreview };
}

async function findOrCreatePendingSearch(
  supabase: ServerClient,
  input: {
    userId: string;
    searchType: 'cpf' | 'cnpj';
    documentHash: string;
    termPreview: string;
    documentEncrypted: string;
  },
): Promise<{ id: string; created: boolean }> {
  const { data, error } = await supabase
    .from('searches')
    .insert({
      user_id: input.userId,
      search_type: input.searchType,
      document_hash: input.documentHash,
      term_preview: input.termPreview,
      status: 'pending',
      result_count: 0,
      document_encrypted: input.documentEncrypted,
    } as never)
    .select('id')
    .single<{ id: string }>();
  if (!error && data) return { id: data.id, created: true };

  if (error && (error as { code?: string }).code === '23505') {
    const { data: existing } = await supabase
      .from('searches')
      .select('id')
      .eq('user_id', input.userId)
      .eq('document_hash', input.documentHash)
      .eq('status', 'pending')
      .maybeSingle<{ id: string }>();
    if (existing) return { id: existing.id, created: false };
  }
  throw new Error(`findOrCreatePendingSearch failed: ${error?.message ?? 'no data returned'}`);
}

async function ensureEnrichmentJob(
  admin: Admin,
  userId: string,
  rootHash: string,
  rootType: 'cpf' | 'cnpj',
  documentEncrypted: string,
): Promise<void> {
  try {
    await findOrCreateJob(admin, { userId, rootHash, rootType, documentEncrypted });
  } catch (e) {
    console.warn('enrichment job creation failed:', e);
  }
}
