'use server';

import { extractRequestContext, writeAuditLog } from '@/lib/audit';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export type SignInState = { error?: string };

export async function signIn(
  _previous: SignInState | undefined,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data?.user) {
    return { error: error?.message ?? 'Invalid credentials.' };
  }

  const admin = createAdminClient();
  const requestContext = extractRequestContext(await headers());
  await writeAuditLog(
    {
      userId: data.user.id,
      action: 'login',
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
    },
    admin,
    { allowFailure: true },
  );

  redirect('/');
}
