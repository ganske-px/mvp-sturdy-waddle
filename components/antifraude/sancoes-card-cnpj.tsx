// components/antifraude/sancoes-card-cnpj.tsx
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

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
  const algumProblema = sancionado || ceisAtivos > 0 || cnepAtivos > 0 || trabalhoEscravo;

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
    ) : !algumProblema ? (
      <Badge variant="success">Sem restrições</Badge>
    ) : (
      <div className="flex flex-wrap gap-1">
        {sancionado ? <Badge variant="destructive">Sancionado</Badge> : null}
        {ceisAtivos > 0 ? <Badge variant="destructive">CEIS: {ceisAtivos} ativo(s)</Badge> : null}
        {cnepAtivos > 0 ? <Badge variant="destructive">CNEP: {cnepAtivos} ativo(s)</Badge> : null}
        {trabalhoEscravo ? <Badge variant="destructive">Trabalho escravo</Badge> : null}
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
