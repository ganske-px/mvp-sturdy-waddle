'use client';

import { SignOutButton } from '@/components/sign-out-button';
import { cn } from '@/lib/utils';
import { RadarIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/search', label: 'Buscar' },
  { href: '/bulk', label: 'Lote' },
  { href: '/history', label: 'Histórico' },
  { href: '/audit', label: 'Auditoria' },
] as const;

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative inline-flex h-9 items-center rounded-full px-3.5 text-[0.85rem] font-medium transition-colors',
        active
          ? 'bg-tertiary/60 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {label}
    </Link>
  );
}

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-6">
        <Link
          href="/"
          className="group flex items-center gap-2.5"
          aria-label="Radar PX — página inicial"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-card transition-transform group-hover:-rotate-6">
            <RadarIcon className="size-[18px]" strokeWidth={2.2} />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-heading text-[1.05rem] font-semibold tracking-tight text-foreground">
              Radar <span className="text-primary">PX</span>
            </span>
            <span className="hidden text-[0.65rem] font-medium uppercase tracking-[0.18em] text-muted-foreground sm:inline">
              KYC · KYB · KYE
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Principal">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} />
          ))}
        </nav>

        <SignOutButton />
      </div>
    </header>
  );
}
