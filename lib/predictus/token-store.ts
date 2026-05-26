import type { Database } from '@/lib/supabase/types.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PredictusTokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
}

const SINGLETON_ID = 1;

/**
 * Persists the Predictus access token in `public.predictus_token` so it
 * survives Vercel/Edge function cold starts. The table has one row only —
 * id is always 1, enforced by a CHECK constraint in the migration.
 *
 * The store requires a service-role client because the table's RLS is
 * locked (no policies → only service_role bypasses it).
 */
export class SupabaseTokenStore implements PredictusTokenStore {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async get(): Promise<string | null> {
    const { data, error } = await this.client
      .from('predictus_token')
      .select('access_token')
      .eq('id', SINGLETON_ID)
      .maybeSingle()
      .returns<{ access_token: string }>();
    if (error) {
      throw new Error(`SupabaseTokenStore.get failed: ${error.message}`);
    }
    return data?.access_token ?? null;
  }

  async set(token: string): Promise<void> {
    const { error } = await this.client.from('predictus_token').upsert({
      id: SINGLETON_ID,
      access_token: token,
      refreshed_at: new Date().toISOString(),
    } as never);
    if (error) {
      throw new Error(`SupabaseTokenStore.set failed: ${error.message}`);
    }
  }
}
