import type { PersonSearchType } from './actions';
import { PersonSearchClient } from './search-client';

export const metadata = { title: 'Buscar pessoa — Radar PX' };

export default async function PersonSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const sp = await searchParams;
  const initialQuery = sp.q?.trim() ?? '';
  const initialType: PersonSearchType = sp.type === 'name' ? 'name' : 'cpf';

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
          Consulta individual
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          Buscar pessoa
        </h1>
        <p className="text-muted-foreground">
          Consulta processual por CPF ou nome. Resultados são guardados em cache por 30 dias.
        </p>
      </header>
      <PersonSearchClient initialQuery={initialQuery} initialType={initialType} />
    </main>
  );
}
