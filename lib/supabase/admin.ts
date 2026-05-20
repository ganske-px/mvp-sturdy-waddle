import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { supabaseEnv } from './env';

// Service-role client. Bypasses RLS. Only ever instantiate this in code that
// runs server-side under operator authority (Server Actions, Route Handlers,
// Edge Functions). Never expose this client to the browser.
export function createAdminClient() {
  return createSupabaseClient<Database>(supabaseEnv.url(), supabaseEnv.serviceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
