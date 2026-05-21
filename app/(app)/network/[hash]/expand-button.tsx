'use client';

import { Button } from '@/components/ui/button';
import { useState, useTransition } from 'react';
import { expandNode } from './actions';

export function ExpandButton({ hash, inCache }: { hash: string; inCache: boolean }) {
  const [pending, startTransition] = useTransition();
  const [showConfirm, setShowConfirm] = useState(false);

  function doExpand() {
    startTransition(async () => {
      await expandNode(hash);
      // Server Action refreshes the cache; reload to pull fresh data.
      window.location.reload();
    });
  }

  if (inCache) {
    return (
      <Button size="sm" variant="outline" disabled={pending} onClick={doExpand}>
        {pending ? 'Expandindo…' : 'Expandir (cache)'}
      </Button>
    );
  }

  if (!showConfirm) {
    return (
      <Button size="sm" variant="outline" onClick={() => setShowConfirm(true)}>
        Expandir (chamar Predictus)
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
      <p>Isto vai consumir uma chamada Predictus. Continuar?</p>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={doExpand}>
          {pending ? 'Expandindo…' : 'Confirmar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowConfirm(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
