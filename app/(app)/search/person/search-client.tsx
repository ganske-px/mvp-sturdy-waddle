'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button';
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
import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';
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

export function PersonSearchClient({
  initialQuery = '',
  initialType = 'cpf',
  canSeeNetwork = false,
}: {
  initialQuery?: string;
  initialType?: PersonSearchType;
  canSeeNetwork?: boolean;
}) {
  const [type, setType] = useState<PersonSearchType>(initialType);
  const [state, formAction] = useActionState<SearchPersonResult | null, FormData>(
    submitAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const autoSubmittedRef = useRef(false);

  useEffect(() => {
    if (autoSubmittedRef.current) return;
    if (!initialQuery) return;
    autoSubmittedRef.current = true;
    formRef.current?.requestSubmit();
  }, [initialQuery]);

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Nova consulta</CardTitle>
          <CardDescription>{TYPE_DESCRIPTIONS[type]}</CardDescription>
        </CardHeader>
        <CardContent>
          <form ref={formRef} action={formAction} className="flex flex-col gap-5">
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
                defaultValue={initialQuery}
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
              <div className="flex flex-wrap items-center gap-3">
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
                {state.ok && state.networkHash && canSeeNetwork ? (
                  <Link
                    href={`/network/${encodeURIComponent(state.networkHash)}`}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    Ver rede
                  </Link>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {state.ok ? (
              state.results.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/30 py-10">
                  <CheckCircle2Icon className="size-8 text-success" />
                  <p className="text-sm font-medium">Nenhum processo encontrado</p>
                  <p className="text-xs text-muted-foreground">
                    O documento aparenta estar limpo na fonte de dados.
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
