// components/antifraude/media-card.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { MediaCardProps } from './types';

export function MediaCard({ status, mencoes, itens }: MediaCardProps) {
  const skeleton = status === 'pending' || status === 'running';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mídia negativa</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {skeleton ? (
          <Skeleton className="h-4 w-1/3" />
        ) : status === 'error' ? (
          <p className="text-muted-foreground">Indisponível.</p>
        ) : (
          <>
            <div>{mencoes ?? 0} menções</div>
            {itens?.slice(0, 5).map((it, idx) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: mídia items têm apenas título; sem id estável disponível
              <div key={idx} className="border-t pt-2">
                <div className="font-medium">{it.titulo}</div>
                {it.data ? <div className="text-muted-foreground text-xs">{it.data}</div> : null}
              </div>
            )) ?? null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
