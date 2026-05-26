// components/antifraude/identity-card.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { IdentityCardProps } from './types';

export function IdentityCard({
  status,
  nome,
  dataNascimento,
  situacaoCadastral,
}: IdentityCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Identidade</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {status === 'pending' || status === 'running' ? (
          <>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </>
        ) : status === 'error' ? (
          <p className="text-muted-foreground">Indisponível.</p>
        ) : status === 'missing' ? (
          <p className="text-muted-foreground">Sem dados.</p>
        ) : (
          <>
            <div>
              <span className="text-muted-foreground">Nome:</span> {nome ?? '—'}
            </div>
            <div>
              <span className="text-muted-foreground">Nascimento:</span> {dataNascimento ?? '—'}
            </div>
            <div>
              <span className="text-muted-foreground">Situação:</span> {situacaoCadastral ?? '—'}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
