'use client';

import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { useState, useTransition } from 'react';
import { investigateNode } from './actions';

export function InvestigateButton({ hash }: { hash: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function doInvestigate() {
    setError(null);
    startTransition(async () => {
      // Em sucesso a Server Action redireciona no servidor (lança NEXT_REDIRECT)
      // e este callback não chega a inspecionar `result`. Só caímos no else em erro.
      const result = await investigateNode(hash);
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button size="sm" disabled={pending} onClick={doInvestigate} className="w-full">
        <Search className="size-3.5" />
        {pending ? 'Investigando…' : 'Investigar este documento'}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
