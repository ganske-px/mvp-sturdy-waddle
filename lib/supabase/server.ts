import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './types';
import { supabaseEnv } from './env';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(supabaseEnv.url(), supabaseEnv.anonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — read-only cookies. Safe to ignore
          // when middleware is refreshing the session.
        }
      },
    },
  });
}
