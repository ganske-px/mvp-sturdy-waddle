// components/antifraude/restrictions-card.tsx
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { RestrictionsCardProps } from './types';

export function RestrictionsCard({ status, apostasImpedido }: RestrictionsCardProps) {
  const skeleton = status === 'pending' || status === 'running';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Restrições</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {skeleton ? (
          <Skeleton className="h-4 w-1/3" />
        ) : status === 'error' ? (
          <p className="text-muted-foreground">Indisponível.</p>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Apostas:</span>
            {apostasImpedido ? (
              <Badge variant="destructive">Impedido</Badge>
            ) : (
              <Badge variant="secondary">Sem restrição</Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
