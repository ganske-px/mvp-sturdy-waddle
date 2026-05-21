'use client';

import { Badge } from '@/components/ui/badge';
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
    <div className="flex flex-col gap-4">
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
              <div
                className="inline-flex gap-0.5 rounded-lg border bg-muted/40 p-0.5"
                role="radiogroup"
                aria-label="Search type"
              >
                {(['cpf', 'cnpj', 'name'] as const).map((t) => {
                  const active = type === t;
                  return (
                    <button
                      type="button"
                      key={t}
                      // biome-ignore lint/a11y/useSemanticElements: visual segmented toggle; native radios can't render this layout, ARIA role preserves semantics
                      role="radio"
                      aria-checked={active}
                      onClick={() => setType(t)}
                      className={
                        active
                          ? 'flex-1 rounded-md bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm ring-1 ring-border transition-colors'
                          : 'flex-1 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground'
                      }
                    >
                      {TYPE_LABELS[t]}
                    </button>
                  );
                })}
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
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>
              {state.ok
                ? `${state.results.length} result${state.results.length === 1 ? '' : 's'} for ${state.displayTerm}`
                : 'Search failed'}
            </CardTitle>
            {state.ok ? (
              state.cached ? (
                <Badge variant="info">Cached · {timeAgo(state.fetchedAt)}</Badge>
              ) : (
                <Badge variant="success">Fresh</Badge>
              )
            ) : null}
          </CardHeader>
          <CardContent>
            {state.ok ? (
              state.results.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm">No processes found.</p>
                  <p className="text-sm text-muted-foreground">The record appears clean.</p>
                </div>
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
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {state.error}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
