import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/server';
import { type AuditAction, type AuditRow, AuditTable } from './audit-table';

export const metadata = { title: 'Auditoria — Admin · Radar PX' };

type RawAuditRow = {
  id: string;
  user_id: string | null;
  action: AuditAction;
  search_type: 'cpf' | 'cnpj' | 'name' | null;
  document_hash: string | null;
  result_count: number | null;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  users: { email: string } | null;
};

export default async function AdminAuditPage() {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from('audit_log')
    .select(
      'id, user_id, action, search_type, document_hash, result_count, ip, metadata, created_at, users!audit_log_user_id_fkey ( email )',
    )
    .order('created_at', { ascending: false })
    .limit(500)
    .returns<RawAuditRow[]>();

  const mapped: AuditRow[] = (rows ?? []).map((r) => ({
    id: r.id,
    user_id: r.user_id,
    user_email: r.users?.email ?? null,
    action: r.action,
    search_type: r.search_type,
    document_hash: r.document_hash,
    result_count: r.result_count,
    ip: r.ip,
    metadata: r.metadata,
    created_at: r.created_at,
  }));

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
          Conformidade · LGPD
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          Auditoria
        </h1>
        <p className="text-muted-foreground">
          Trilha global das ações dos operadores e do admin. Retenção de 30 dias.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Últimos 500 eventos</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <p role="alert" className="text-destructive">
              Falha ao carregar: {error.message}
            </p>
          ) : (
            <AuditTable rows={mapped} />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
