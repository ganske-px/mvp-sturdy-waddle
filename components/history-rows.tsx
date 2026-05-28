'use client';

import { Badge } from '@/components/ui/badge';
import { TableCell, TableRow } from '@/components/ui/table';
import { useRouter } from 'next/navigation';

type SearchRow = {
  id: string;
  document_hash: string;
  search_type: 'cpf' | 'cnpj' | 'name';
  term_preview: string;
  result_count: number;
  error_message: string | null;
  created_at: string;
};

const TYPE_LABELS: Record<SearchRow['search_type'], string> = {
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

export function HistoryRows({ searches }: { searches: SearchRow[] }) {
  const router = useRouter();
  return (
    <>
      {searches.map((s) => (
        <TableRow
          key={s.id}
          className="cursor-pointer hover:bg-muted/50"
          onClick={() => router.push(`/search/result/${encodeURIComponent(s.document_hash)}`)}
          aria-label={`Abrir resultado da consulta ${s.term_preview}`}
        >
          <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
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
          <TableCell className="text-right font-medium tabular-nums">{s.result_count}</TableCell>
        </TableRow>
      ))}
    </>
  );
}
