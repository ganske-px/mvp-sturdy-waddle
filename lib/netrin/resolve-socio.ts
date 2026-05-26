import { decryptNetrinText } from '@/lib/crypto/vault';
import { hashDocument } from '@/lib/hash';
import type { Database } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractPivotCpfs } from './parsers/pivot-cpfs';
import type { NetrinCompositePayload } from './types';

export type ResolveSocioInput = {
  parentCnpjHash: string;
  cpfHash: string;
};

export async function resolveSocioCpf(
  admin: SupabaseClient<Database>,
  input: ResolveSocioInput,
): Promise<string | null> {
  const { data: row, error } = await admin
    .from('netrin_cache')
    .select('encrypted_payload')
    .eq('document_hash', input.parentCnpjHash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
    .returns<{ encrypted_payload: string }>();

  if (error || !row) return null;

  let payload: NetrinCompositePayload;
  try {
    const plaintext = await decryptNetrinText(admin, row.encrypted_payload);
    payload = JSON.parse(plaintext) as NetrinCompositePayload;
  } catch {
    return null;
  }

  for (const { cpf } of extractPivotCpfs(payload)) {
    if (cpf.length !== 11) continue;
    try {
      if (hashDocument('cpf', cpf) === input.cpfHash) return cpf;
    } catch {
      // hashDocument failed — skip
    }
  }

  return null;
}
