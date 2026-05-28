// components/antifraude/media-card.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MediaDrawer } from './media-drawer';
import type { MediaCardProps } from './types';

export function MediaCard({
  status,
  mencoes,
  qtdMidias,
  qtdListas,
  qtdGov,
  qtdAmb,
  mediaDetail,
  bare,
}: MediaCardProps) {
  const skeleton = status === 'pending' || status === 'running';
  const body = skeleton ? (
    <Skeleton className="h-4 w-1/3" />
  ) : status === 'error' ? (
    <p className="text-muted-foreground">Indisponível.</p>
  ) : (
    <div className="flex items-center justify-between gap-2">
      <div className="space-y-2">
        <div>
          <span className="text-muted-foreground">Menções:</span> {mencoes ?? 0}
        </div>
        <div>
          <span className="text-muted-foreground">Mídias:</span> {qtdMidias ?? 0}
        </div>
        <div>
          <span className="text-muted-foreground">Listas restritivas:</span> {qtdListas ?? 0}
        </div>
        <div>
          <span className="text-muted-foreground">Governamentais:</span> {qtdGov ?? 0}
        </div>
        <div>
          <span className="text-muted-foreground">Socioambientais:</span> {qtdAmb ?? 0}
        </div>
      </div>
      {status === 'success' && mediaDetail ? <MediaDrawer detail={mediaDetail} /> : null}
    </div>
  );

  if (bare) return <div className="space-y-2 text-sm">{body}</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mídia &amp; risco reputacional</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">{body}</CardContent>
    </Card>
  );
}
