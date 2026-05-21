import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export type Service = 'search_person' | 'search_company' | 'search_bulk' | 'search_network';

export const ALL_SERVICES: readonly Service[] = [
  'search_person',
  'search_company',
  'search_bulk',
  'search_network',
] as const;

export type AppUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'operator';
  is_active: boolean;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function loadCurrentUser(supabase: SupabaseServerClient): Promise<AppUser | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('users')
    .select('id, email, display_name, role, is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (!data) return null;
  // Supabase JS infers `never` for selected rows once the typed client crosses
  // module boundaries; the columns are validated by the `select()` call above
  // and our `users` table schema.
  const row = data as AppUser;
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
    is_active: row.is_active,
  };
}

export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = await createClient();
  return loadCurrentUser(supabase);
}

export async function requireAuth(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user || !user.is_active) redirect('/access-denied');
  return user;
}

export async function requireAdmin(): Promise<AppUser> {
  const user = await requireAuth();
  if (user.role !== 'admin') redirect('/access-denied');
  return user;
}

export async function requirePermission(svc: Service): Promise<AppUser> {
  // Reuse one server client so tests (and callers) only pay one cookie/refresh
  // round-trip per request, and so the same mock satisfies both lookups.
  const supabase = await createClient();
  const user = await loadCurrentUser(supabase);
  if (!user || !user.is_active) redirect('/access-denied');
  if (user.role === 'admin') return user;
  // Supabase JS infers RPC args as `never` once the client crosses module
  // boundaries; `as never` is the documented escape hatch. The function is
  // typed in `lib/supabase/types.ts` so the call itself is checked.
  const { data, error } = await supabase.rpc(
    'has_service_permission' as never,
    { uid: user.id, svc } as never,
  );
  if (error || data !== true) redirect('/access-denied');
  return user;
}

export async function listUserPermissions(userId: string): Promise<Set<Service>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('user_service_permissions')
    .select('service')
    .eq('user_id', userId)
    .returns<Array<{ service: Service }>>();
  return new Set((data ?? []).map((r) => r.service));
}
