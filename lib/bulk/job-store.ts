import type { Database } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export const MAX_ITEMS_PER_JOB = 250;

export type BulkItemInput = {
  documentHash: string;
  /** Raw CPF/CNPJ digits — will be encrypted before reaching the database. */
  documentRaw: string;
  documentType: 'cpf' | 'cnpj';
  documentPreview: string;
};

export type BulkItemStatus = 'pending' | 'processing' | 'found' | 'clean' | 'error';

export type BulkJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export type BulkItemRow = Database['public']['Tables']['bulk_job_items']['Row'];

export type ItemOutcome =
  | { kind: 'found'; resultCount: number }
  | { kind: 'clean'; resultCount: number }
  | { kind: 'error'; message: string };

export type CreateBulkJobOptions = {
  client: SupabaseClient<Database>;
  userId: string;
  items: BulkItemInput[];
  /**
   * Encrypts the raw CPF/CNPJ so it can be stored in
   * `bulk_job_items.document_encrypted`. Injectable so the caller picks the
   * crypto stack (Vault RPC in production, a stub in tests).
   */
  encryptDocument: (raw: string) => Promise<string>;
};

export async function createBulkJob(options: CreateBulkJobOptions): Promise<{ jobId: string }> {
  const { client, userId, items, encryptDocument } = options;
  if (items.length === 0) {
    throw new Error('createBulkJob requires at least 1 item.');
  }
  if (items.length > MAX_ITEMS_PER_JOB) {
    throw new Error(`createBulkJob: items exceed the per-job cap of ${MAX_ITEMS_PER_JOB}.`);
  }

  const { data, error } = await client
    .from('bulk_jobs')
    .insert({
      user_id: userId,
      total_items: items.length,
      status: 'pending',
    } as never)
    .select('id')
    .single<{ id: string }>();
  if (error || !data) {
    throw new Error(`createBulkJob: failed to insert job: ${error?.message ?? 'no data'}`);
  }

  const jobId = data.id;
  const itemRows = await Promise.all(
    items.map(async (it) => ({
      job_id: jobId,
      document_hash: it.documentHash,
      document_encrypted: await encryptDocument(it.documentRaw),
      document_type: it.documentType,
      document_preview: it.documentPreview,
    })),
  );
  const { error: itemsError } = await client.from('bulk_job_items').insert(itemRows as never);
  if (itemsError) {
    throw new Error(`createBulkJob: failed to insert items: ${itemsError.message}`);
  }

  return { jobId };
}

export async function setJobStatus(
  client: SupabaseClient<Database>,
  jobId: string,
  status: BulkJobStatus,
  extras: { errorMessage?: string } = {},
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  const nowIso = new Date().toISOString();
  if (status === 'running') patch.started_at = nowIso;
  if (status === 'completed' || status === 'failed') patch.finished_at = nowIso;
  if (extras.errorMessage !== undefined) patch.error_message = extras.errorMessage;

  const { error } = await client
    .from('bulk_jobs')
    .update(patch as never)
    .eq('id', jobId);
  if (error) {
    throw new Error(`setJobStatus failed: ${error.message}`);
  }
}

export async function getPendingItems(
  client: SupabaseClient<Database>,
  jobId: string,
  limit: number,
): Promise<BulkItemRow[]> {
  const { data, error } = await client
    .from('bulk_job_items')
    .select('*')
    .eq('job_id', jobId)
    .eq('status', 'pending')
    .order('id', { ascending: true })
    .limit(limit);
  if (error) {
    throw new Error(`getPendingItems failed: ${error.message}`);
  }
  return (data ?? []) as BulkItemRow[];
}

export async function recordItemResult(
  client: SupabaseClient<Database>,
  itemId: string,
  outcome: ItemOutcome,
): Promise<void> {
  const patch: Record<string, unknown> = {
    processed_at: new Date().toISOString(),
  };
  if (outcome.kind === 'error') {
    patch.status = 'error';
    patch.error_message = outcome.message;
  } else {
    patch.status = outcome.kind;
    patch.result_count = outcome.resultCount;
  }

  const { error } = await client
    .from('bulk_job_items')
    .update(patch as never)
    .eq('id', itemId);
  if (error) {
    throw new Error(`recordItemResult failed: ${error.message}`);
  }
}

export type JobCounters = {
  done: number;
  errors: number;
  pending: number;
  total: number;
  completed: boolean;
};

export async function refreshJobCounters(
  client: SupabaseClient<Database>,
  jobId: string,
): Promise<JobCounters> {
  const { data: items, error } = await client
    .from('bulk_job_items')
    .select('status')
    .eq('job_id', jobId)
    .limit(MAX_ITEMS_PER_JOB)
    .returns<Array<{ status: BulkItemStatus }>>();
  if (error) {
    throw new Error(`refreshJobCounters: select failed: ${error.message}`);
  }
  const rows = items ?? [];
  let done = 0;
  let errors = 0;
  let pending = 0;
  for (const r of rows) {
    if (r.status === 'found' || r.status === 'clean') done += 1;
    else if (r.status === 'error') errors += 1;
    else pending += 1; // pending or processing
  }
  const total = rows.length;
  const completed = pending === 0 && total > 0;

  const { error: updateError } = await client
    .from('bulk_jobs')
    .update({ done_items: done, error_items: errors } as never)
    .eq('id', jobId);
  if (updateError) {
    throw new Error(`refreshJobCounters: update failed: ${updateError.message}`);
  }

  return { done, errors, pending, total, completed };
}
