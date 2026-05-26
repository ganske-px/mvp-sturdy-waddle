// components/antifraude/pep-card.tsx
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { PepCardProps } from './types';

export function PepCard({
  status,
  currentlyPEP,
  currentlySanctioned,
  historicoCount,
}: PepCardProps) {
  const skeleton = status === 'pending' || status === 'running';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">PEP / Sanções</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {skeleton ? (
          <>
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </>
        ) : status === 'error' ? (
          <p className="text-muted-foreground">Indisponível.</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Sancionado:</span>
              {currentlySanctioned ? (
                <Badge variant="destructive">Sim</Badge>
              ) : (
                <Badge variant="secondary">Não</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">PEP:</span>
              {currentlyPEP ? (
                <Badge variant="destructive">Sim</Badge>
              ) : (
                <Badge variant="secondary">Não</Badge>
              )}
            </div>
            <div>
              <span className="text-muted-foreground">Histórico:</span> {historicoCount ?? 0}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
