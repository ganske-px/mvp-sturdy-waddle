import { listUserPermissions, requireAuth } from '@/lib/auth/permissions';
import { SmartSearch } from './smart-search';

export const metadata = { title: 'Radar PX' };

export default async function HomePage() {
  const user = await requireAuth();
  const permissions = await listUserPermissions(user.id);

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-4xl flex-col px-6">
      <div className="flex flex-1 flex-col justify-center gap-12 py-20 sm:py-24">
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
      </div>

      <footer className="mt-auto border-t border-border/40 py-6 text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground/70">
        Dados das pesquisas são retidos por 30 dias · Documentos jamais persistidos em texto claro
      </footer>
    </main>
  );
}
