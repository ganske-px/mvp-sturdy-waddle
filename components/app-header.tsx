'use client';

import { SignOutButton } from '@/components/sign-out-button';
import type { AppUser, Service } from '@/lib/auth/permissions';
import { cn } from '@/lib/utils';
import { RadarIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavItem = { href: string; label: string; gate?: Service | 'admin' };

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/search/person', label: 'Pessoa', gate: 'search_person' },
  { href: '/search/company', label: 'Empresa', gate: 'search_company' },
  { href: '/bulk', label: 'Lote', gate: 'search_bulk' },
  { href: '/history', label: 'Histórico' },
  { href: '/admin/users', label: 'Operadores', gate: 'admin' },
  { href: '/admin/audit', label: 'Auditoria', gate: 'admin' },
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

function isVisible(item: NavItem, user: AppUser, permissions: ReadonlySet<Service>): boolean {
  if (!item.gate) return true;
  if (item.gate === 'admin') return user.role === 'admin';
  if (user.role === 'admin') return true;
  return permissions.has(item.gate);
}

export function AppHeader({
  user,
  permissions,
}: {
  user: AppUser;
  permissions: readonly Service[];
}) {
  const permSet = new Set(permissions);
  const visible = NAV_ITEMS.filter((i) => isVisible(i, user, permSet));
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
          {visible.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} />
          ))}
        </nav>

        <SignOutButton />
      </div>
    </header>
  );
}
