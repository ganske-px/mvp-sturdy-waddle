import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRightIcon, ClockIcon, LayersIcon, SearchIcon, ShieldCheckIcon } from 'lucide-react';
import Link from 'next/link';

type Module = {
  href: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  domain: { label: string; variant: 'info' | 'success' | 'purple' | 'muted' };
};

const PRIMARY: Module[] = [
  {
    href: '/search',
    title: 'Busca individual',
    description: 'Consulta única por CPF, CNPJ ou nome.',
    icon: SearchIcon,
    domain: { label: 'KYC · KYB · KYE', variant: 'info' },
  },
  {
    href: '/bulk',
    title: 'Busca em lote',
    description: 'CSV com até 250 documentos por execução.',
    icon: LayersIcon,
    domain: { label: 'Operação', variant: 'purple' },
  },
];

const SECONDARY: Module[] = [
  {
    href: '/history',
    title: 'Histórico',
    description: 'Suas últimas 100 consultas, com previews mascarados.',
    icon: ClockIcon,
    domain: { label: '30 dias', variant: 'muted' },
  },
  {
    href: '/audit',
    title: 'Auditoria',
    description: 'Trilha de eventos do operador, hashes SHA-256.',
    icon: ShieldCheckIcon,
    domain: { label: 'LGPD', variant: 'success' },
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

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-14">
      <header className="flex flex-col gap-3">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
          PX Center · Compliance
        </span>
        <h1 className="font-heading text-4xl font-semibold tracking-tight text-foreground sm:text-[2.75rem]">
          Background check sob radar.
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          Consulte processos judiciais por CPF, CNPJ ou nome via Predictus — com cache, auditoria e
          rate-limit já integrados. Pensado para checagens de KYC, KYB e KYE.
        </p>
      </header>

      <section aria-label="Módulos principais">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PRIMARY.map((mod) => (
            <ModuleCard key={mod.href} mod={mod} primary />
          ))}
        </div>
      </section>

      <section aria-label="Auxiliares" className="flex flex-col gap-4">
        <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Apoio à operação
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {SECONDARY.map((mod) => (
            <ModuleCard key={mod.href} mod={mod} />
          ))}
        </div>
      </section>

      <footer className="border-t border-border/60 pt-6 text-xs text-muted-foreground">
        Dados retidos por 30 dias · CPF e CNPJ nunca persistidos em texto claro.
      </footer>
    </main>
  );
}
