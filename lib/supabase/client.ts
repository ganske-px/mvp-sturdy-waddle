import { createBrowserClient } from '@supabase/ssr';
import { supabaseEnv } from './env.ts';
import type { Database } from './types.ts';

export function createClient() {
  return createBrowserClient<Database>(supabaseEnv.url(), supabaseEnv.publishableKey());
}
