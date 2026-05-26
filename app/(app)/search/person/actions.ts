'use server';

import { extractRequestContext, writeAuditLog } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/permissions';
import { hashDocument } from '@/lib/hash';
import { getCachedResults, setCachedResults } from '@/lib/predictus/cache';
import { runCpfSearch } from '@/lib/predictus/run-search';
import { createServerPredictusClient } from '@/lib/predictus/server-client';
import type { PredictusProcess } from '@/lib/predictus/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { maskName } from '@/lib/validators/name';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export type PersonSearchType = 'cpf' | 'name';

export type SearchPersonInput = { type: PersonSearchType; rawInput: string };

export type SearchPersonResult = { ok: false; error: string };

export async function searchPerson(input: SearchPersonInput): Promise<SearchPersonResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado.' };

  await requirePermission('search_person');

  const admin = createAdminClient();
  const requestContext = extractRequestContext(await headers());

  if (input.type === 'cpf') {
    const result = await runCpfSearch(input.rawInput, {
      userId: user.id,
      admin,
      supabase,
      ip: requestContext.ip ?? null,
      userAgent: requestContext.userAgent ?? null,
    });
    if (!result.ok) return result;
    redirect(`/search/result/${encodeURIComponent(result.documentHash)}`);
  }

  // Name search — kept inline (no enrichment job, different flow)
  const trimmed = input.rawInput.trim();
  if (!trimmed) return { ok: false, error: 'Termo de busca vazio.' };
  if (trimmed.length < 3) {
    return { ok: false, error: 'O nome precisa ter ao menos 3 caracteres.' };
  }

  const documentHash = hashDocument('name', trimmed);
  const termPreview = maskName(trimmed);

  await writeAuditLog(
    {
      userId: user.id,
      action: 'search_single',
      searchType: 'name',
      documentHash,
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
    },
    admin,
    { allowFailure: true },
  );

  let cached: { results: PredictusProcess[]; fetchedAt: string } | null = null;
  try {
    cached = await getCachedResults(admin, documentHash);
  } catch (e) {
    console.warn('cache lookup failed:', e);
  }

  if (cached) {
    await supabase.from('searches').insert({
      user_id: user.id,
      search_type: 'name',
      document_hash: documentHash,
      term_preview: termPreview,
      result_count: cached.results.length,
    } as never);
    redirect(`/search/result/${encodeURIComponent(documentHash)}`);
  }

  let results: PredictusProcess[];
  try {
    const client = await createServerPredictusClient();
    results = await client.searchByName(trimmed);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro na consulta.';
    await supabase.from('searches').insert({
      user_id: user.id,
      search_type: 'name',
      document_hash: documentHash,
      term_preview: termPreview,
      result_count: 0,
      error_message: message,
    } as never);
    return { ok: false, error: message };
  }

  try {
    await setCachedResults(admin, documentHash, 'name', results);
  } catch (e) {
    console.warn('cache write failed:', e);
  }

  await supabase.from('searches').insert({
    user_id: user.id,
    search_type: 'name',
    document_hash: documentHash,
    term_preview: termPreview,
    result_count: results.length,
  } as never);

  redirect(`/search/result/${encodeURIComponent(documentHash)}`);
}
