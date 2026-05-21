'use client';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Service } from '@/lib/auth/permissions';
import Link from 'next/link';
import { useTransition } from 'react';
import { setUserActive } from './actions';

export type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'operator';
  is_active: boolean;
  permissions: Service[];
  is_self: boolean;
};

const SERVICE_LABEL: Record<Service, string> = {
  search_person: 'Pessoa',
  search_company: 'Empresa',
  search_bulk: 'Lote',
  search_network: 'Rede',
};

export function UsersTable({ rows }: { rows: UserRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nome</TableHead>
          <TableHead>E-mail</TableHead>
          <TableHead>Papel</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Permissões</TableHead>
          <TableHead className="text-right">Ações</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <UserRowView key={r.id} row={r} />
        ))}
      </TableBody>
    </Table>
  );
}

function UserRowView({ row }: { row: UserRow }) {
  const [pending, start] = useTransition();
  return (
    <TableRow>
      <TableCell className="font-medium">{row.display_name ?? '—'}</TableCell>
      <TableCell className="text-muted-foreground">{row.email}</TableCell>
      <TableCell>
        <Badge variant={row.role === 'admin' ? 'info' : 'outline'}>
          {row.role === 'admin' ? 'Admin' : 'Operador'}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge variant={row.is_active ? 'success' : 'muted'}>
          {row.is_active ? 'Ativo' : 'Inativo'}
        </Badge>
      </TableCell>
      <TableCell className="text-xs">
        {row.role === 'admin' ? (
          <span className="text-muted-foreground">(todas)</span>
        ) : row.permissions.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          row.permissions.map((s) => SERVICE_LABEL[s]).join(', ')
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Link
            href={`/admin/users/${row.id}`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Editar
          </Link>
          <Button
            type="button"
            variant={row.is_active ? 'destructive' : 'default'}
            size="sm"
            disabled={pending || row.is_self}
            title={row.is_self ? 'Você não pode desativar a si mesmo' : undefined}
            onClick={() =>
              start(async () => {
                await setUserActive(row.id, !row.is_active);
              })
            }
          >
            {row.is_active ? 'Desativar' : 'Reativar'}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
