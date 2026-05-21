import { listUserPermissions, requireAuth } from '@/lib/auth/permissions';
import { HomeModules } from './home-modules';

export const metadata = { title: 'Radar PX' };

export default async function HomePage() {
  const user = await requireAuth();
  const permissions = await listUserPermissions(user.id);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-14">
      <header className="flex flex-col gap-3">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
          PX Center · Compliance
        </span>
        <h1 className="font-heading text-4xl font-semibold tracking-tight text-foreground sm:text-[2.75rem]">
          Background check sob radar.
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          Consulte processos judiciais por CPF, CNPJ ou nome — com cache, auditoria e rate-limit já
          integrados. Pensado para checagens de KYC, KYB e KYE.
        </p>
      </header>

      <HomeModules role={user.role} permissions={[...permissions]} />

      <footer className="border-t border-border/60 pt-6 text-xs text-muted-foreground">
        Dados retidos por 30 dias · CPF e CNPJ nunca persistidos em texto claro.
      </footer>
    </main>
  );
}
