import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 py-24">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">PX Process Check</h1>
        <p className="mt-2 text-muted-foreground">
          Background check via Predictus — internal PX Center tool.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Search</CardTitle>
            <CardDescription>Look up a single CPF, CNPJ or name.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/search" className={buttonVariants({ className: 'w-full' })}>
              Open search
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bulk</CardTitle>
            <CardDescription>Look up many documents from a CSV.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/bulk"
              className={buttonVariants({ variant: 'outline', className: 'w-full' })}
            >
              New bulk job
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
            <CardDescription>Your previous searches.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/history"
              className={buttonVariants({ variant: 'outline', className: 'w-full' })}
            >
              View history
            </Link>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
