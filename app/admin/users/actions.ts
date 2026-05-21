'use server';

import { writeAuditLog } from '@/lib/audit';
import { LockoutError, assertNotLastActiveAdmin, assertNotSelf } from '@/lib/auth/admin-guards';
import { type Service, requireAdmin } from '@/lib/auth/permissions';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export type CreateUserInput = {
  email: string;
  display_name: string;
  password: string;
  role: 'admin' | 'operator';
  permissions: Service[];
};

export async function createUser(
  input: CreateUserInput,
): Promise<ActionResult<{ userId: string }>> {
  const me = await requireAdmin();
  const supabase = createAdminClient();

  await writeAuditLog(
    {
      userId: me.id,
      action: 'admin_user_created',
      metadata: { target_email: input.email, role: input.role },
    },
    supabase,
    { allowFailure: true },
  );

  const { data, error } = await supabase.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { display_name: input.display_name },
  });
  if (error || !data.user) {
    return { ok: false, error: error?.message ?? 'Falha ao criar usuário.' };
  }
  const newUserId = data.user.id;

  if (input.role === 'admin') {
    await supabase
      .from('users')
      .update({ role: 'admin' } as never)
      .eq('id', newUserId);
  } else if (input.permissions.length > 0) {
    await supabase.from('user_service_permissions').insert(
      input.permissions.map((service) => ({
        user_id: newUserId,
        service,
        granted_by: me.id,
      })) as never,
    );
  }

  revalidatePath('/admin/users');
  return { ok: true, data: { userId: newUserId } };
}

export async function setUserActive(
  userId: string,
  active: boolean,
): Promise<ActionResult> {
  const me = await requireAdmin();
  try {
    assertNotSelf(me.id, userId, 'deactivate');
    if (!active) {
      const supabase = createAdminClient();
      await assertNotLastActiveAdmin(supabase, userId, 'deactivate');
    }
  } catch (e) {
    if (e instanceof LockoutError) return { ok: false, error: e.message };
    throw e;
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('users')
    .update({ is_active: active } as never)
    .eq('id', userId);
  if (error) return { ok: false, error: error.message };

  await writeAuditLog(
    {
      userId: me.id,
      action: 'admin_user_set_active',
      metadata: { target_user_id: userId, active },
    },
    supabase,
    { allowFailure: true },
  );

  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true };
}

export async function setUserRole(
  userId: string,
  newRole: 'admin' | 'operator',
): Promise<ActionResult> {
  const me = await requireAdmin();
  const supabase = createAdminClient();

  try {
    if (newRole === 'operator') {
      assertNotSelf(me.id, userId, 'demote');
      await assertNotLastActiveAdmin(supabase, userId, 'demote');
    }
  } catch (e) {
    if (e instanceof LockoutError) return { ok: false, error: e.message };
    throw e;
  }

  const { data: current } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
    .returns<{ role: 'admin' | 'operator' } | null>();

  const { error } = await supabase
    .from('users')
    .update({ role: newRole } as never)
    .eq('id', userId);
  if (error) return { ok: false, error: error.message };

  await writeAuditLog(
    {
      userId: me.id,
      action: 'admin_user_set_role',
      metadata: { target_user_id: userId, from: current?.role ?? null, to: newRole },
    },
    supabase,
    { allowFailure: true },
  );

  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true };
}

export async function setUserPermission(
  userId: string,
  service: Service,
  granted: boolean,
): Promise<ActionResult> {
  const me = await requireAdmin();
  const supabase = createAdminClient();

  if (granted) {
    await supabase
      .from('user_service_permissions')
      .upsert(
        { user_id: userId, service, granted_by: me.id } as never,
        { onConflict: 'user_id,service' } as never,
      );
  } else {
    await supabase
      .from('user_service_permissions')
      .delete()
      .eq('user_id', userId)
      .eq('service', service);
  }

  await writeAuditLog(
    {
      userId: me.id,
      action: 'admin_user_permission_changed',
      metadata: { target_user_id: userId, service, granted },
    },
    supabase,
    { allowFailure: true },
  );

  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true };
}
