'use server';

import { extractRequestContext } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/permissions';
import { resolveSocioCpf } from '@/lib/netrin/resolve-socio';
import { runCnpjSearch, runCpfSearch } from '@/lib/predictus/run-search';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isValid as isCnpjValid } from '@/lib/validators/cnpj';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export type DeepenInput =
  | { docType: 'cnpj'; cnpjRaw: string; currentPath?: string }
  | { docType: 'cpf-socio'; cpfHash: string; parentCnpjHash: string; currentPath?: string };

export type DeepenResult = { ok: false; error: string };

export async function deepenDocument(input: DeepenInput): Promise<DeepenResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado.' };

  const admin = createAdminClient();
  const requestContext = extractRequestContext(await headers());

  if (input.docType === 'cnpj') {
    await requirePermission('search_company');
    if (!isCnpjValid(input.cnpjRaw)) {
      return { ok: false, error: 'CNPJ inválido.' };
    }
    const result = await runCnpjSearch(input.cnpjRaw, {
      userId: user.id,
      admin,
      supabase,
      ip: requestContext.ip ?? null,
      userAgent: requestContext.userAgent ?? null,
    });
    if (!result.ok) return result;
    redirect(buildResultUrl(result.documentHash, input.currentPath));
  }

  // cpf-socio path
  await requirePermission('search_person');
  const rawCpf = await resolveSocioCpf(admin, {
    parentCnpjHash: input.parentCnpjHash,
    cpfHash: input.cpfHash,
  });
  if (!rawCpf) {
    return {
      ok: false,
      error: 'Não foi possível resolver o sócio. Refaça a consulta da empresa.',
    };
  }
  const result = await runCpfSearch(rawCpf, {
    userId: user.id,
    admin,
    supabase,
    ip: requestContext.ip ?? null,
    userAgent: requestContext.userAgent ?? null,
  });
  if (!result.ok) return result;
  redirect(buildResultUrl(result.documentHash, input.currentPath));
}

function buildResultUrl(newHash: string, currentPath?: string): string {
  const parts = currentPath ? currentPath.split(',').filter(Boolean) : [];
  const nextPath = [...parts, newHash].join(',');
  return `/search/result/${encodeURIComponent(newHash)}?path=${encodeURIComponent(nextPath)}`;
}
