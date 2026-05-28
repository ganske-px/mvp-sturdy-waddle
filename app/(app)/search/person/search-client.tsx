'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircleIcon, SearchIcon } from 'lucide-react';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { type PersonSearchType, type SearchPersonResult, searchPerson } from './actions';

const TYPE_LABELS: Record<PersonSearchType, string> = {
  cpf: 'CPF',
  name: 'Nome',
};

const TYPE_DESCRIPTIONS: Record<PersonSearchType, string> = {
  cpf: 'Pessoa física por CPF',
  name: 'Pessoa física por nome',
};

const PLACEHOLDERS: Record<PersonSearchType, string> = {
  cpf: '123.456.789-10',
  name: 'João Silva',
};

async function submitAction(
  _previous: SearchPersonResult | null,
  formData: FormData,
): Promise<SearchPersonResult> {
  const type = (formData.get('type') as PersonSearchType | null) ?? 'cpf';
  const rawInput = String(formData.get('q') ?? '');
  return searchPerson({ type, rawInput });
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      <SearchIcon className="size-4" />
      {pending ? 'Consultando…' : 'Consultar'}
    </Button>
  );
}

export function PersonSearchClient() {
  const [type, setType] = useState<PersonSearchType>('cpf');
  const [state, formAction] = useActionState<SearchPersonResult | null, FormData>(
    submitAction,
    null,
  );

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Nova consulta</CardTitle>
          <CardDescription>{TYPE_DESCRIPTIONS[type]}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-5">
            <input type="hidden" name="type" value={type} />

            <div className="flex flex-col gap-2">
              <Label>Tipo</Label>
              <div
                className="inline-flex gap-0.5 rounded-xl border border-border bg-muted/50 p-1"
                role="radiogroup"
                aria-label="Tipo de consulta"
              >
                {(['cpf', 'name'] as const).map((t) => {
                  const active = type === t;
                  return (
                    <button
                      type="button"
                      key={t}
                      // biome-ignore lint/a11y/useSemanticElements: visual segmented toggle
                      role="radio"
                      aria-checked={active}
                      onClick={() => setType(t)}
                      className={
                        active
                          ? 'flex-1 rounded-lg bg-card px-4 py-2 text-sm font-semibold text-primary shadow-card transition-all'
                          : 'flex-1 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground'
                      }
                    >
                      {TYPE_LABELS[t]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="q">Termo</Label>
              <Input
                id="q"
                name="q"
                placeholder={PLACEHOLDERS[type]}
                autoComplete="off"
                required
                className={type === 'name' ? '' : 'font-mono tracking-tight'}
              />
            </div>

            <div className="flex justify-end">
              <SubmitButton />
            </div>
          </form>
        </CardContent>
      </Card>

      {state && !state.ok ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      ) : null}
    </div>
  );
}
