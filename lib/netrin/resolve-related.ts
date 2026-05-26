import { decryptNetrinText } from '@/lib/crypto/vault';
import { hashDocument } from '@/lib/hash';
import type { Database } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractRelatedCpfs } from './parsers/related-cpfs';
import type { NetrinCompositePayload } from './types';

export type ResolveRelatedInput = {
  parentCpfHash: string;
  cpfHash: string;
};

export async function resolveRelatedCpf(
  admin: SupabaseClient<Database>,
  input: ResolveRelatedInput,
): Promise<string | null> {
  const { data: row, error } = await admin
    .from('netrin_cache')
    .select('encrypted_payload')
    .eq('document_hash', input.parentCpfHash)
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

  for (const { cpf } of extractRelatedCpfs(payload)) {
    try {
      if (hashDocument('cpf', cpf) === input.cpfHash) return cpf;
    } catch {
      // hashDocument failed — skip
    }
  }

  return null;
}
