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
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ClockIcon,
  SearchIcon,
  SparklesIcon,
} from 'lucide-react';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { type SearchByDocResult, type SearchType, searchByDoc } from './actions';

const TYPE_LABELS: Record<SearchType, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  name: 'Nome',
};

const TYPE_DESCRIPTIONS: Record<SearchType, string> = {
  cpf: 'Pessoa física — KYC',
  cnpj: 'Pessoa jurídica — KYB',
  name: 'Nome completo — KYE',
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
  if (ms < 60_000) return 'agora';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} d`;
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
    <Button type="submit" size="lg" disabled={pending}>
      <SearchIcon className="size-4" />
      {pending ? 'Consultando…' : 'Consultar'}
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
              <Label>Tipo de documento</Label>
              <div
                className="inline-flex gap-0.5 rounded-xl border border-border bg-muted/50 p-1"
                role="radiogroup"
                aria-label="Tipo de consulta"
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

      {state ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <CardTitle>
                  {state.ok
                    ? `${state.results.length} ${state.results.length === 1 ? 'resultado' : 'resultados'}`
                    : 'Consulta falhou'}
                </CardTitle>
                {state.ok ? (
                  <CardDescription>
                    Termo: <span className="font-mono text-foreground">{state.displayTerm}</span>
                  </CardDescription>
                ) : null}
              </div>
              {state.ok ? (
                state.cached ? (
                  <Badge variant="info">
                    <ClockIcon />
                    Em cache · {timeAgo(state.fetchedAt)}
                  </Badge>
                ) : (
                  <Badge variant="success">
                    <SparklesIcon />
                    Resultado fresco
                  </Badge>
                )
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {state.ok ? (
              state.results.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/30 py-10">
                  <CheckCircle2Icon className="size-8 text-success" />
                  <p className="text-sm font-medium">Nenhum processo encontrado</p>
                  <p className="text-xs text-muted-foreground">
                    O documento aparenta estar limpo no Predictus.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Processo</TableHead>
                      <TableHead>Tribunal</TableHead>
                      <TableHead>Classe</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.results.map((p, i) => (
                      <TableRow key={p.numeroProcessoUnico ?? `idx-${i}`}>
                        <TableCell className="font-mono text-xs">
                          {p.numeroProcessoUnico ?? '—'}
                        </TableCell>
                        <TableCell className="text-sm">{p.tribunal ?? '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {p.classeProcessual ?? '—'}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
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
                className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                <span>{state.error}</span>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
