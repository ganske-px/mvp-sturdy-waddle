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

export const metadata = {
  title: 'History — PX Process Check',
};

const TYPE_LABELS: Record<'cpf' | 'cnpj' | 'name', string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  name: 'Name',
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
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">History</h1>
        <p className="text-muted-foreground">Your last 100 searches.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Searches</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <p role="alert" className="text-destructive">
              Failed to load history: {error.message}
            </p>
          ) : !searches || searches.length === 0 ? (
            <p className="text-muted-foreground">No searches yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Term</TableHead>
                  <TableHead className="text-right">Results</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {searches.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(s.created_at)}
                    </TableCell>
                    <TableCell>{TYPE_LABELS[s.search_type]}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.term_preview}
                      {s.error_message ? (
                        <span className="ml-2 text-destructive">(error)</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">{s.result_count}</TableCell>
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
