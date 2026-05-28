'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRightIcon, RouteIcon, XIcon } from 'lucide-react';
import Link from 'next/link';
import type { PathBetweenDto } from './actions';

export function PathResultPanel({
  result,
  onClear,
}: {
  result: PathBetweenDto | null;
  onClear: () => void;
}) {
  if (!result) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <RouteIcon className="size-4" />
          {result.found ? `Caminho — ${result.hops} salto(s)` : 'Sem caminho'}
        </CardTitle>
        <button type="button" onClick={onClear} aria-label="Limpar caminho">
          <XIcon className="size-4 text-muted-foreground hover:text-foreground" />
        </button>
      </CardHeader>
      <CardContent>
        {!result.found ? (
          <p className="text-xs text-muted-foreground">
            Não há conexão conhecida entre os dois documentos no grafo atual.
          </p>
        ) : (
          <ol className="space-y-1">
            {result.nodes.map((n, idx) => (
              <li key={n.hash} className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{idx + 1}</span>
                <Link
                  href={`/network/${encodeURIComponent(n.hash)}`}
                  className="flex flex-1 items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 text-xs transition-colors hover:bg-muted"
                >
                  <span className="truncate font-medium">{n.label.name ?? n.maskedPreview}</span>
                  <span className="text-[0.65rem] uppercase text-muted-foreground">{n.type}</span>
                </Link>
                {idx < result.nodes.length - 1 ? (
                  <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground" />
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
