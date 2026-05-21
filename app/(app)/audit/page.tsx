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
import { ShieldCheckIcon } from 'lucide-react';

export const metadata = {
  title: 'Audit — PX Process Check',
};

type AuditRow = {
  id: string;
  action:
    | 'login'
    | 'logout'
    | 'search_single'
    | 'search_bulk_item'
    | 'bulk_job_created'
    | 'export_csv';
  search_type: 'cpf' | 'cnpj' | 'name' | null;
  document_hash: string | null;
  result_count: number | null;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const ACTION_LABELS: Record<AuditRow['action'], string> = {
  login: 'Login',
  logout: 'Logout',
  search_single: 'Single search',
  search_bulk_item: 'Bulk search item',
  bulk_job_created: 'Bulk job created',
  export_csv: 'CSV export',
};

type ActionBadgeVariant = 'default' | 'secondary' | 'outline' | 'muted' | 'info';

const ACTION_VARIANTS: Record<AuditRow['action'], ActionBadgeVariant> = {
  login: 'info',
  logout: 'muted',
  search_single: 'default',
  search_bulk_item: 'default',
  bulk_job_created: 'secondary',
  export_csv: 'outline',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function truncateHash(hash: string | null): string {
  if (!hash) return '—';
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

export default async function AuditPage() {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from('audit_log')
    .select('id, action, search_type, document_hash, result_count, ip, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(200)
    .returns<AuditRow[]>();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-muted-foreground">
          Your own actions, retained for 30 days. Document hashes are SHA-256; the original CPF or
          CNPJ is never stored here.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Last 200 events</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <p role="alert" className="text-destructive">
              Failed to load audit: {error.message}
            </p>
          ) : !rows || rows.length === 0 ? (
            <div className="flex flex-col items-center py-10">
              <ShieldCheckIcon className="size-8 text-muted-foreground/60" />
              <p className="mt-2 text-sm font-medium">No audit events yet</p>
              <p className="text-xs text-muted-foreground">
                Your actions appear here as you use the app.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Document hash</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead className="text-right">Results</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {formatDateTime(r.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ACTION_VARIANTS[r.action]}>{ACTION_LABELS[r.action]}</Badge>
                    </TableCell>
                    <TableCell>
                      {r.search_type ? (
                        <Badge variant="outline" className="uppercase tracking-wider">
                          {r.search_type}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                      {truncateHash(r.document_hash)}
                      {r.metadata && typeof r.metadata.cached === 'boolean' ? (
                        <Badge variant={r.metadata.cached ? 'info' : 'success'} className="ml-2">
                          {r.metadata.cached ? 'cached' : 'fresh'}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.ip ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      {r.result_count !== null ? r.result_count : '—'}
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
