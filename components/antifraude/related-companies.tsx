// components/antifraude/related-companies.tsx
import { deepenDocument } from '@/app/(app)/search/deepen/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { mask as maskCnpj } from '@/lib/validators/cnpj';
import { ArrowRightIcon } from 'lucide-react';
import type { RelatedCompaniesProps } from './types';

async function handleDeepen(formData: FormData) {
  'use server';
  const cnpjRaw = String(formData.get('cnpjRaw') ?? '');
  const currentPath = String(formData.get('currentPath') ?? '');
  await deepenDocument({
    docType: 'cnpj',
    cnpjRaw,
    currentPath: currentPath || undefined,
  });
}

export function RelatedCompanies({ status, items, currentPath }: RelatedCompaniesProps) {
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
              <div className="flex items-center gap-2 flex-wrap justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{c.razaoSocial ?? 'Empresa'}</span>
                  <span className="text-muted-foreground">{maskCnpj(c.cnpj)}</span>
                  {c.vinculo ? <Badge variant="outline">{c.vinculo}</Badge> : null}
                  {!c.ativo ? <Badge variant="secondary">encerrado</Badge> : null}
                </div>
                <form action={handleDeepen}>
                  <input type="hidden" name="cnpjRaw" value={c.cnpj} />
                  <input type="hidden" name="currentPath" value={currentPath ?? ''} />
                  <Button type="submit" size="sm" variant={c.hop2 ? 'outline' : 'default'}>
                    {c.hop2 ? 'Ver detalhes' : 'Aprofundar'}
                    <ArrowRightIcon className="ml-1 size-3" />
                  </Button>
                </form>
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
