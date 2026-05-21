import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  title: 'Auditoria — Radar PX',
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
  login: 'Entrada',
  logout: 'Saída',
  search_single: 'Consulta individual',
  search_bulk_item: 'Item de lote',
  bulk_job_created: 'Job criado',
  export_csv: 'Exportação CSV',
};

type ActionBadgeVariant = 'default' | 'secondary' | 'outline' | 'muted' | 'info' | 'purple';

const ACTION_VARIANTS: Record<AuditRow['action'], ActionBadgeVariant> = {
  login: 'info',
  logout: 'muted',
  search_single: 'default',
  search_bulk_item: 'default',
  bulk_job_created: 'purple',
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
      <header className="flex flex-col gap-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
          Conformidade · LGPD
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          Auditoria
        </h1>
        <p className="text-muted-foreground">
          Suas próprias ações, retidas por 30 dias. Hashes de documentos são SHA-256 — o CPF ou CNPJ
          original nunca é armazenado aqui.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Últimos 200 eventos</CardTitle>
          <CardDescription>
            Cada operação é registrada antes da chamada externa, com IP do operador.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              Falha ao carregar auditoria: {error.message}
            </p>
          ) : !rows || rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/30 py-10">
              <ShieldCheckIcon className="size-8 text-muted-foreground/60" />
              <p className="text-sm font-medium">Nenhum evento ainda</p>
              <p className="text-xs text-muted-foreground">
                Suas ações aparecem aqui conforme você usa o aplicativo.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Hash do documento</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead className="text-right">Resultados</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {formatDateTime(r.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ACTION_VARIANTS[r.action]} size="sm">
                        {ACTION_LABELS[r.action]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {r.search_type ? (
                        <Badge variant="outline" size="sm">
                          {r.search_type.toUpperCase()}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                      <div className="flex items-center gap-2">
                        <span>{truncateHash(r.document_hash)}</span>
                        {r.metadata && typeof r.metadata.cached === 'boolean' ? (
                          <Badge variant={r.metadata.cached ? 'info' : 'success'} size="sm">
                            {r.metadata.cached ? 'cache' : 'fresco'}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.ip ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">
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
