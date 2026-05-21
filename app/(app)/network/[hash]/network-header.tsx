'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { navigateToNetwork } from './actions';

export function NetworkHeader({ centerName }: { centerName: string | null }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <h1 className="text-lg font-semibold">{centerName ? `Rede de ${centerName}` : 'Rede'}</h1>
      <form action={navigateToNetwork} className="flex items-center gap-2">
        <Input name="q" placeholder="CPF ou CNPJ" className="w-56 font-mono" autoComplete="off" />
        <Button type="submit" size="sm">
          Ir
        </Button>
      </form>
    </header>
  );
}
