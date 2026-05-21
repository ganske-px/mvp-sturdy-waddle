import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { JobProgress } from './job-progress';

type JobRow = {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  total_items: number;
  done_items: number;
  error_items: number;
  error_message: string | null;
  created_at: string;
};

type ItemRow = {
  id: string;
  document_type: 'cpf' | 'cnpj';
  document_preview: string;
  status: 'pending' | 'processing' | 'found' | 'clean' | 'error';
  result_count: number;
  error_message: string | null;
};

export default async function BulkJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const supabase = await createClient();

  const { data, error: jobError } = await supabase
    .from('bulk_jobs')
    .select('id, status, total_items, done_items, error_items, error_message, created_at')
    .eq('id', jobId)
    .single()
    .returns<JobRow>();

  if (jobError || !data) {
    notFound();
  }
  const job: JobRow = data;

  const { data: items } = await supabase
    .from('bulk_job_items')
    .select('id, document_type, document_preview, status, result_count, error_message')
    .eq('job_id', jobId)
    .order('id', { ascending: true })
    .returns<ItemRow[]>();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Bulk job</h1>
        <p className="text-muted-foreground font-mono text-xs">{job.id}</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <JobProgress initialJob={job} initialItems={items ?? []} />
        </CardContent>
      </Card>
    </main>
  );
}
