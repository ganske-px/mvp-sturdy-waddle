// components/antifraude/identity-card-cnpj.tsx
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export type IdentityCardCnpjProps = {
  status: 'missing' | 'running' | 'success' | 'error';
  razaoSocial?: string;
  nomeFantasia?: string;
  situacaoCadastral?: string;
  capitalSocial?: number;
  atividadePrincipal?: string;
  dataAbertura?: string;
};

function formatCurrency(v: number | undefined): string | undefined {
  if (typeof v !== 'number') return undefined;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function IdentityCardCnpj({
  status,
  razaoSocial,
  nomeFantasia,
  situacaoCadastral,
  capitalSocial,
  atividadePrincipal,
  dataAbertura,
}: IdentityCardCnpjProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Identidade da empresa</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {status === 'running' ? (
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
              <span className="text-muted-foreground">Razão social:</span> {razaoSocial ?? '—'}
            </div>
            {nomeFantasia ? (
              <div>
                <span className="text-muted-foreground">Nome fantasia:</span> {nomeFantasia}
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Situação:</span>
              {situacaoCadastral ? (
                <Badge
                  variant={
                    situacaoCadastral.toLowerCase().includes('ativa') ? 'success' : 'destructive'
                  }
                >
                  {situacaoCadastral}
                </Badge>
              ) : (
                '—'
              )}
            </div>
            {typeof capitalSocial === 'number' ? (
              <div>
                <span className="text-muted-foreground">Capital social:</span>{' '}
                {formatCurrency(capitalSocial)}
              </div>
            ) : null}
            {atividadePrincipal ? (
              <div>
                <span className="text-muted-foreground">Atividade:</span> {atividadePrincipal}
              </div>
            ) : null}
            {dataAbertura ? (
              <div>
                <span className="text-muted-foreground">Abertura:</span> {dataAbertura}
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
