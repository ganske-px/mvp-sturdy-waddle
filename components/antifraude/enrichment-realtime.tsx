'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function EnrichmentRealtime({ jobId }: { jobId: string }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
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
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [jobId, router]);
  return null;
}
