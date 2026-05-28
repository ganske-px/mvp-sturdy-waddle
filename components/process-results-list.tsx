'use client';

import { EntityListItem } from '@/components/entity-list-item';
import { ProcessDetail } from '@/components/process-detail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { PredictusProcess } from '@/lib/predictus/types';
import { ArrowRightIcon } from 'lucide-react';

type AssuntoCNJ = { titulo?: string; ePrincipal?: boolean };

function tribunalShort(t: PredictusProcess['tribunal']): string {
  if (!t) return '—';
  if (typeof t === 'object') return t.sigla ?? t.nome ?? '—';
  return t;
}

function classeShort(c: PredictusProcess['classeProcessual']): string | null {
  if (!c) return null;
  if (typeof c === 'object') return c.nome ?? null;
  return c;
}

function principalAssunto(p: PredictusProcess): string | null {
  const assuntos = (Array.isArray(p.assuntosCNJ) ? p.assuntosCNJ : []) as AssuntoCNJ[];
  if (assuntos.length === 0) return null;
  const principal = assuntos.find((a) => a.ePrincipal) ?? assuntos[0];
  return principal?.titulo ?? null;
}

function processStatus(p: PredictusProcess): string | null {
  const sp = p.statusPredictus as { statusProcesso?: string } | undefined;
  if (sp?.statusProcesso) return sp.statusProcesso;
  return typeof p.statusObservacao === 'string' ? p.statusObservacao : null;
}

function ramoLabel(p: PredictusProcess): string | null {
  const sp = p.statusPredictus as { ramoDireito?: string } | undefined;
  const ramo = sp?.ramoDireito;
  if (!ramo) return null;
  // "DIREITO PENAL" → "PENAL"; encurta para caber na coluna.
  return ramo.replace(/^DIREITO\s+/i, '');
}

function foroLine(p: PredictusProcess): string {
  const parts = [tribunalShort(p.tribunal)];
  if (typeof p.grauProcesso === 'number') parts.push(`${p.grauProcesso}ª instância`);
  return parts.join(' · ');
}

export function ProcessResultsList({ results }: { results: PredictusProcess[] }) {
  return (
    <div>
      {results.map((p, i) => {
        const status = processStatus(p);
        const tramitando = !!status && /TRAMITA|MOVIMENTO/i.test(status);
        const assunto = principalAssunto(p);
        const classe = classeShort(p.classeProcessual);
        const ramo = ramoLabel(p);
        return (
          <EntityListItem
            key={`${p.numeroProcessoUnico ?? 'no-num'}-${i}`}
            action={
              <Sheet>
                <SheetTrigger
                  render={
                    <Button variant="ghost" size="sm" className="shrink-0 text-primary">
                      Detalhes
                      <ArrowRightIcon className="ml-1 size-3" />
                    </Button>
                  }
                />
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>Processo</SheetTitle>
                    <SheetDescription className="font-mono">
                      {p.numeroProcessoUnico ?? '—'}
                    </SheetDescription>
                  </SheetHeader>
                  <SheetBody>
                    <ProcessDetail process={p} />
                  </SheetBody>
                </SheetContent>
              </Sheet>
            }
          >
            <div className="grid grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)] items-start gap-x-6">
              {/* Coluna 1 — identificação */}
              <div className="flex flex-col gap-1.5">
                <span className="flex h-5 items-center text-sm font-medium">
                  {p.numeroProcessoUnico ?? '—'}
                </span>
                <span className="text-[0.7rem] text-muted-foreground">{foroLine(p)}</span>
              </div>

              {/* Coluna 2 — badges (linha 1) + assunto (linha 2) */}
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex h-5 items-center gap-1.5">
                  {ramo ? <Badge variant="outline">{ramo}</Badge> : null}
                  {status ? (
                    <Badge variant={tramitando ? 'warning' : 'muted'}>{status}</Badge>
                  ) : null}
                </div>
                <span
                  className="line-clamp-1 text-xs text-foreground/90"
                  title={assunto ?? undefined}
                >
                  {assunto ?? '—'}
                </span>
              </div>

              {/* Coluna 3 — classe (linha 2) */}
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="h-5" aria-hidden />
                <span
                  className="line-clamp-1 text-xs text-muted-foreground"
                  title={classe ?? undefined}
                >
                  {classe ?? '—'}
                </span>
              </div>
            </div>
          </EntityListItem>
        );
      })}
    </div>
  );
}
