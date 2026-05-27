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
import type { MediaDetail, MediaListItem } from '@/lib/netrin/parsers/media-detail';
import { ArrowRightIcon, ExternalLinkIcon } from 'lucide-react';
import { ExpandableText } from './expandable-text';

function ListSection({ title, items }: { title: string; items: MediaListItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {title} ({items.length})
      </h3>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li
            key={`${Object.values(item).join('|')}-${i}`}
            className="rounded-lg border border-border/60 bg-card px-3 py-2 text-xs"
          >
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              {Object.entries(item).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</dt>
                  <dd className="text-foreground/90">{v}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MediaDrawer({ detail }: { detail: MediaDetail }) {
  const { mentions, restritivas, governamentais, socioambientais } = detail;
  const total =
    mentions.length + restritivas.length + governamentais.length + socioambientais.length;
  if (total === 0) return null;

  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="ghost" size="sm" className="shrink-0 text-primary">
            Ver menções
            <ArrowRightIcon className="ml-1 size-3" />
          </Button>
        }
      />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Mídia & risco reputacional — detalhe</SheetTitle>
          <SheetDescription>
            {mentions.length} menç{mentions.length === 1 ? 'ão' : 'ões'} na imprensa
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-6">
          {mentions.length > 0 ? (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Menções na imprensa ({mentions.length})
              </h3>
              <ul className="space-y-3">
                {mentions.map((m, i) => (
                  <li
                    key={`${m.titulo ?? 'midia'}-${i}`}
                    className="rounded-xl border border-border/60 bg-card p-3"
                  >
                    {m.titulo ? <p className="font-medium text-foreground">{m.titulo}</p> : null}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      {m.fonte ? <span>{m.fonte}</span> : null}
                      {m.dataNoticia ? <span>· {m.dataNoticia}</span> : null}
                      {m.uf ? <span>· {m.uf}</span> : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {m.tipoSuspeita ? <Badge variant="warning">{m.tipoSuspeita}</Badge> : null}
                      {m.envolvimento ? <Badge variant="outline">{m.envolvimento}</Badge> : null}
                      {m.atividade ? <Badge variant="secondary">{m.atividade}</Badge> : null}
                    </div>
                    {m.nomeCpf ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Citado: {m.nomeCpf}
                        {m.cpfMascarado ? ` (${m.cpfMascarado})` : ''}
                      </p>
                    ) : null}
                    {m.citacao ? <ExpandableText text={m.citacao} className="mt-2" /> : null}
                    {m.linkNoticia ? (
                      <a
                        href={m.linkNoticia}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        <ExternalLinkIcon className="size-3" /> Ler na fonte
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <ListSection title="Listas restritivas" items={restritivas} />
          <ListSection title="Listas governamentais" items={governamentais} />
          <ListSection title="Listas socioambientais" items={socioambientais} />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
