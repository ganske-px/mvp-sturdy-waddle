'use client';

// components/antifraude/socios-card.tsx
import { deepenDocument } from '@/app/(app)/search/deepen/actions';
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
      <ul className="flex flex-col gap-2">
        {socios.map((s, i) => (
          <li
            key={`${s.cpfHash}-${i}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2"
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{s.nome ?? 'Nome não informado'}</span>
              <span className="text-xs text-muted-foreground">{s.maskedPreview}</span>
              <div className="flex flex-wrap gap-1">
                {s.vinculo ? <Badge variant="outline">{s.vinculo}</Badge> : null}
                {typeof s.percentual === 'number' ? (
                  <Badge variant="outline">{s.percentual}%</Badge>
                ) : null}
              </div>
            </div>
            <Button
              variant={s.hasCached ? 'outline' : 'default'}
              size="sm"
              disabled={isPending}
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
          </li>
        ))}
      </ul>
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
