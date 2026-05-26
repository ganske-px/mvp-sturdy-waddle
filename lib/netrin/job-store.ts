import type { Database } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export type EnrichmentJobStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed';
export type EnrichmentCallStatus = 'pending' | 'running' | 'success' | 'error' | 'cache_hit';

export type FindOrCreateJobInput = {
  userId: string;
  rootHash: string;
  rootType: 'cpf' | 'cnpj';
};

export type FindOrCreateJobResult = { jobId: string; created: boolean };

export async function findOrCreateJob(
  client: SupabaseClient<Database>,
  input: FindOrCreateJobInput,
): Promise<FindOrCreateJobResult> {
  const { data: existing, error: selectError } = await client
    .from('enrichment_jobs')
    .select('id, status')
    .eq('root_hash', input.rootHash)
    .in('status', ['pending', 'running'])
    .maybeSingle();
  if (selectError) throw new Error(`findOrCreateJob select failed: ${selectError.message}`);
  if (existing) return { jobId: (existing as { id: string }).id, created: false };

  const { data: inserted, error: insertError } = await client
    .from('enrichment_jobs')
    .insert({
      user_id: input.userId,
      root_hash: input.rootHash,
      root_type: input.rootType,
      status: 'pending',
    } as never)
    .select('id')
    .single<{ id: string }>();

  if (insertError) {
    if ((insertError as { code?: string }).code === '23505') {
      const { data: winner } = await client
        .from('enrichment_jobs')
        .select('id, status')
        .eq('root_hash', input.rootHash)
        .in('status', ['pending', 'running'])
        .maybeSingle();
      if (winner) return { jobId: (winner as { id: string }).id, created: false };
    }
    throw new Error(`findOrCreateJob insert failed: ${insertError.message}`);
  }
  if (!inserted) throw new Error('findOrCreateJob: insert returned no data');
  return { jobId: inserted.id, created: true };
}

export async function setJobStatus(
  client: SupabaseClient<Database>,
  jobId: string,
  status: EnrichmentJobStatus,
  opts: { error?: string; finished?: boolean } = {},
): Promise<void> {
  const update: Record<string, unknown> = { status };
  if (opts.error !== undefined) update.error = opts.error;
  if (opts.finished) update.finished_at = new Date().toISOString();
  const { error } = await client
    .from('enrichment_jobs')
    .update(update as never)
    .eq('id', jobId);
  if (error) throw new Error(`setJobStatus failed: ${error.message}`);
}

export async function setHop1Status(
  client: SupabaseClient<Database>,
  jobId: string,
  status: 'success' | 'error' | 'cache_hit' | 'skipped',
): Promise<void> {
  const { error } = await client
    .from('enrichment_jobs')
    .update({ hop1_status: status } as never)
    .eq('id', jobId);
  if (error) throw new Error(`setHop1Status failed: ${error.message}`);
}

export async function setHopTotals(
  client: SupabaseClient<Database>,
  jobId: string,
  totals: { hop2_total?: number; hop3_total?: number },
): Promise<void> {
  const { error } = await client
    .from('enrichment_jobs')
    .update(totals as never)
    .eq('id', jobId);
  if (error) throw new Error(`setHopTotals failed: ${error.message}`);
}

export async function bumpHopDone(
  client: SupabaseClient<Database>,
  jobId: string,
  hop: 2 | 3,
): Promise<void> {
  const column = hop === 2 ? 'hop2_done' : 'hop3_done';
  const { data, error } = await client
    .from('enrichment_jobs')
    .select(column)
    .eq('id', jobId)
    .single<Record<string, number>>();
  if (error || !data) throw new Error(`bumpHopDone select: ${error?.message ?? 'no data'}`);
  const next = (data[column] ?? 0) + 1;
  const upd = { [column]: next } as Record<string, number>;
  const { error: updError } = await client
    .from('enrichment_jobs')
    .update(upd as never)
    .eq('id', jobId);
  if (updError) throw new Error(`bumpHopDone update: ${updError.message}`);
}

export type RecordCallInput = {
  jobId: string;
  hop: 1 | 2 | 3;
  documentHash: string;
  documentType: 'cpf' | 'cnpj';
  slugs: string[];
  status: EnrichmentCallStatus;
  cached: boolean;
  fetchedAt?: string;
  error?: string;
};

export async function recordCall(
  client: SupabaseClient<Database>,
  input: RecordCallInput,
): Promise<void> {
  const row: Record<string, unknown> = {
    job_id: input.jobId,
    hop: input.hop,
    document_hash: input.documentHash,
    document_type: input.documentType,
    slugs: input.slugs,
    status: input.status,
    cached: input.cached,
    fetched_at: input.fetchedAt ?? new Date().toISOString(),
  };
  if (input.error !== undefined) row.error = input.error;
  const { error } = await client.from('enrichment_job_calls').insert(row as never);
  if (error) throw new Error(`recordCall failed: ${error.message}`);
}
