'use client';

// components/antifraude/result-section.tsx
import { cn } from '@/lib/utils';
import { ChevronDownIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';

export type ResultSectionProps = {
  title: string;
  icon?: ReactNode;
  /** Veredito/contagem sempre visível no cabeçalho, ao lado do chevron. */
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
};

export function ResultSection({
  title,
  icon,
  summary,
  defaultOpen = false,
  children,
}: ResultSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <span className="flex items-center gap-2 font-medium text-foreground">
          {icon ? <span className="text-muted-foreground">{icon}</span> : null}
          {title}
        </span>
        <span className="flex items-center gap-3 text-sm text-muted-foreground">
          {summary}
          <ChevronDownIcon
            className={cn(
              'size-4 shrink-0 transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        </span>
      </button>
      {open ? <div className="border-t border-border/60 px-4 py-4">{children}</div> : null}
    </div>
  );
}
