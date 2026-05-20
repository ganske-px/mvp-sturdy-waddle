'use client';

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

const STATUS_LABELS: Record<JobRow['status'], string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

const ITEM_STATUS_LABELS: Record<ItemRow['status'], string> = {
  pending: 'Pending',
  processing: 'Processing',
  found: 'Processes found',
  clean: 'Clean',
  error: 'Error',
};

export function JobProgress({
  initialJob,
  initialItems,
}: { initialJob: JobRow; initialItems: ItemRow[] }) {
  const [job, setJob] = useState<JobRow>(initialJob);
  const [items, setItems] = useState<ItemRow[]>(initialItems);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
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
          setItems((prev) => prev.map((it) => (it.id === updated.id ? { ...it, ...updated } : it)));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [job.id]);

  const completedCount = job.done_items + job.error_items;
  const percent = job.total_items > 0 ? Math.round((completedCount / job.total_items) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">
          {STATUS_LABELS[job.status]} — {completedCount} of {job.total_items}
          {job.error_items > 0 ? ` (${job.error_items} errors)` : ''}
        </p>
        <p className="text-sm text-muted-foreground">{percent}%</p>
      </div>
      <Progress value={percent} />

      {job.error_message ? (
        <p role="alert" className="text-sm text-destructive">
          {job.error_message}
        </p>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Document</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Results</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((it) => (
            <TableRow key={it.id}>
              <TableCell className="font-mono text-xs">{it.document_preview}</TableCell>
              <TableCell className="uppercase">{it.document_type}</TableCell>
              <TableCell>
                {ITEM_STATUS_LABELS[it.status]}
                {it.error_message ? (
                  <span className="ml-2 text-destructive text-xs">— {it.error_message}</span>
                ) : null}
              </TableCell>
              <TableCell className="text-right">
                {it.status === 'pending' || it.status === 'processing'
                  ? '—'
                  : it.status === 'error'
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
