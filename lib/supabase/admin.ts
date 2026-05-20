import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { supabaseEnv } from './env';
import type { Database } from './types';

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
