import { AppHeader } from '@/components/app-header';
import { listUserPermissions, requireAuth } from '@/lib/auth/permissions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  const permissions = await listUserPermissions(user.id);
  return (
    <>
      <AppHeader user={user} permissions={[...permissions]} />
      {children}
    </>
  );
}
