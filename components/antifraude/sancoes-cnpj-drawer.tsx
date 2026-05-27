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
import type { CnpjSanctionEntry } from '@/lib/netrin/parsers/cnpj-sanctions-detail';
import { countSanctions } from '@/lib/netrin/parsers/cnpj-sanctions-detail';

function SanctionList({ title, entries }: { title: string; entries: CnpjSanctionEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {title} ({entries.length})
      </h3>
      <ul className="space-y-2">
        {entries.map((e, i) => (
          <li
            key={`${e.descricao ?? 'sem-descricao'}-${e.ativo}-${i}`}
            className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-card px-3 py-2"
          >
            <span className="text-sm text-foreground/90">
              {e.descricao ?? 'Sanção sem descrição'}
            </span>
            {e.ativo ? (
              <Badge variant="destructive">Ativa</Badge>
            ) : (
              <Badge variant="muted">Inativa</Badge>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SancoesCnpjDrawer({
  ceis = [],
  cnep = [],
  trabalhoEscravo,
}: {
  ceis?: CnpjSanctionEntry[];
  cnep?: CnpjSanctionEntry[];
  trabalhoEscravo?: boolean;
}) {
  const counts = countSanctions({ ceis, cnep });
  if (counts.total === 0 && !trabalhoEscravo) return null;

  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            Ver {counts.total} registro{counts.total === 1 ? '' : 's'}
          </Button>
        }
      />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Sanções e restrições — detalhe</SheetTitle>
          <SheetDescription>
            CEIS: {counts.ceisAtivos} ativa(s) / {counts.ceisInativos} inativa(s) · CNEP:{' '}
            {counts.cnepAtivos} ativa(s) / {counts.cnepInativos} inativa(s)
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-6">
          {trabalhoEscravo ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Consta na lista de trabalho escravo.
            </div>
          ) : null}
          <SanctionList title="CEIS — Empresas inidôneas e suspensas" entries={ceis} />
          <SanctionList title="CNEP — Empresas punidas" entries={cnep} />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
