import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type Service, requireAdmin } from '@/lib/auth/permissions';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { type UserRow, UsersTable } from './users-table';

export const metadata = { title: 'Operadores — Admin · Radar PX' };

export default async function UsersListPage() {
  const me = await requireAdmin();
  const supabase = await createClient();

  const { data: users } = await supabase
    .from('users')
    .select('id, email, display_name, role, is_active')
    .order('created_at', { ascending: false })
    .returns<
      {
        id: string;
        email: string;
        display_name: string | null;
        role: 'admin' | 'operator';
        is_active: boolean;
      }[]
    >();

  const { data: perms } = await supabase
    .from('user_service_permissions')
    .select('user_id, service')
    .returns<{ user_id: string; service: Service }[]>();

  const permsByUser = new Map<string, Service[]>();
  for (const p of perms ?? []) {
    const list = permsByUser.get(p.user_id) ?? [];
    list.push(p.service);
    permsByUser.set(p.user_id, list);
  }

  const rows: UserRow[] = (users ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    display_name: u.display_name,
    role: u.role,
    is_active: u.is_active,
    permissions: permsByUser.get(u.id) ?? [],
    is_self: u.id === me.id,
  }));

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
            Administração
          </span>
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
            Operadores
          </h1>
          <p className="text-muted-foreground">Gestão de contas internas e suas permissões.</p>
        </div>
        <Link href="/admin/users/new" className={buttonVariants({ variant: 'default' })}>
          + Novo operador
        </Link>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Todos os operadores</CardTitle>
        </CardHeader>
        <CardContent>
          <UsersTable rows={rows} />
        </CardContent>
      </Card>
    </main>
  );
}
