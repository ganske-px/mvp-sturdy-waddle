'use server';

import { extractRequestContext, writeAuditLog } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/permissions';
import { encryptText } from '@/lib/crypto/vault';
import { hashDocument } from '@/lib/hash';
import { getCachedResults, setCachedResults } from '@/lib/predictus/cache';
import { createServerPredictusClient } from '@/lib/predictus/server-client';
import type { PredictusProcess } from '@/lib/predictus/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isValid as isCnpjValid, mask as maskCnpj } from '@/lib/validators/cnpj';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export type SearchByCnpjInput = { rawInput: string };

export type SearchByCnpjResult = { ok: false; error: string };

export async function searchByCnpj(input: SearchByCnpjInput): Promise<SearchByCnpjResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado.' };

  await requirePermission('search_company');

  const trimmed = input.rawInput.trim();
  if (!trimmed) return { ok: false, error: 'Termo de busca vazio.' };
  if (!isCnpjValid(trimmed)) return { ok: false, error: 'CNPJ inválido.' };

  const documentHash = hashDocument('cnpj', trimmed);
  const termPreview = maskCnpj(trimmed);

  const admin = createAdminClient();
  const requestContext = extractRequestContext(await headers());

  await writeAuditLog(
    {
      userId: user.id,
      action: 'search_single',
      searchType: 'cnpj',
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
    console.warn('cache lookup failed, falling through:', e);
  }

  if (cached) {
    await supabase.from('searches').insert({
      user_id: user.id,
      search_type: 'cnpj',
      document_hash: documentHash,
      term_preview: termPreview,
      result_count: cached.results.length,
    } as never);
    try {
      const { findOrCreateJob } = await import('@/lib/netrin/job-store');
      const documentEncrypted = await encryptText(admin, trimmed.replace(/\D/g, ''));
      await findOrCreateJob(admin, {
        userId: user.id,
        rootHash: documentHash,
        rootType: 'cnpj',
        documentEncrypted,
      });
    } catch (e) {
      console.warn('enrichment job creation failed:', e);
    }
    redirect(`/search/result/${encodeURIComponent(documentHash)}`);
  }

  let results: PredictusProcess[];
  try {
    const client = await createServerPredictusClient();
    results = await client.searchByCnpj(trimmed.replace(/\D/g, ''));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro na consulta.';
    await supabase.from('searches').insert({
      user_id: user.id,
      search_type: 'cnpj',
      document_hash: documentHash,
      term_preview: termPreview,
      result_count: 0,
      error_message: message,
    } as never);
    return { ok: false, error: message };
  }

  try {
    await setCachedResults(admin, documentHash, 'cnpj', results);
  } catch (e) {
    console.warn('cache write failed:', e);
  }

  await supabase.from('searches').insert({
    user_id: user.id,
    search_type: 'cnpj',
    document_hash: documentHash,
    term_preview: termPreview,
    result_count: results.length,
  } as never);

  try {
    const { findOrCreateJob } = await import('@/lib/netrin/job-store');
    const documentEncrypted = await encryptText(admin, trimmed.replace(/\D/g, ''));
    await findOrCreateJob(admin, {
      userId: user.id,
      rootHash: documentHash,
      rootType: 'cnpj',
      documentEncrypted,
    });
  } catch (e) {
    console.warn('enrichment job creation failed:', e);
  }

  redirect(`/search/result/${encodeURIComponent(documentHash)}`);
}
