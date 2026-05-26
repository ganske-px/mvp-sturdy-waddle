'use server';

import { extractRequestContext, writeAuditLog } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/permissions';
import { hashDocument } from '@/lib/hash';
import { getCachedResults, setCachedResults } from '@/lib/predictus/cache';
import { createServerPredictusClient } from '@/lib/predictus/server-client';
import type { PredictusProcess } from '@/lib/predictus/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { format as formatCpf, isValid as isCpfValid, mask as maskCpf } from '@/lib/validators/cpf';
import { maskName } from '@/lib/validators/name';
import { headers } from 'next/headers';

export type PersonSearchType = 'cpf' | 'name';

export type SearchPersonInput = { type: PersonSearchType; rawInput: string };

export type SearchPersonOk = {
  ok: true;
  results: PredictusProcess[];
  displayTerm: string;
  searchType: PersonSearchType;
  cached: boolean;
  fetchedAt: string;
  networkHash: string | null;
};

export type SearchPersonErr = { ok: false; error: string };

export type SearchPersonResult = SearchPersonOk | SearchPersonErr;

export async function searchPerson(input: SearchPersonInput): Promise<SearchPersonResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado.' };

  await requirePermission('search_person');

  const trimmed = input.rawInput.trim();
  if (!trimmed) return { ok: false, error: 'Termo de busca vazio.' };

  let documentHash: string;
  let termPreview: string;
  let displayTerm: string;

  if (input.type === 'cpf') {
    if (!isCpfValid(trimmed)) return { ok: false, error: 'CPF inválido.' };
    documentHash = hashDocument('cpf', trimmed);
    termPreview = maskCpf(trimmed);
    displayTerm = formatCpf(trimmed);
  } else {
    if (trimmed.length < 3) {
      return { ok: false, error: 'O nome precisa ter ao menos 3 caracteres.' };
    }
    documentHash = hashDocument('name', trimmed);
    termPreview = maskName(trimmed);
    displayTerm = trimmed;
  }

  const networkHash = input.type === 'name' ? null : documentHash;

  const admin = createAdminClient();
  const requestContext = extractRequestContext(await headers());

  await writeAuditLog(
    {
      userId: user.id,
      action: 'search_single',
      searchType: input.type,
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
      search_type: input.type,
      document_hash: documentHash,
      term_preview: termPreview,
      result_count: cached.results.length,
    } as never);
    if (input.type === 'cpf') {
      try {
        const { findOrCreateJob } = await import('@/lib/netrin/job-store');
        const { jobId, created } = await findOrCreateJob(admin, {
          userId: user.id,
          rootHash: documentHash,
          rootType: 'cpf',
        });
        if (created) {
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
          const secret = process.env.SUPABASE_SECRET_KEY;
          if (supabaseUrl && secret) {
            const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/process-enrichment-job`;
            void fetch(url, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${secret}`,
              },
              body: JSON.stringify({ jobId, documentRaw: trimmed.replace(/\D/g, '') }),
            }).catch((e) => console.warn('enrichment dispatch failed:', e));
          }
        }
      } catch (e) {
        console.warn('enrichment job creation failed:', e);
      }
    }
    return {
      ok: true,
      results: cached.results,
      displayTerm,
      searchType: input.type,
      cached: true,
      fetchedAt: cached.fetchedAt,
      networkHash,
    };
  }

  let results: PredictusProcess[];
  const fetchedAt = new Date().toISOString();
  try {
    const client = await createServerPredictusClient();
    results =
      input.type === 'cpf'
        ? await client.searchByCpf(trimmed.replace(/\D/g, ''))
        : await client.searchByName(trimmed);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro na consulta.';
    await supabase.from('searches').insert({
      user_id: user.id,
      search_type: input.type,
      document_hash: documentHash,
      term_preview: termPreview,
      result_count: 0,
      error_message: message,
    } as never);
    return { ok: false, error: message };
  }

  try {
    await setCachedResults(admin, documentHash, input.type, results);
  } catch (e) {
    console.warn('cache write failed:', e);
  }

  await supabase.from('searches').insert({
    user_id: user.id,
    search_type: input.type,
    document_hash: documentHash,
    term_preview: termPreview,
    result_count: results.length,
  } as never);

  if (input.type === 'cpf') {
    try {
      const { findOrCreateJob } = await import('@/lib/netrin/job-store');
      const { jobId, created } = await findOrCreateJob(admin, {
        userId: user.id,
        rootHash: documentHash,
        rootType: 'cpf',
      });
      if (created) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const secret = process.env.SUPABASE_SECRET_KEY;
        if (supabaseUrl && secret) {
          const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/process-enrichment-job`;
          void fetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              Authorization: `Bearer ${secret}`,
            },
            body: JSON.stringify({ jobId, documentRaw: trimmed.replace(/\D/g, '') }),
          }).catch((e) => console.warn('enrichment dispatch failed:', e));
        }
      }
    } catch (e) {
      console.warn('enrichment job creation failed:', e);
    }
  }

  return {
    ok: true,
    results,
    displayTerm,
    searchType: input.type,
    cached: false,
    fetchedAt,
    networkHash,
  };
}
