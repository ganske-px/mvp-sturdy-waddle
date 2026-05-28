'use client';

import type { Service } from '@/lib/auth/permissions';
import { type DetectionState, detect } from '@/lib/search/detect';
import { cn } from '@/lib/utils';
import { ArrowRightIcon, CornerDownLeftIcon } from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';
import { searchByCnpj } from './search/company/actions';
import { searchPerson } from './search/person/actions';

type Role = 'admin' | 'operator';

const TYPE_LABEL: Record<'cpf' | 'cnpj' | 'name', string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  name: 'Nome',
};

function hasPermissionFor(
  type: 'cpf' | 'cnpj' | 'name',
  role: Role,
  permissions: ReadonlySet<Service>,
): boolean {
  if (role === 'admin') return true;
  if (type === 'cnpj') return permissions.has('search_company');
  return permissions.has('search_person');
}

type Status = {
  tone: 'idle' | 'pending' | 'ready' | 'invalid' | 'denied';
  badge?: string;
  message: string;
};

function deriveStatus(detection: DetectionState, role: Role, perms: ReadonlySet<Service>): Status {
  if (detection.kind === 'empty') {
    return {
      tone: 'idle',
      message: 'Digite um CPF, CNPJ ou nome para começar.',
    };
  }
  if (detection.kind === 'pending') {
    return { tone: 'pending', message: detection.hint };
  }
  if (detection.kind === 'invalid') {
    return { tone: 'invalid', badge: TYPE_LABEL[detection.type], message: detection.error };
  }
  if (!hasPermissionFor(detection.type, role, perms)) {
    const what = detection.type === 'cnpj' ? 'consultar empresas' : 'consultar pessoas';
    return {
      tone: 'denied',
      badge: TYPE_LABEL[detection.type],
      message: `Sua conta não tem permissão para ${what}. Fale com um administrador.`,
    };
  }
  return {
    tone: 'ready',
    badge: TYPE_LABEL[detection.type],
    message: 'Pressione Enter para consultar.',
  };
}

export function SmartSearch({
  role,
  permissions,
}: {
  role: Role;
  permissions: readonly Service[];
}) {
  const [value, setValue] = useState('');
  const [isPending, startTransition] = useTransition();

  const permSet = useMemo(() => new Set(permissions), [permissions]);
  const detection = useMemo(() => detect(value), [value]);
  const status = useMemo(() => deriveStatus(detection, role, permSet), [detection, role, permSet]);

  const canSubmit = status.tone === 'ready' && detection.kind === 'ready' && !isPending;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (detection.kind !== 'ready') return;
    const { type, normalized } = detection;
    startTransition(async () => {
      if (type === 'cnpj') {
        await searchByCnpj({ rawInput: normalized });
      } else {
        await searchPerson({ type, rawInput: normalized });
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      // biome-ignore lint/a11y/useSemanticElements: <search> element wraps form; using role on the form provides equivalent semantics with simpler markup
      role="search"
      aria-label="Consulta de pessoa ou empresa"
      className="flex w-full flex-col items-stretch gap-6"
    >
      <div className="relative">
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          // biome-ignore lint/a11y/noAutofocus: hero input is the page's primary action; intentional focus on load
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="CPF, CNPJ ou nome…"
          aria-label="Termo de busca"
          className={cn(
            'w-full appearance-none bg-transparent text-foreground placeholder:text-muted-foreground/45 outline-none',
            'font-heading tracking-tight',
            'text-[2.25rem] leading-[1.15] sm:text-[3rem] lg:text-[3.5rem]',
            'border-b-2 px-1 pb-4 pt-2 transition-colors',
            status.tone === 'invalid' || status.tone === 'denied'
              ? 'border-destructive/70 focus:border-destructive'
              : status.tone === 'ready'
                ? 'border-primary/70 focus:border-primary'
                : 'border-border/70 focus:border-foreground/50',
          )}
        />
        {canSubmit && (
          <button
            type="submit"
            aria-label="Consultar"
            className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-card transition-all hover:-translate-y-[calc(50%+1px)] hover:shadow-elevated"
          >
            Consultar
            <ArrowRightIcon className="size-4" />
          </button>
        )}
      </div>

      <div
        // biome-ignore lint/a11y/useSemanticElements: live status region inline with the input — no semantic HTML element matches
        role="status"
        aria-live="polite"
        className={cn(
          'flex flex-wrap items-center gap-3 text-sm transition-colors',
          status.tone === 'invalid' || status.tone === 'denied'
            ? 'text-destructive'
            : status.tone === 'ready'
              ? 'text-primary'
              : 'text-muted-foreground',
        )}
      >
        {status.badge && (
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wider',
              status.tone === 'ready'
                ? 'bg-primary/10 text-primary border border-primary/20'
                : status.tone === 'invalid' || status.tone === 'denied'
                  ? 'bg-destructive/10 text-destructive border border-destructive/20'
                  : 'bg-muted text-muted-foreground border border-border/60',
            )}
          >
            {status.badge}
          </span>
        )}
        <span className="font-mono text-[0.85rem]">{status.message}</span>
        {status.tone === 'ready' && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
            <CornerDownLeftIcon className="size-3.5" />
            Enter
          </span>
        )}
      </div>
    </form>
  );
}
