'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function SearchRowRealtime({ documentHash }: { documentHash: string }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let cancelled = false;

    void (async () => {
      // postgres_changes on an RLS-protected table only delivers events when the
      // realtime socket carries the user's JWT. The SSR browser client does not
      // forward the cookie session to the socket on its own, so set it here —
      // otherwise the socket is anon and RLS filters every event out.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session?.access_token) await supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`searches:${documentHash}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'searches',
            filter: `document_hash=eq.${documentHash}`,
          },
          () => router.refresh(),
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`realtime searches:${documentHash} status: ${status}`);
          }
        });
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [documentHash, router]);
  return null;
}
