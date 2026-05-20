'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { type SearchByDocResult, type SearchType, searchByDoc } from './actions';

const TYPE_LABELS: Record<SearchType, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  name: 'Name',
};

const PLACEHOLDERS: Record<SearchType, string> = {
  cpf: '123.456.789-10',
  cnpj: '12.345.678/0001-99',
  name: 'João Silva',
};

function formatBRL(value: number | string | undefined): string {
  if (value === undefined || value === null || value === '') return '—';
  const num = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(num)) return String(value);
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function submitAction(
  _previous: SearchByDocResult | null,
  formData: FormData,
): Promise<SearchByDocResult> {
  const type = (formData.get('type') as SearchType | null) ?? 'cpf';
  const rawInput = String(formData.get('q') ?? '');
  return searchByDoc({ type, rawInput });
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Searching…' : 'Search'}
    </Button>
  );
}

export function SearchClient() {
  const [type, setType] = useState<SearchType>('cpf');
  const [state, formAction] = useActionState<SearchByDocResult | null, FormData>(
    submitAction,
    null,
  );

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>New search</CardTitle>
          <CardDescription>Look up judicial processes by CPF, CNPJ or name.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="type" value={type} />
            <div className="flex flex-col gap-2">
              <Label>Type</Label>
              <div className="flex gap-2" role="radiogroup" aria-label="Search type">
                {(['cpf', 'cnpj', 'name'] as const).map((t) => (
                  <Button
                    type="button"
                    key={t}
                    variant={type === t ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setType(t)}
                    aria-pressed={type === t}
                  >
                    {TYPE_LABELS[t]}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="q">Term</Label>
              <Input id="q" name="q" placeholder={PLACEHOLDERS[type]} autoComplete="off" required />
            </div>
            <div className="flex justify-end">
              <SubmitButton />
            </div>
          </form>
        </CardContent>
      </Card>

      {state ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {state.ok
                ? `${state.results.length} result${state.results.length === 1 ? '' : 's'} for ${state.displayTerm}`
                : 'Search failed'}
            </CardTitle>
            {state.ok ? (
              <CardDescription>
                {state.cached
                  ? `Cached — fetched ${timeAgo(state.fetchedAt)}`
                  : 'Fresh — fetched just now'}
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            {state.ok ? (
              state.results.length === 0 ? (
                <p className="text-muted-foreground">Nothing found — the record looks clean.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Process</TableHead>
                      <TableHead>Court</TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.results.map((p, i) => (
                      <TableRow key={p.numeroProcessoUnico ?? `idx-${i}`}>
                        <TableCell className="font-mono text-xs">
                          {p.numeroProcessoUnico ?? '—'}
                        </TableCell>
                        <TableCell>{p.tribunal ?? '—'}</TableCell>
                        <TableCell>{p.classeProcessual ?? '—'}</TableCell>
                        <TableCell className="text-right">
                          {formatBRL(p.valorCausa?.valor)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )
            ) : (
              <p role="alert" className="text-destructive">
                {state.error}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
