import { createAdminClient } from '@/lib/supabase/admin.ts';
import { PredictusClient } from './client.ts';
import { SupabaseTokenStore } from './token-store.ts';

/**
 * Builds a PredictusClient wired to persist its access token in
 * `public.predictus_token` so it survives function cold starts. Use this in
 * Server Actions and Edge Functions instead of `new PredictusClient(...)`
 * directly.
 */
export async function createServerPredictusClient(): Promise<PredictusClient> {
  const baseUrl = process.env.PREDICTUS_BASE_URL;
  const username = process.env.PREDICTUS_USERNAME;
  const password = process.env.PREDICTUS_PASSWORD;
  if (!baseUrl || !username || !password) {
    throw new Error(
      'Predictus credentials missing — set PREDICTUS_BASE_URL, PREDICTUS_USERNAME, PREDICTUS_PASSWORD.',
    );
  }

  const admin = createAdminClient();
  const store = new SupabaseTokenStore(admin);

  let initialToken: string | null = null;
  try {
    initialToken = await store.get();
  } catch (e) {
    // Surface as a warning — the worst case is one extra auth round-trip.
    console.warn('Failed to read predictus_token from Supabase, will re-auth:', e);
  }

  return new PredictusClient({
    baseUrl,
    username,
    password,
    initialToken: initialToken ?? undefined,
    onTokenChange: async (token) => {
      try {
        await store.set(token);
      } catch (e) {
        // Persistence is best-effort; the in-memory token still works for
        // the current request. Next cold start will re-auth.
        console.error('Failed to persist Predictus token to Supabase:', e);
      }
    },
  });
}
