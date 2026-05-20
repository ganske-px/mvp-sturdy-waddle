import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';
import { supabaseEnv } from './env';

export function createClient() {
  return createBrowserClient<Database>(supabaseEnv.url(), supabaseEnv.anonKey());
}
