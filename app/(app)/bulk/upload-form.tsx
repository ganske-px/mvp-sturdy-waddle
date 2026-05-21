'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { type CreateBulkJobState, createBulkJobAction } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Creating job…' : 'Start bulk search'}
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
        <Label htmlFor="csv">CSV content</Label>
        <Textarea
          id="csv"
          name="csv"
          required
          rows={10}
          placeholder={
            'Paste a CSV with CPFs and/or CNPJs.\n\n111.444.777-35\n529.982.247-25\n11.222.333/0001-81\n'
          }
          className="min-h-48 font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Up to 250 unique documents per job. Duplicates are removed automatically.
        </p>
      </div>
      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
