// components/antifraude/sancoes-card-cnpj.tsx
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SancoesCnpjDrawer } from './sancoes-cnpj-drawer';

export type SancoesCardCnpjProps = {
  status: 'missing' | 'running' | 'success' | 'error';
  sancionado?: boolean;
  ceis?: { ativo: boolean; descricao?: string }[];
  cnep?: { ativo: boolean; descricao?: string }[];
  trabalhoEscravo?: boolean;
  bare?: boolean;
};

export function SancoesCardCnpj({
  status,
  sancionado,
  ceis,
  cnep,
  trabalhoEscravo,
  bare,
}: SancoesCardCnpjProps) {
  const ceisAtivos = (ceis ?? []).filter((c) => c.ativo).length;
  const cnepAtivos = (cnep ?? []).filter((c) => c.ativo).length;

  const body =
    status === 'running' ? (
      <>
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
      </>
    ) : status === 'error' ? (
      <p className="text-muted-foreground">Indisponível.</p>
    ) : status === 'missing' ? (
      <p className="text-muted-foreground">Sem dados.</p>
    ) : (
      <div className="flex items-center justify-between gap-2">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Sancionado:</span>
            {sancionado ? (
              <Badge variant="destructive">Sim</Badge>
            ) : (
              <Badge variant="secondary">Não</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">CEIS:</span>
            {ceisAtivos > 0 ? (
              <Badge variant="destructive">{ceisAtivos} ativo(s)</Badge>
            ) : (
              <Badge variant="secondary">Nenhum</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">CNEP:</span>
            {cnepAtivos > 0 ? (
              <Badge variant="destructive">{cnepAtivos} ativo(s)</Badge>
            ) : (
              <Badge variant="secondary">Nenhum</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Trabalho escravo:</span>
            {trabalhoEscravo ? (
              <Badge variant="destructive">Sim</Badge>
            ) : (
              <Badge variant="secondary">Não</Badge>
            )}
          </div>
        </div>
        <SancoesCnpjDrawer ceis={ceis} cnep={cnep} trabalhoEscravo={trabalhoEscravo} />
      </div>
    );

  if (bare) return <div className="space-y-2 text-sm">{body}</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sanções e restrições</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">{body}</CardContent>
    </Card>
  );
}
