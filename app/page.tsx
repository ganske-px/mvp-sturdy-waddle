export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">PX Process Check</h1>
      <p className="text-muted-foreground">
        Background check via Predictus — internal PX Center tool. UI is being implemented; this
        scaffold ships the data layer (Supabase schema, validators, CSV parser, Predictus client)
        and proxy-enforced allowlist.
      </p>
    </main>
  );
}
