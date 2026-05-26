'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircleIcon, SearchIcon } from 'lucide-react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { type SearchByCnpjResult, searchByCnpj } from './actions';

async function submitAction(
  _previous: SearchByCnpjResult | null,
  formData: FormData,
): Promise<SearchByCnpjResult> {
  return searchByCnpj({ rawInput: String(formData.get('q') ?? '') });
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

export function CompanySearchClient() {
  const [state, formAction] = useActionState<SearchByCnpjResult | null, FormData>(
    submitAction,
    null,
  );

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Nova consulta</CardTitle>
          <CardDescription>Pessoa jurídica por CNPJ</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="q">CNPJ</Label>
              <Input
                id="q"
                name="q"
                placeholder="12.345.678/0001-99"
                autoComplete="off"
                required
                className="font-mono tracking-tight"
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
