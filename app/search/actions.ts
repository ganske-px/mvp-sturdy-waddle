'use server';

import { extractRequestContext, writeAuditLog } from '@/lib/audit';
import { hashDocument } from '@/lib/hash';
import { PredictusClient } from '@/lib/predictus/client';
import type { PredictusProcess } from '@/lib/predictus/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  format as formatCnpj,
  isValid as isCnpjValid,
  mask as maskCnpj,
} from '@/lib/validators/cnpj';
import { format as formatCpf, isValid as isCpfValid, mask as maskCpf } from '@/lib/validators/cpf';
import { maskName } from '@/lib/validators/name';
import { headers } from 'next/headers';

export type SearchType = 'cpf' | 'cnpj' | 'name';

export type SearchByDocInput = {
  type: SearchType;
  rawInput: string;
};

export type SearchByDocOk = {
  ok: true;
  results: PredictusProcess[];
  displayTerm: string;
  searchType: SearchType;
};

export type SearchByDocErr = {
  ok: false;
  error: string;
};

export type SearchByDocResult = SearchByDocOk | SearchByDocErr;

function makePredictusClient(): PredictusClient {
  const baseUrl = process.env.PREDICTUS_BASE_URL;
  const username = process.env.PREDICTUS_USERNAME;
  const password = process.env.PREDICTUS_PASSWORD;
  if (!baseUrl || !username || !password) {
    throw new Error(
      'Predictus credentials missing — set PREDICTUS_BASE_URL, PREDICTUS_USERNAME, PREDICTUS_PASSWORD.',
    );
  }
  return new PredictusClient({ baseUrl, username, password });
}

export async function searchByDoc(input: SearchByDocInput): Promise<SearchByDocResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'Not authenticated.' };
  }

  // Validate + normalize per type
  const trimmed = input.rawInput.trim();
  if (!trimmed) return { ok: false, error: 'Search term is empty.' };

  let documentHash: string;
  let termPreview: string;
  let displayTerm: string;

  if (input.type === 'cpf') {
    if (!isCpfValid(trimmed)) return { ok: false, error: 'Invalid CPF.' };
    documentHash = hashDocument('cpf', trimmed);
    termPreview = maskCpf(trimmed);
    displayTerm = formatCpf(trimmed);
  } else if (input.type === 'cnpj') {
    if (!isCnpjValid(trimmed)) return { ok: false, error: 'Invalid CNPJ.' };
    documentHash = hashDocument('cnpj', trimmed);
    termPreview = maskCnpj(trimmed);
    displayTerm = formatCnpj(trimmed);
  } else {
    if (trimmed.length < 3) {
      return { ok: false, error: 'Name must have at least 3 characters.' };
    }
    documentHash = hashDocument('name', trimmed);
    termPreview = maskName(trimmed);
    displayTerm = trimmed;
  }

  const admin = createAdminClient();
  const requestContext = extractRequestContext(await headers());

  // Audit log BEFORE the Predictus call — we want a trail of the attempt
  // regardless of whether the upstream returns successfully.
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

  // Call Predictus
  let results: PredictusProcess[];
  try {
    const client = makePredictusClient();
    results =
      input.type === 'cpf'
        ? await client.searchByCpf(trimmed.replace(/\D/g, ''))
        : input.type === 'cnpj'
          ? await client.searchByCnpj(trimmed.replace(/\D/g, ''))
          : await client.searchByName(trimmed);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown Predictus error.';
    // Record the failed search so it appears in history.
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

  // Record the search.
  await supabase.from('searches').insert({
    user_id: user.id,
    search_type: input.type,
    document_hash: documentHash,
    term_preview: termPreview,
    result_count: results.length,
  } as never);

  return { ok: true, results, displayTerm, searchType: input.type };
}
