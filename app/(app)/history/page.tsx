import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { createClient } from '@/lib/supabase/server';
import { SearchIcon } from 'lucide-react';

export const metadata = {
  title: 'Histórico — Radar PX',
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
  id: string;
  search_type: 'cpf' | 'cnpj' | 'name';
  term_preview: string;
  result_count: number;
  error_message: string | null;
  created_at: string;
};

export default async function HistoryPage() {
  const supabase = await createClient();
  const { data: searches, error } = await supabase
    .from('searches')
    .select('id, search_type, term_preview, result_count, error_message, created_at')
    .order('created_at', { ascending: false })
    .limit(100)
    .returns<SearchRow[]>();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
          Suas consultas
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          Histórico
        </h1>
        <p className="text-muted-foreground">Últimas 100 consultas realizadas por você.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Consultas recentes</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              Falha ao carregar histórico: {error.message}
            </p>
          ) : !searches || searches.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/30 py-10">
              <SearchIcon className="size-8 text-muted-foreground/60" />
              <p className="text-sm font-medium">Nenhuma consulta ainda</p>
              <p className="text-xs text-muted-foreground">
                Execute sua primeira busca para ver o histórico aqui.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Termo</TableHead>
                  <TableHead className="text-right">Resultados</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {searches.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {formatDateTime(s.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" size="sm">
                        {TYPE_LABELS[s.search_type]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{s.term_preview}</span>
                        {s.error_message ? (
                          <Badge variant="destructive" size="sm">
                            erro
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {s.result_count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
