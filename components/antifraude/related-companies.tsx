// components/antifraude/related-companies.tsx
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { mask as maskCnpj } from '@/lib/validators/cnpj';
import type { RelatedCompaniesProps } from './types';

export function RelatedCompanies({ status, items }: RelatedCompaniesProps) {
  const skeleton = status === 'pending' || status === 'running';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Empresas relacionadas ({items.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {skeleton ? (
          <>
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-2/3" />
          </>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground">Nenhuma empresa vinculada.</p>
        ) : (
          items.map((c) => (
            <div key={c.cnpj} className="border-t pt-2 first:border-t-0 first:pt-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{c.razaoSocial ?? 'Empresa'}</span>
                <span className="text-muted-foreground">{maskCnpj(c.cnpj)}</span>
                {c.vinculo ? <Badge variant="outline">{c.vinculo}</Badge> : null}
                {!c.ativo ? <Badge variant="secondary">encerrado</Badge> : null}
              </div>
              {c.hop2 ? (
                <div className="text-xs text-muted-foreground mt-1 flex gap-3 flex-wrap">
                  {c.hop2.situacaoCadastral ? (
                    <span>Situação: {c.hop2.situacaoCadastral}</span>
                  ) : null}
                  {typeof c.hop2.capitalSocial === 'number' ? (
                    <span>Capital: R$ {c.hop2.capitalSocial.toLocaleString('pt-BR')}</span>
                  ) : null}
                  {c.hop2.sancionado ? <Badge variant="destructive">sancionada</Badge> : null}
                  {c.hop2.sociosCpfHashes?.length ? (
                    <span>{c.hop2.sociosCpfHashes.length} sócios</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
