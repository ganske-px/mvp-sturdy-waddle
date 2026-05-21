import { SearchClient } from './search-client';

export const metadata = {
  title: 'Buscar — Radar PX',
};

export default function SearchPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
          Consulta individual
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          Buscar processos
        </h1>
        <p className="text-muted-foreground">
          Pesquise processos judiciais por CPF, CNPJ ou nome via Predictus.
        </p>
      </header>
      <SearchClient />
    </main>
  );
}
