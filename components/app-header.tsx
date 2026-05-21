'use client';

import { SignOutButton } from '@/components/sign-out-button';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/search', label: 'Search' },
  { href: '/bulk', label: 'Bulk' },
  { href: '/history', label: 'History' },
  { href: '/audit', label: 'Audit' },
] as const;

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
      )}
    >
      {label}
    </Link>
  );
}

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-6 px-6">
        <Link href="/" className="flex items-baseline gap-2 font-semibold tracking-tight">
          <span>PX Process Check</span>
          <span className="hidden text-xs font-normal text-muted-foreground sm:inline">
            internal
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} />
          ))}
        </nav>

        <SignOutButton />
      </div>
    </header>
  );
}
