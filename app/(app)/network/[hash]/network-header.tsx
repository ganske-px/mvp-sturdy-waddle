'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { RiskVerdict } from '@/lib/graph/risk-verdict';
import { isValid as isCnpjValid } from '@/lib/validators/cnpj';
import { isValid as isCpfValid } from '@/lib/validators/cpf';
import { AlertTriangleIcon, ShieldAlertIcon } from 'lucide-react';
import { useState, useTransition } from 'react';
import { type PathBetweenDto, findPathBetween, findPathToDocument } from './actions';

export function NetworkHeader({
  centerName,
  centerHash,
  verdict,
  onPath,
}: {
  centerName: string | null;
  centerHash: string;
  verdict: RiskVerdict;
  onPath: (result: PathBetweenDto) => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function runPath(targetHash: string) {
    startTransition(async () => {
      const result = await findPathBetween(centerHash, targetHash);
      onPath(result);
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const raw = value.trim();
    const type = isCpfValid(raw) ? 'cpf' : isCnpjValid(raw) ? 'cnpj' : null;
    if (!type) {
      setError('Informe um CPF ou CNPJ válido.');
      return;
    }
    startTransition(async () => {
      const result = await findPathToDocument(centerHash, type, raw);
      onPath(result);
    });
  }

  const showVerdict = verdict.level !== 'none';
  const direct = verdict.level === 'direct';

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
          Visão de rede
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          {centerName ? `Rede de ${centerName}` : 'Rede'}
        </h1>
      </div>

      {showVerdict ? (
        <div
          role="alert"
          className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
            direct
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : 'border-warning/40 bg-warning/10 text-warning-foreground'
          }`}
        >
          {direct ? (
            <ShieldAlertIcon className="size-5 shrink-0" />
          ) : (
            <AlertTriangleIcon className="size-5 shrink-0" />
          )}
          <div className="flex-1">
            <p className="text-sm font-semibold">
              {direct
                ? 'Relação direta com PEP/sancionado'
                : `A ${verdict.distance} saltos de PEP/sancionado`}
            </p>
          </div>
          {verdict.targetHash ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => verdict.targetHash && runPath(verdict.targetHash)}
            >
              {pending ? 'Traçando…' : 'Ver caminho até o risco'}
            </Button>
          ) : null}
        </div>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3"
      >
        <Input
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Traçar caminho até CPF ou CNPJ"
          className="w-full max-w-xs font-mono"
          autoComplete="off"
        />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Traçando…' : 'Traçar caminho'}
        </Button>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </form>
    </header>
  );
}
