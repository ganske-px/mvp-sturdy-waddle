import { SearchClient } from './search-client';

export const metadata = {
  title: 'Search — PX Process Check',
};

export default function SearchPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-muted-foreground">Single document lookup via Predictus.</p>
      </header>
      <SearchClient />
    </main>
  );
}
