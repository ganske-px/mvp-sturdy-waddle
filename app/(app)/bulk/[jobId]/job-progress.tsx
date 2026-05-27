'use client';

import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { createClient } from '@/lib/supabase/client';
import { AlertCircleIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

type JobRow = {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  total_items: number;
  done_items: number;
  error_items: number;
  error_message: string | null;
};

type ItemRow = {
  id: string;
  document_type: 'cpf' | 'cnpj';
  document_preview: string;
  status: 'pending' | 'processing' | 'found' | 'clean' | 'error';
  result_count: number;
  error_message: string | null;
};

type BadgeVariant = 'muted' | 'info' | 'success' | 'warning' | 'destructive';

const STATUS_LABELS: Record<JobRow['status'], string> = {
  pending: 'Pendente',
  running: 'Em execução',
  completed: 'Concluído',
  failed: 'Falhou',
};

const STATUS_VARIANTS: Record<JobRow['status'], BadgeVariant> = {
  pending: 'muted',
  running: 'info',
  completed: 'success',
  failed: 'destructive',
};

const ITEM_STATUS_LABELS: Record<ItemRow['status'], string> = {
  pending: 'Pendente',
  processing: 'Processando',
  found: 'Processos encontrados',
  clean: 'Limpo',
  error: 'Erro',
};

const ITEM_STATUS_VARIANTS: Record<ItemRow['status'], BadgeVariant> = {
  pending: 'muted',
  processing: 'info',
  found: 'warning',
  clean: 'success',
  error: 'destructive',
};

const PROGRESS_INDICATOR_CLASSES: Record<JobRow['status'], string> = {
  pending: '[&_[data-slot=progress-indicator]]:bg-primary',
  running: '[&_[data-slot=progress-indicator]]:bg-primary',
  completed: '[&_[data-slot=progress-indicator]]:bg-success',
  failed: '[&_[data-slot=progress-indicator]]:bg-destructive',
};

export function JobProgress({
  initialJob,
  initialItems,
}: { initialJob: JobRow; initialItems: ItemRow[] }) {
  const [job, setJob] = useState<JobRow>(initialJob);
  const [items, setItems] = useState<ItemRow[]>(initialItems);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let cancelled = false;

    void (async () => {
      // postgres_changes on RLS-protected tables only delivers events when the
      // realtime socket carries the user's JWT. The SSR browser client does not
      // forward the cookie session to the socket on its own, so set it here —
      // otherwise the socket is anon and RLS filters every event out.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session?.access_token) await supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`bulk-job-${job.id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'bulk_jobs', filter: `id=eq.${job.id}` },
          (payload) => {
            setJob((prev) => ({ ...prev, ...(payload.new as Partial<JobRow>) }));
          },
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'bulk_job_items',
            filter: `job_id=eq.${job.id}`,
          },
          (payload) => {
            const updated = payload.new as ItemRow;
            setItems((prev) =>
              prev.map((it) => (it.id === updated.id ? { ...it, ...updated } : it)),
            );
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [job.id]);

  const completedCount = job.done_items + job.error_items;
  const percent = job.total_items > 0 ? Math.round((completedCount / job.total_items) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Badge variant={STATUS_VARIANTS[job.status]}>{STATUS_LABELS[job.status]}</Badge>
            <span className="text-sm font-medium tabular-nums">
              {completedCount} de {job.total_items}
              {job.error_items > 0 ? (
                <span className="text-destructive"> · {job.error_items} erros</span>
              ) : null}
            </span>
          </div>
          <p className="text-2xl font-heading font-semibold tabular-nums text-primary">
            {percent}%
          </p>
        </div>
        <Progress value={percent} className={PROGRESS_INDICATOR_CLASSES[job.status]} />
      </div>

      {job.error_message ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <span>{job.error_message}</span>
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Documento</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Resultados</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((it) => (
            <TableRow key={it.id}>
              <TableCell className="font-mono text-xs">{it.document_preview}</TableCell>
              <TableCell>
                <Badge variant="outline" size="sm">
                  {it.document_type.toUpperCase()}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-0.5">
                  <Badge variant={ITEM_STATUS_VARIANTS[it.status]} size="sm">
                    {ITEM_STATUS_LABELS[it.status]}
                  </Badge>
                  {it.error_message ? (
                    <span className="text-xs text-muted-foreground">{it.error_message}</span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {it.status === 'pending' || it.status === 'processing' || it.status === 'error'
                  ? '—'
                  : it.result_count}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
