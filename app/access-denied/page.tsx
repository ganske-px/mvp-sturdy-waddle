import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldOffIcon } from 'lucide-react';
import Link from 'next/link';

export const metadata = {
  title: 'Acesso negado — Radar PX',
};

export default function AccessDeniedPage() {
  return (
    <main className="radar-backdrop relative flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <Card className="border-border/70 shadow-elevated">
          <CardHeader>
            <span className="mb-2 grid size-11 place-items-center rounded-xl bg-destructive/10 text-destructive">
              <ShieldOffIcon className="size-5" />
            </span>
            <CardTitle>Acesso negado</CardTitle>
            <CardDescription>
              Sua conta não está na lista de operadores autorizados. Procure o administrador caso
              isso esteja errado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/login"
              className={buttonVariants({ variant: 'outline', className: 'w-full' })}
            >
              Voltar para o login
            </Link>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
