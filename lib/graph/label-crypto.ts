import type { Database } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function encryptLabel(
  client: SupabaseClient<Database>,
  plaintext: string,
): Promise<string> {
  const { data, error } = await client.rpc('encrypt_graph_label' as never, { plaintext } as never);
  if (error) throw new Error(`encryptLabel failed: ${error.message}`);
  return data as unknown as string;
}

export async function decryptLabel(
  client: SupabaseClient<Database>,
  ciphertext: string,
): Promise<string> {
  const { data, error } = await client.rpc('decrypt_graph_label' as never, { ciphertext } as never);
  if (error) throw new Error(`decryptLabel failed: ${error.message}`);
  return data as unknown as string;
}
