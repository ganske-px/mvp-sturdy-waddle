'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircleIcon, UploadIcon } from 'lucide-react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { type CreateBulkJobState, createBulkJobAction } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      <UploadIcon className="size-4" />
      {pending ? 'Criando job…' : 'Iniciar busca em lote'}
    </Button>
  );
}

export function BulkUploadForm() {
  const [state, formAction] = useActionState<CreateBulkJobState | undefined, FormData>(
    createBulkJobAction,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="csv">Conteúdo CSV</Label>
        <Textarea
          id="csv"
          name="csv"
          required
          rows={10}
          placeholder={
            'Cole um CSV com CPFs e/ou CNPJs.\n\n111.444.777-35\n529.982.247-25\n11.222.333/0001-81\n'
          }
          className="min-h-48 font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Até 250 documentos únicos por job · Duplicados são removidos automaticamente.
        </p>
      </div>
      {state?.error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      ) : null}
      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
