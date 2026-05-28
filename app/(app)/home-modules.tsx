'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Service } from '@/lib/auth/permissions';
import {
  ArrowRightIcon,
  Building2Icon,
  ClockIcon,
  LayersIcon,
  SearchIcon,
  ShieldCheckIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';

type DomainVariant = 'info' | 'success' | 'purple' | 'muted' | 'dark-blue';

type Module = {
  href: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  domain: { label: string; variant: DomainVariant };
  gate: Service | 'admin' | null;
};

const PRIMARY: Module[] = [
  {
    href: '/search/person',
    title: 'Buscar pessoa',
    description: 'Consulta processual por CPF ou nome.',
    icon: SearchIcon,
    domain: { label: 'KYC · KYE', variant: 'info' },
    gate: 'search_person',
  },
  {
    href: '/search/company',
    title: 'Buscar empresa',
    description: 'Consulta processual por CNPJ.',
    icon: Building2Icon,
    domain: { label: 'KYB', variant: 'dark-blue' },
    gate: 'search_company',
  },
  {
    href: '/bulk',
    title: 'Busca em lote',
    description: 'CSV com até 250 documentos por execução.',
    icon: LayersIcon,
    domain: { label: 'Operação', variant: 'purple' },
    gate: 'search_bulk',
  },
];

const SECONDARY: Module[] = [
  {
    href: '/history',
    title: 'Histórico',
    description: 'Suas últimas 100 consultas, com previews mascarados.',
    icon: ClockIcon,
    domain: { label: '30 dias', variant: 'muted' },
    gate: null,
  },
  {
    href: '/admin/users',
    title: 'Operadores',
    description: 'Criar, ativar e gerenciar permissões.',
    icon: UsersIcon,
    domain: { label: 'Admin', variant: 'info' },
    gate: 'admin',
  },
  {
    href: '/admin/audit',
    title: 'Auditoria',
    description: 'Trilha global de eventos, hashes SHA-256.',
    icon: ShieldCheckIcon,
    domain: { label: 'LGPD · Admin', variant: 'success' },
    gate: 'admin',
  },
];

function ModuleCard({ mod, primary }: { mod: Module; primary?: boolean }) {
  const Icon = mod.icon;
  return (
    <Link href={mod.href} className="group">
      <Card
        className={
          primary
            ? 'h-full transition-all hover:-translate-y-0.5 hover:shadow-elevated'
            : 'h-full transition-all hover:border-primary/30 hover:bg-card hover:shadow-elevated'
        }
      >
        <CardHeader>
          <div className="flex items-start justify-between">
            <span
              className={
                primary
                  ? 'grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground shadow-card'
                  : 'grid size-11 place-items-center rounded-xl bg-tertiary/60 text-primary'
              }
            >
              <Icon className="size-[20px]" strokeWidth={2.1} />
            </span>
            <Badge variant={mod.domain.variant} size="sm">
              {mod.domain.label}
            </Badge>
          </div>
          <CardTitle className="mt-3">{mod.title}</CardTitle>
          <CardDescription>{mod.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <span className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-transform group-hover:translate-x-0.5">
            Abrir
            <ArrowRightIcon className="size-3.5" />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

function isVisible(mod: Module, role: 'admin' | 'operator', perms: ReadonlySet<Service>): boolean {
  if (mod.gate === null) return true;
  if (mod.gate === 'admin') return role === 'admin';
  if (role === 'admin') return true;
  return perms.has(mod.gate);
}

export function HomeModules({
  role,
  permissions,
}: {
  role: 'admin' | 'operator';
  permissions: readonly Service[];
}) {
  const permSet = new Set(permissions);
  const visiblePrimary = PRIMARY.filter((m) => isVisible(m, role, permSet));
  const visibleSecondary = SECONDARY.filter((m) => isVisible(m, role, permSet));

  if (visiblePrimary.length === 0 && role === 'operator') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-base font-medium">Sua conta está ativa.</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Você ainda não tem nenhum serviço habilitado. Fale com um administrador para liberar
            Buscar pessoa, Buscar empresa ou Busca em lote.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {visiblePrimary.length > 0 && (
        <section aria-label="Módulos principais">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visiblePrimary.map((mod) => (
              <ModuleCard key={mod.href} mod={mod} primary />
            ))}
          </div>
        </section>
      )}

      {visibleSecondary.length > 0 && (
        <section aria-label="Auxiliares" className="flex flex-col gap-4">
          <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Apoio à operação
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleSecondary.map((mod) => (
              <ModuleCard key={mod.href} mod={mod} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
