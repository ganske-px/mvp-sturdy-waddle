'use server';

import { extractRequestContext, writeAuditLog } from '@/lib/audit';
import { type BulkItemInput, createBulkJob } from '@/lib/bulk/job-store';
import { parseCsv } from '@/lib/csv/parser';
import { hashDocument } from '@/lib/hash';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { format as formatCnpj, mask as maskCnpj } from '@/lib/validators/cnpj';
import { format as formatCpf, mask as maskCpf } from '@/lib/validators/cpf';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export type CreateBulkJobState = { error?: string };

export async function createBulkJobAction(
  _previous: CreateBulkJobState | undefined,
  formData: FormData,
): Promise<CreateBulkJobState> {
  const csvText = String(formData.get('csv') ?? '').trim();
  if (!csvText) return { error: 'CSV is empty.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated.' };

  const parsed = parseCsv(csvText);
  if (!parsed.ok) {
    return { error: parsed.message };
  }

  const items: BulkItemInput[] = [
    ...parsed.cpfs.map(
      (cpf): BulkItemInput => ({
        documentType: 'cpf',
        documentValue: cpf,
        documentHash: hashDocument('cpf', cpf),
        documentPreview: maskCpf(formatCpf(cpf)),
      }),
    ),
    ...parsed.cnpjs.map(
      (cnpj): BulkItemInput => ({
        documentType: 'cnpj',
        documentValue: cnpj,
        documentHash: hashDocument('cnpj', cnpj),
        documentPreview: maskCnpj(formatCnpj(cnpj)),
      }),
    ),
  ];

  const admin = createAdminClient();
  let jobId: string;
  try {
    const result = await createBulkJob(admin, user.id, items);
    jobId = result.jobId;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to create bulk job.';
    return { error: message };
  }

  const requestContext = extractRequestContext(await headers());
  await writeAuditLog(
    {
      userId: user.id,
      action: 'bulk_job_created',
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
      metadata: { job_id: jobId, total_items: items.length },
    },
    admin,
    { allowFailure: true },
  );

  // Fire-and-forget the Edge Function. We don't await it because the user
  // is about to be redirected to /bulk/[jobId] where Realtime takes over.
  void invokeProcessBulkJob(jobId);

  redirect(`/bulk/${jobId}`);
}

async function invokeProcessBulkJob(jobId: string): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('Cannot invoke process-bulk-job: SUPABASE env vars missing.');
    return;
  }
  try {
    await fetch(`${supabaseUrl}/functions/v1/process-bulk-job`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ jobId }),
    });
  } catch (e) {
    // Don't block the redirect — the job stays in 'pending' and can be
    // retried (manually for now). pg_cron could pick it up later.
    console.error('Failed to invoke process-bulk-job:', e);
  }
}
