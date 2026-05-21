import { listUserPermissions, requireAuth } from '@/lib/auth/permissions';
import { SmartSearch } from './smart-search';

export const metadata = { title: 'Radar PX' };

export default async function HomePage() {
  const user = await requireAuth();
  const permissions = await listUserPermissions(user.id);

  return (
    <main className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-4xl flex-col justify-center gap-12 px-6 py-20 sm:py-24">
      <div className="pointer-events-none absolute inset-x-0 top-24 -z-10 mx-auto h-px max-w-3xl bg-gradient-to-r from-transparent via-border to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-24 -z-10 mx-auto h-px max-w-3xl bg-gradient-to-r from-transparent via-border to-transparent" />

      <header className="flex flex-col gap-3">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
          Radar PX · Compliance
        </span>
        <h1 className="font-heading text-[2rem] font-semibold tracking-tight text-foreground sm:text-[2.5rem]">
          Sobre quem você quer{' '}
          <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            saber
          </span>
          ?
        </h1>
        <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
          Um campo, três tipos. Digite o CPF, CNPJ ou nome — o Radar entende e consulta na fonte
          certa.
        </p>
      </header>

      <SmartSearch role={user.role} permissions={[...permissions]} />

      <footer className="text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground/70">
        Dados das pesquisas são retidos por 30 dias · Documentos jamais persistidos em texto claro
      </footer>
    </main>
  );
}
