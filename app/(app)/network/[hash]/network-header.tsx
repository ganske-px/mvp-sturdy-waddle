'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { navigateToNetwork } from './actions';

export function NetworkHeader({ centerName }: { centerName: string | null }) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
          Visão de rede
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          {centerName ? `Rede de ${centerName}` : 'Rede'}
        </h1>
        <p className="text-muted-foreground">
          Conexões inferidas a partir das partes e advogados dos processos consultados.
        </p>
      </div>
      <form
        action={navigateToNetwork}
        className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3"
      >
        <Input
          name="q"
          placeholder="Buscar outro CPF ou CNPJ"
          className="w-full max-w-xs font-mono"
          autoComplete="off"
        />
        <Button type="submit" size="sm">
          Ir
        </Button>
      </form>
    </header>
  );
}
