import 'server-only';
import type { Database } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export class LockoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockoutError';
  }
}

export type AdminChange = 'deactivate' | 'demote';

export function assertNotSelf(adminId: string, targetId: string, change: AdminChange): void {
  if (adminId !== targetId) return;
  const action = change === 'deactivate' ? 'desativar' : 'rebaixar';
  throw new LockoutError(`Você não pode ${action} a si próprio.`);
}

export async function assertNotLastActiveAdmin(
  client: SupabaseClient<Database>,
  targetId: string,
  change: AdminChange,
): Promise<void> {
  const { count, error } = await client
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .eq('is_active', true)
    .neq('id', targetId);
  if (error) {
    throw new Error(`assertNotLastActiveAdmin query failed: ${error.message}`);
  }
  if (!count || count === 0) {
    const action = change === 'deactivate' ? 'desativar' : 'rebaixar';
    throw new LockoutError(`Não é possível ${action} o único administrador ativo.`);
  }
}
