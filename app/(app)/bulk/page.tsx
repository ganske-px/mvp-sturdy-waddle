import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BulkUploadForm } from './upload-form';

export const metadata = {
  title: 'Bulk search — PX Process Check',
};

export default function BulkPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Bulk search</h1>
        <p className="text-muted-foreground">
          Paste a CSV with CPFs and CNPJs to look them up in one job.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>New bulk job</CardTitle>
          <CardDescription>
            The job runs asynchronously. You will be redirected to a status page that updates in
            real time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BulkUploadForm />
        </CardContent>
      </Card>
    </main>
  );
}
