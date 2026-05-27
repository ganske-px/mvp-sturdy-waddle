'use client';

// components/antifraude/socios-card.tsx
import { deepenDocument } from '@/app/(app)/search/deepen/actions';
import { EntityListItem } from '@/components/entity-list-item';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowRightIcon } from 'lucide-react';
import { useTransition } from 'react';

export type SocioEntry = {
  cpfHash: string;
  maskedPreview: string;
  nome?: string;
  vinculo?: string;
  percentual?: number;
  hasCached: boolean;
};

export type SociosCardProps = {
  status: 'missing' | 'running' | 'success' | 'error';
  parentCnpjHash: string;
  currentPath?: string;
  socios: SocioEntry[];
  bare?: boolean;
};

export function SociosCard({ status, parentCnpjHash, currentPath, socios, bare }: SociosCardProps) {
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
    ) : socios.length === 0 ? (
      <p className="text-muted-foreground">Nenhum sócio identificado.</p>
    ) : (
      <div>
        {socios.map((s, i) => (
          <EntityListItem
            key={`${s.cpfHash}-${i}`}
            action={
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending}
                className="shrink-0 text-primary"
                onClick={() => {
                  startTransition(async () => {
                    await deepenDocument({
                      docType: 'cpf-socio',
                      cpfHash: s.cpfHash,
                      parentCnpjHash,
                      currentPath,
                    });
                  });
                }}
              >
                {s.hasCached ? 'Ver detalhes' : 'Aprofundar'}
                <ArrowRightIcon className="ml-1 size-3" />
              </Button>
            }
          >
            <span className="font-medium">{s.nome ?? 'Nome não informado'}</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{s.maskedPreview}</span>
              {s.vinculo ? <Badge variant="outline">{s.vinculo}</Badge> : null}
              {typeof s.percentual === 'number' ? (
                <Badge variant="outline">{s.percentual}%</Badge>
              ) : null}
            </div>
          </EntityListItem>
        ))}
      </div>
    );

  if (bare) return <div className="space-y-2 text-sm">{body}</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sócios ({socios.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">{body}</CardContent>
    </Card>
  );
}
