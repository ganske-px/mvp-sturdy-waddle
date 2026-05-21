import { AppHeader } from '@/components/app-header';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      {children}
    </>
  );
}
