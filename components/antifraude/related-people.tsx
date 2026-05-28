'use client';

// components/antifraude/related-people.tsx
import { deepenDocument } from '@/app/(app)/search/deepen/actions';
import { EntityListItem } from '@/components/entity-list-item';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { relationshipLabel } from '@/lib/netrin/relationship-labels';
import { ArrowRightIcon } from 'lucide-react';
import { useTransition } from 'react';
import type { RelatedPersonEntry } from './types';

export type RelatedPeopleProps = {
  status: 'missing' | 'running' | 'success' | 'error';
  parentCpfHash: string;
  currentPath?: string;
  people: RelatedPersonEntry[];
  bare?: boolean;
};

export function RelatedPeople({
  status,
  parentCpfHash,
  currentPath,
  people,
  bare,
}: RelatedPeopleProps) {
  const [isPending, startTransition] = useTransition();

  const body =
    status === 'running' ? (
      <>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </>
    ) : status === 'error' ? (
      <p className="text-muted-foreground">Indisponível.</p>
    ) : status === 'missing' ? (
      <p className="text-muted-foreground">Sem dados.</p>
    ) : people.length === 0 ? (
      <p className="text-muted-foreground">Nenhuma pessoa relacionada identificada.</p>
    ) : (
      <div>
        {people.map((p, i) => (
          <EntityListItem
            key={`${p.cpfHash}-${i}`}
            action={
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending}
                className="shrink-0 text-primary"
                onClick={() => {
                  startTransition(async () => {
                    await deepenDocument({
                      docType: 'cpf-relacionado',
                      cpfHash: p.cpfHash,
                      parentCpfHash,
                      currentPath,
                    });
                  });
                }}
              >
                {p.hasCached ? 'Ver detalhes' : 'Aprofundar'}
                <ArrowRightIcon className="ml-1 size-3" />
              </Button>
            }
          >
            <span className="font-medium">{p.nome ?? 'Nome não informado'}</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{p.maskedPreview}</span>
              <Badge variant="outline">{relationshipLabel(p.tipoRelacionamento)}</Badge>
            </div>
          </EntityListItem>
        ))}
      </div>
    );

  if (bare) return <div className="space-y-2 text-sm">{body}</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pessoas relacionadas ({people.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">{body}</CardContent>
    </Card>
  );
}
