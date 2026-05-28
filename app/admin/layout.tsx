import { AppHeader } from '@/components/app-header';
import { listUserPermissions, requireAdmin } from '@/lib/auth/permissions';

export const metadata = { title: 'Admin — Radar PX' };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const permissions = await listUserPermissions(user.id);
  return (
    <>
      <AppHeader user={user} permissions={[...permissions]} />
      <div className="mx-auto w-full max-w-6xl px-6 py-12">{children}</div>
    </>
  );
}
