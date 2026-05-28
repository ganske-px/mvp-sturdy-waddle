'use client';

import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangleIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

// Route-level error boundary. Without this, any unhandled error during render
// falls through to Next.js's built-in static 500 ("This page couldn't load"),
// which ships no diagnostics to the operator and no `digest` to correlate.
//
// For Server Component errors, Next.js logs the full stack to the SERVER console
// (stderr) tagged with `error.digest`, and only forwards that digest to the
// client. We surface the digest here so an operator can read it off-screen and
// match it against the server log line. The `console.error` below captures
// client-side errors (which carry a real stack in the browser console).
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // No CPF/CNPJ/personal data flows through our thrown errors — they carry
    // generic messages — so logging the error object here is LGPD-safe.
    console.error('[route-error]', { digest: error.digest, message: error.message }, error);
  }, [error]);

  return (
    <main className="radar-backdrop relative flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <Card className="border-border/70 shadow-elevated">
          <CardHeader>
            <span className="mb-2 grid size-11 place-items-center rounded-xl bg-destructive/10 text-destructive">
              <AlertTriangleIcon className="size-5" />
            </span>
            <CardTitle>Algo deu errado ao carregar esta página</CardTitle>
            <CardDescription>
              Ocorreu um erro inesperado. Tente novamente — se o problema persistir, informe o
              administrador com o código abaixo.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {error.digest ? (
              <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2">
                <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Código do erro
                </span>
                <p className="mt-0.5 font-mono text-sm">{error.digest}</p>
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              <Button onClick={() => reset()} className="w-full">
                Tentar novamente
              </Button>
              <Link
                href="/"
                className={buttonVariants({ variant: 'outline', className: 'w-full' })}
              >
                Voltar ao início
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
