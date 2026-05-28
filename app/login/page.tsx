import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadarIcon } from 'lucide-react';
import { LoginForm } from './login-form';

export const metadata = {
  title: 'Entrar — Radar PX',
};

export default function LoginPage() {
  return (
    <main className="radar-backdrop relative min-h-screen overflow-hidden">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-stretch justify-center px-6 py-16">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-elevated">
            <RadarIcon className="size-6" strokeWidth={2.2} />
          </span>
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
            Radar <span className="text-primary">PX</span>
          </h1>
          <p className="text-[0.65rem] font-medium uppercase tracking-[0.24em] text-muted-foreground">
            KYC · KYB · KYE Check
          </p>
        </div>

        <Card className="border-border/70 shadow-elevated">
          <CardHeader>
            <CardTitle>Entrar</CardTitle>
            <CardDescription>
              Use as credenciais de operador enviadas pelo administrador.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Acesso restrito · Ferramenta interna PX Center
        </p>
      </div>
    </main>
  );
}
