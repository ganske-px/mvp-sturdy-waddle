'use client';

import { cn } from '@/lib/utils';
import { useState } from 'react';

/**
 * Inline expand/collapse for long free text (charges, citação). Collapsed by
 * default with a line-clamp; the toggle is a discreet inline link.
 */
export function ExpandableText({
  text,
  className,
  clampLines = 3,
}: {
  text: string;
  className?: string;
  clampLines?: 2 | 3 | 4;
}) {
  const [open, setOpen] = useState(false);
  const clamp = open
    ? ''
    : clampLines === 2
      ? 'line-clamp-2'
      : clampLines === 4
        ? 'line-clamp-4'
        : 'line-clamp-3';
  return (
    <div className={className}>
      <p className={cn('whitespace-pre-line text-sm text-foreground/90', clamp)}>{text}</p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-1 text-xs font-medium text-primary hover:underline"
      >
        {open ? 'Mostrar menos' : 'Ler completo'}
      </button>
    </div>
  );
}
