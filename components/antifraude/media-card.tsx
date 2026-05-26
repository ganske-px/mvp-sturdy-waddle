// components/antifraude/media-card.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { MediaCardProps } from './types';

export function MediaCard({
  status,
  mencoes,
  qtdMidias,
  qtdListas,
  qtdGov,
  qtdAmb,
}: MediaCardProps) {
  const skeleton = status === 'pending' || status === 'running';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mídia &amp; risco reputacional</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {skeleton ? (
          <Skeleton className="h-4 w-1/3" />
        ) : status === 'error' ? (
          <p className="text-muted-foreground">Indisponível.</p>
        ) : (
          <>
            <div className="text-base font-medium">
              {mencoes ?? 0} <span className="text-muted-foreground text-sm">menções</span>
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>Mídias: {qtdMidias ?? 0}</li>
              <li>Listas restritivas: {qtdListas ?? 0}</li>
              <li>Governamentais: {qtdGov ?? 0}</li>
              <li>Socioambientais: {qtdAmb ?? 0}</li>
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
