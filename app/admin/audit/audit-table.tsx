'use client';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMemo, useState } from 'react';

export type AuditAction =
  | 'login'
  | 'logout'
  | 'search_single'
  | 'search_bulk_item'
  | 'bulk_job_created'
  | 'export_csv'
  | 'admin_user_created'
  | 'admin_user_set_active'
  | 'admin_user_set_role'
  | 'admin_user_permission_changed';

export type AuditRow = {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action: AuditAction;
  search_type: 'cpf' | 'cnpj' | 'name' | null;
  document_hash: string | null;
  result_count: number | null;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const ACTION_LABELS: Record<AuditAction, string> = {
  login: 'Login',
  logout: 'Logout',
  search_single: 'Busca avulsa',
  search_bulk_item: 'Item de lote',
  bulk_job_created: 'Lote criado',
  export_csv: 'Exportação CSV',
  admin_user_created: 'Operador criado',
  admin_user_set_active: 'Ativação alterada',
  admin_user_set_role: 'Papel alterado',
  admin_user_permission_changed: 'Permissão alterada',
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

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  const [filterEmail, setFilterEmail] = useState('');
  const [filterAction, setFilterAction] = useState<'all' | AuditAction>('all');

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterAction !== 'all' && r.action !== filterAction) return false;
      if (filterEmail && !(r.user_email ?? '').includes(filterEmail.toLowerCase())) return false;
      return true;
    });
  }, [rows, filterEmail, filterAction]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Filtrar por e-mail"
          value={filterEmail}
          onChange={(e) => setFilterEmail(e.target.value.toLowerCase())}
          className="max-w-xs"
        />
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value as 'all' | AuditAction)}
          className="rounded-md border border-input bg-background px-3 py-1 text-sm"
        >
          <option value="all">Todas as ações</option>
          {(Object.entries(ACTION_LABELS) as [AuditAction, string][]).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Quando</TableHead>
            <TableHead>Operador</TableHead>
            <TableHead>Ação</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Hash do documento</TableHead>
            <TableHead>IP</TableHead>
            <TableHead className="text-right">Resultados</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                {formatDateTime(r.created_at)}
              </TableCell>
              <TableCell className="text-muted-foreground">{r.user_email ?? '—'}</TableCell>
              <TableCell>
                <Badge variant="outline" size="sm">
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
                {truncateHash(r.document_hash)}
              </TableCell>
              <TableCell className="font-mono text-xs">{r.ip ?? '—'}</TableCell>
              <TableCell className="text-right tabular-nums">
                {r.result_count !== null ? r.result_count : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
