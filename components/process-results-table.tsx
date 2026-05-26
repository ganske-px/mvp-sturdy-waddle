'use client';

import { ProcessDetail } from '@/components/process-detail';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { PredictusProcess } from '@/lib/predictus/types';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { Fragment, useState } from 'react';

function formatBRL(value: number | string | undefined): string {
  if (value === undefined || value === null || value === '') return '—';
  const num = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(num)) return String(value);
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function tribunalShort(t: PredictusProcess['tribunal']): string {
  if (!t) return '—';
  if (typeof t === 'object') return t.sigla ?? t.nome ?? '—';
  return t;
}

function classeShort(c: PredictusProcess['classeProcessual']): string {
  if (!c) return '—';
  if (typeof c === 'object') return c.nome ?? '—';
  return c;
}

export function ProcessResultsTable({ results }: { results: PredictusProcess[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[260px]">Processo</TableHead>
          <TableHead className="w-[96px]">Tribunal</TableHead>
          <TableHead>Classe</TableHead>
          <TableHead className="w-[140px] text-right">Valor</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {results.map((p, i) => {
          const isOpen = expandedIdx === i;
          return (
            <Fragment key={`${p.numeroProcessoUnico ?? 'no-num'}-${i}`}>
              <TableRow
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => setExpandedIdx(isOpen ? null : i)}
                aria-expanded={isOpen}
              >
                <TableCell className="font-mono text-xs">
                  <span className="inline-flex items-center gap-1.5">
                    {isOpen ? (
                      <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
                    )}
                    <span>{p.numeroProcessoUnico ?? '—'}</span>
                  </span>
                </TableCell>
                <TableCell className="text-sm">{tribunalShort(p.tribunal)}</TableCell>
                <TableCell className="whitespace-normal text-sm text-muted-foreground">
                  <span className="line-clamp-2">{classeShort(p.classeProcessual)}</span>
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatBRL(p.valorCausa?.valor)}
                </TableCell>
              </TableRow>
              {isOpen ? (
                <TableRow className="bg-muted/20 hover:bg-muted/20">
                  <TableCell colSpan={4}>
                    <ProcessDetail process={p} />
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
