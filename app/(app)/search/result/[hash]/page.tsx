import { NetworkCta } from '@/components/network-cta';
import { ProcessResultsTable } from '@/components/process-results-table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listUserPermissions, requireAuth } from '@/lib/auth/permissions';
import { getCachedResults } from '@/lib/predictus/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { AlertCircleIcon, ClockIcon, SearchIcon } from 'lucide-react';
import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Resultado da consulta — Radar PX',
};

const TYPE_LABELS: Record<'cpf' | 'cnpj' | 'name', string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  name: 'Nome',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type SearchRow = {
  search_type: 'cpf' | 'cnpj' | 'name';
  term_preview: string;
  created_at: string;
  result_count: number;
  error_message: string | null;
};

export default async function ResultPage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const user = await requireAuth();
  const { hash } = await params;
  const documentHash = decodeURIComponent(hash);

  const supabase = await createClient();
  const { data: searchRow } = await supabase
    .from('searches')
    .select('search_type, term_preview, created_at, result_count, error_message')
    .eq('document_hash', documentHash)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
    .returns<SearchRow>();

  if (!searchRow) {
    redirect('/history');
  }

  const admin = createAdminClient();
  let cached: Awaited<ReturnType<typeof getCachedResults>> = null;
  try {
    cached = await getCachedResults(admin, documentHash);
  } catch (e) {
    console.warn('result page: cache lookup failed', e);
  }

  const perms = await listUserPermissions(user.id);
  const canSeeNetwork = user.role === 'admin' || perms.has('search_network');
  const networkHash = searchRow.search_type === 'name' ? null : documentHash;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
          Consulta arquivada
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          {searchRow.term_preview}
        </h1>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle>
                {TYPE_LABELS[searchRow.search_type]} · {searchRow.result_count} resultado
                {searchRow.result_count === 1 ? '' : 's'}
              </CardTitle>
              <CardDescription>
                Pesquisada em {formatDateTime(searchRow.created_at)}.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {cached ? (
                <Badge variant="info">
                  <ClockIcon />
                  Em cache
                </Badge>
              ) : null}
              <NetworkCta networkHash={networkHash} canSeeNetwork={canSeeNetwork} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {searchRow.error_message ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{searchRow.error_message}</span>
            </div>
          ) : !cached ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/30 py-10">
              <SearchIcon className="size-8 text-muted-foreground/60" />
              <p className="text-sm font-medium">Resultados não estão mais em cache</p>
              <p className="text-xs text-muted-foreground">
                O cache tem TTL de 30 dias. Refaça a busca para ver os processos atualizados.
              </p>
            </div>
          ) : cached.results.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/30 py-10">
              <SearchIcon className="size-8 text-muted-foreground/60" />
              <p className="text-sm font-medium">Nenhum processo encontrado</p>
              <p className="text-xs text-muted-foreground">
                O documento aparentava estar limpo na fonte de dados.
              </p>
            </div>
          ) : (
            <ProcessResultsTable results={cached.results} />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
