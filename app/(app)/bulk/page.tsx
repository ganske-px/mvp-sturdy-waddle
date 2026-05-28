import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BulkUploadForm } from './upload-form';

export const metadata = {
  title: 'Busca em lote — Radar PX',
};

export default function BulkPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
          Operação em escala
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          Busca em lote
        </h1>
        <p className="text-muted-foreground">
          Cole um CSV com CPFs e CNPJs para consultar em uma única execução.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Novo job</CardTitle>
          <CardDescription>
            O job roda de forma assíncrona. Você é redirecionado para uma página de status que se
            atualiza em tempo real.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BulkUploadForm />
        </CardContent>
      </Card>
    </main>
  );
}
