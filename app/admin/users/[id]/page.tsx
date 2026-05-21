import { Button } from '@/components/ui/button';
import { ALL_SERVICES, type Service, requireAdmin } from '@/lib/auth/permissions';
import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import { setUserActive, setUserPermission, setUserRole } from '../actions';
import { UserForm, type UserFormValues } from '../user-form';

export const metadata = { title: 'Editar operador — Admin · Radar PX' };

export default async function EditUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireAdmin();
  const supabase = await createClient();

  const { data: user } = await supabase
    .from('users')
    .select('id, email, display_name, role, is_active')
    .eq('id', id)
    .maybeSingle()
    .returns<{
      id: string;
      email: string;
      display_name: string | null;
      role: 'admin' | 'operator';
      is_active: boolean;
    } | null>();
  if (!user) notFound();
  const currentUser = user;

  const { data: permRows } = await supabase
    .from('user_service_permissions')
    .select('service')
    .eq('user_id', id)
    .returns<{ service: Service }[]>();
  const permissions = (permRows ?? []).map((r) => r.service);

  const { count: otherActiveAdmins } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .eq('is_active', true)
    .neq('id', id);
  const isLastActiveAdmin =
    currentUser.role === 'admin' && (!otherActiveAdmins || otherActiveAdmins === 0);

  async function handleSubmit(values: UserFormValues) {
    'use server';

    if (values.role !== currentUser.role) {
      const r = await setUserRole(id, values.role);
      if (!r.ok) return r;
    }

    if (values.role !== 'admin') {
      const current = new Set(permissions);
      const next = new Set(values.permissions);
      for (const svc of ALL_SERVICES) {
        const wasGranted = current.has(svc);
        const isGranted = next.has(svc);
        if (wasGranted !== isGranted) {
          const r = await setUserPermission(id, svc, isGranted);
          if (!r.ok) return r;
        }
      }
    }

    redirect('/admin/users');
  }

  async function deactivate() {
    'use server';
    await setUserActive(id, false);
  }
  async function reactivate() {
    'use server';
    await setUserActive(id, true);
  }

  return (
    <main className="flex flex-col gap-6">
      {sp.created === '1' && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
          Operador criado. A senha temporária foi exibida na tela anterior — repasse pelo canal
          seguro.
        </div>
      )}

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
            Administração · Operadores
          </span>
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
            Editar operador
          </h1>
          <p className="text-muted-foreground">{currentUser.email}</p>
        </div>
        <form action={currentUser.is_active ? deactivate : reactivate}>
          <Button
            variant={currentUser.is_active ? 'destructive' : 'default'}
            disabled={currentUser.id === me.id || (currentUser.is_active && isLastActiveAdmin)}
            type="submit"
            title={
              currentUser.id === me.id
                ? 'Você não pode desativar a si mesmo'
                : currentUser.is_active && isLastActiveAdmin
                  ? 'Único admin ativo'
                  : undefined
            }
          >
            {currentUser.is_active ? 'Desativar' : 'Reativar'}
          </Button>
        </form>
      </header>

      <UserForm
        mode="edit"
        initial={{
          email: currentUser.email,
          display_name: currentUser.display_name ?? '',
          role: currentUser.role,
          permissions,
        }}
        isLastActiveAdmin={isLastActiveAdmin}
        onSubmit={handleSubmit}
      />
    </main>
  );
}
