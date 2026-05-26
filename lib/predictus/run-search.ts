import { writeAuditLog } from '@/lib/audit';
import { encryptText } from '@/lib/crypto/vault';
import { hashDocument } from '@/lib/hash';
import { findOrCreateJob } from '@/lib/netrin/job-store';
import { getCachedResults, setCachedResults } from '@/lib/predictus/cache';
import { createServerPredictusClient } from '@/lib/predictus/server-client';
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

export async function runCpfSearch(
  rawInput: string,
  ctx: RunSearchContext,
): Promise<RunSearchResult> {
  const trimmed = rawInput.trim();
  if (!trimmed) return { ok: false, error: 'Termo de busca vazio.' };
  if (!isCpfValid(trimmed)) return { ok: false, error: 'CPF inválido.' };

  const documentHash = hashDocument('cpf', trimmed);
  const termPreview = maskCpf(trimmed);

  await writeAuditLog(
    {
      userId: ctx.userId,
      action: 'search_single',
      searchType: 'cpf',
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

  if (cached) {
    await ctx.supabase.from('searches').insert({
      user_id: ctx.userId,
      search_type: 'cpf',
      document_hash: documentHash,
      term_preview: termPreview,
      result_count: cached.results.length,
    } as never);
    await ensureEnrichmentJob(ctx.admin, ctx.userId, documentHash, 'cpf', trimmed);
    return { ok: true, documentHash, termPreview };
  }

  let results: PredictusProcess[];
  try {
    const client = await createServerPredictusClient();
    results = await client.searchByCpf(trimmed.replace(/\D/g, ''));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro na consulta.';
    await ctx.supabase.from('searches').insert({
      user_id: ctx.userId,
      search_type: 'cpf',
      document_hash: documentHash,
      term_preview: termPreview,
      result_count: 0,
      error_message: message,
    } as never);
    return { ok: false, error: message };
  }

  try {
    await setCachedResults(ctx.admin, documentHash, 'cpf', results);
  } catch (e) {
    console.warn('cache write failed:', e);
  }

  await ctx.supabase.from('searches').insert({
    user_id: ctx.userId,
    search_type: 'cpf',
    document_hash: documentHash,
    term_preview: termPreview,
    result_count: results.length,
  } as never);

  await ensureEnrichmentJob(ctx.admin, ctx.userId, documentHash, 'cpf', trimmed);

  return { ok: true, documentHash, termPreview };
}

export async function runCnpjSearch(
  rawInput: string,
  ctx: RunSearchContext,
): Promise<RunSearchResult> {
  const trimmed = rawInput.trim();
  if (!trimmed) return { ok: false, error: 'Termo de busca vazio.' };
  if (!isCnpjValid(trimmed)) return { ok: false, error: 'CNPJ inválido.' };

  const documentHash = hashDocument('cnpj', trimmed);
  const termPreview = maskCnpj(trimmed);

  await writeAuditLog(
    {
      userId: ctx.userId,
      action: 'search_single',
      searchType: 'cnpj',
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

  if (cached) {
    await ctx.supabase.from('searches').insert({
      user_id: ctx.userId,
      search_type: 'cnpj',
      document_hash: documentHash,
      term_preview: termPreview,
      result_count: cached.results.length,
    } as never);
    await ensureEnrichmentJob(ctx.admin, ctx.userId, documentHash, 'cnpj', trimmed);
    return { ok: true, documentHash, termPreview };
  }

  let results: PredictusProcess[];
  try {
    const client = await createServerPredictusClient();
    results = await client.searchByCnpj(trimmed.replace(/\D/g, ''));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro na consulta.';
    await ctx.supabase.from('searches').insert({
      user_id: ctx.userId,
      search_type: 'cnpj',
      document_hash: documentHash,
      term_preview: termPreview,
      result_count: 0,
      error_message: message,
    } as never);
    return { ok: false, error: message };
  }

  try {
    await setCachedResults(ctx.admin, documentHash, 'cnpj', results);
  } catch (e) {
    console.warn('cache write failed:', e);
  }

  await ctx.supabase.from('searches').insert({
    user_id: ctx.userId,
    search_type: 'cnpj',
    document_hash: documentHash,
    term_preview: termPreview,
    result_count: results.length,
  } as never);

  await ensureEnrichmentJob(ctx.admin, ctx.userId, documentHash, 'cnpj', trimmed);

  return { ok: true, documentHash, termPreview };
}

async function ensureEnrichmentJob(
  admin: Admin,
  userId: string,
  rootHash: string,
  rootType: 'cpf' | 'cnpj',
  rawDoc: string,
): Promise<void> {
  try {
    const documentEncrypted = await encryptText(admin, rawDoc.replace(/\D/g, ''));
    await findOrCreateJob(admin, {
      userId,
      rootHash,
      rootType,
      documentEncrypted,
    });
  } catch (e) {
    console.warn('enrichment job creation failed:', e);
  }
}
