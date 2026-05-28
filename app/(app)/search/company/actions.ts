'use server';

import { extractRequestContext } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/permissions';
import { runCnpjSearch } from '@/lib/predictus/run-search';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
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

  const admin = createAdminClient();
  const requestContext = extractRequestContext(await headers());

  const result = await runCnpjSearch(input.rawInput, {
    userId: user.id,
    admin,
    supabase,
    ip: requestContext.ip ?? null,
    userAgent: requestContext.userAgent ?? null,
  });
  if (!result.ok) return result;
  redirect(`/search/result/${encodeURIComponent(result.documentHash)}`);
}
