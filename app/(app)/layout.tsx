import { AppHeader } from '@/components/app-header';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="radar-surface min-h-screen flex flex-col">
      <AppHeader />
      <div className="flex-1">{children}</div>
    </div>
  );
}
