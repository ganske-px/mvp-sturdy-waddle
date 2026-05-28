'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function EnrichmentRealtime({ jobId }: { jobId: string }) {
  const router = useRouter();
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
        .channel(`enrichment:${jobId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'enrichment_jobs', filter: `id=eq.${jobId}` },
          () => router.refresh(),
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'enrichment_job_calls',
            filter: `job_id=eq.${jobId}`,
          },
          () => router.refresh(),
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`realtime enrichment:${jobId} status: ${status}`);
          }
        });
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [jobId, router]);
  return null;
}
