// components/antifraude/pep-card.tsx
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PepSancoesDrawer } from './pep-sancoes-drawer';
import type { PepCardProps } from './types';

export function PepCard({
  status,
  currentlyPEP,
  currentlySanctioned,
  previouslySanctioned,
  historicoCount,
  sanctions,
  pepHistory,
  bare,
}: PepCardProps) {
  const skeleton = status === 'pending' || status === 'running';
  const body = skeleton ? (
    <>
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-1/3" />
    </>
  ) : status === 'error' ? (
    <p className="text-muted-foreground">Indisponível.</p>
  ) : (
    <div className="flex items-center justify-between gap-2">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">PEP atual:</span>
          {currentlyPEP ? (
            <Badge variant="destructive">Sim</Badge>
          ) : (
            <Badge variant="secondary">Não</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Sancionado atual:</span>
          {currentlySanctioned ? (
            <Badge variant="destructive">Sim</Badge>
          ) : (
            <Badge variant="secondary">Não</Badge>
          )}
        </div>
        {previouslySanctioned ? (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Sanção pregressa:</span>
            <Badge variant="outline">Sim</Badge>
          </div>
        ) : null}
        <div>
          <span className="text-muted-foreground">Histórico:</span> {historicoCount ?? 0} registros
        </div>
      </div>
      {status === 'success' ? (
        <PepSancoesDrawer
          sanctions={sanctions ?? []}
          pepHistory={pepHistory ?? []}
          currentlySanctioned={currentlySanctioned}
        />
      ) : null}
    </div>
  );

  if (bare) return <div className="space-y-2 text-sm">{body}</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">PEP / Sanções</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">{body}</CardContent>
    </Card>
  );
}
