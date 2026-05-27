'use client';

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
import type { PepHistoryEntry } from '@/lib/netrin/parsers/pep-detail';
import type { SanctionMatch } from '@/lib/netrin/parsers/sanctions-detail';
import { ArrowRightIcon, InfoIcon } from 'lucide-react';
import { ExpandableText } from './expandable-text';

function matchRateVariant(rate: number): 'destructive' | 'warning' | 'muted' {
  // Abaixo de 80% é provável homônimo: chip apagado para não chamar atenção.
  if (rate < 80) return 'muted';
  if (rate >= 90) return 'destructive';
  return 'warning';
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm text-foreground/90">{value}</span>
    </div>
  );
}

export function PepSancoesDrawer({
  sanctions,
  pepHistory,
  currentlySanctioned,
}: {
  sanctions: SanctionMatch[];
  pepHistory: PepHistoryEntry[];
  currentlySanctioned?: boolean;
}) {
  const total = sanctions.length + pepHistory.length;
  if (total === 0) return null;

  // Maior similaridade primeiro; sem matchRate vai para o fim.
  const sortedSanctions = [...sanctions].sort((a, b) => (b.matchRate ?? -1) - (a.matchRate ?? -1));

  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="ghost" size="sm" className="shrink-0 text-primary">
            Ver {total} registro{total === 1 ? '' : 's'}
            <ArrowRightIcon className="ml-1 size-3" />
          </Button>
        }
      />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>PEP / Sanções — detalhe</SheetTitle>
          <SheetDescription>
            {sanctions.length} sanç{sanctions.length === 1 ? 'ão' : 'ões'} · {pepHistory.length}{' '}
            registro{pepHistory.length === 1 ? '' : 's'} PEP
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-6">
          {sanctions.length > 0 && !currentlySanctioned ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300/40 bg-amber-50/60 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
              <InfoIcon className="mt-0.5 size-4 shrink-0" />
              <span>
                Sem sanção confirmada. Os itens abaixo são{' '}
                <strong>matches por similaridade de nome</strong> (possíveis homônimos). Avalie o
                percentual de similaridade, nome, nascimento e nacionalidade antes de concluir.
              </span>
            </div>
          ) : null}

          {sanctions.length > 0 ? (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Sanções ({sanctions.length})
              </h3>
              <ul className="space-y-3">
                {sortedSanctions.map((s, i) => (
                  <li
                    key={`${s.source ?? 'src'}-${s.sanctionName ?? i}-${i}`}
                    className="rounded-xl border border-border/60 bg-card p-3"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      {s.source ? <Badge variant="outline">{s.source}</Badge> : null}
                      {s.standardizedSanctionType ? (
                        <Badge variant="secondary">{s.standardizedSanctionType}</Badge>
                      ) : s.type ? (
                        <Badge variant="secondary">{s.type}</Badge>
                      ) : null}
                      {typeof s.matchRate === 'number' ? (
                        <Badge variant={matchRateVariant(s.matchRate)} className="ml-auto">
                          {s.matchRate}% similaridade
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <Field label="Nome buscado" value={s.originalName} />
                      <Field label="Nome na lista" value={s.sanctionName} />
                      <Field label="Nascimento" value={s.birthDate ?? s.standardizedBirthDate} />
                      <Field label="Nacionalidade" value={s.nationalities} />
                    </div>
                    {s.charges ? (
                      <div className="mt-3">
                        <span className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
                          Acusações
                        </span>
                        <ExpandableText text={s.charges} className="mt-0.5" />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {pepHistory.length > 0 ? (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Histórico PEP ({pepHistory.length})
              </h3>
              <ul className="space-y-3">
                {pepHistory.map((p, i) => (
                  <li
                    key={`${p.jobTitle ?? 'pep'}-${i}`}
                    className="rounded-xl border border-border/60 bg-card p-3"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      {p.jobTitle ? <Badge variant="info">{p.jobTitle}</Badge> : null}
                      {p.source ? <Badge variant="outline">{p.source}</Badge> : null}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <Field label="Órgão" value={p.department} />
                      <Field label="Nível" value={p.level} />
                      <Field label="Motivo" value={p.motive} />
                      <Field label="Documento" value={p.document ?? p.documentPEP} />
                      <Field label="Início" value={p.startDate} />
                      <Field label="Fim" value={p.endDate} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
