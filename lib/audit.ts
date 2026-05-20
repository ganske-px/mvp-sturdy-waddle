import type { Database } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AuditAction = Database['public']['Tables']['audit_log']['Row']['action'];
export type AuditSearchType = Database['public']['Tables']['audit_log']['Row']['search_type'];

export type AuditEvent = {
  userId: string | null;
  action: AuditAction;
  searchType?: AuditSearchType;
  documentHash?: string;
  resultCount?: number;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
};

export type WriteAuditLogOptions = {
  /**
   * When true, swallow insert failures and log them to console.error. Use for
   * post-completion bookkeeping where losing the audit row is preferable to
   * blocking the user-visible flow. Default false (throws).
   */
  allowFailure?: boolean;
};

/**
 * Inserts a row into public.audit_log. The caller must pass a Supabase client
 * with permission to write to audit_log — in practice this is the admin
 * (service-role) client, since RLS allows reads but not writes from
 * authenticated users.
 */
type AuditLogInsert = Database['public']['Tables']['audit_log']['Insert'];

export async function writeAuditLog(
  event: AuditEvent,
  client: SupabaseClient<Database>,
  options: WriteAuditLogOptions = {},
): Promise<void> {
  const row = toAuditLogRow(event);
  // Cast is required because @supabase/supabase-js infers the insert parameter
  // as `never` when the typed client is passed across module boundaries. The
  // runtime accepts a single object just fine.
  const { error } = await client.from('audit_log').insert(row as never);
  if (error) {
    if (options.allowFailure) {
      console.error('writeAuditLog failed (swallowed):', error);
      return;
    }
    throw new Error(`writeAuditLog failed: ${error.message}`);
  }
}

function toAuditLogRow(event: AuditEvent): AuditLogInsert {
  const row: AuditLogInsert = {
    user_id: event.userId,
    action: event.action,
  };
  if (event.searchType !== undefined) row.search_type = event.searchType;
  if (event.documentHash !== undefined) row.document_hash = event.documentHash;
  if (event.resultCount !== undefined) row.result_count = event.resultCount;
  if (event.ip !== undefined) row.ip = event.ip;
  if (event.userAgent !== undefined) row.user_agent = event.userAgent;
  if (event.metadata !== undefined) row.metadata = event.metadata;
  return row;
}

/**
 * Pull the client IP and User-Agent out of a request's Headers in a way that
 * works behind Vercel's proxy.
 */
export function extractRequestContext(headers: Headers): {
  ip: string | undefined;
  userAgent: string | undefined;
} {
  const forwardedFor = headers.get('x-forwarded-for');
  const realIp = headers.get('x-real-ip');
  const userAgent = headers.get('user-agent') ?? undefined;

  let candidate: string | undefined;
  if (forwardedFor) {
    candidate = forwardedFor.split(',')[0]?.trim();
  } else if (realIp) {
    candidate = realIp.trim();
  }

  const ip = candidate && isPlausibleIp(candidate) ? candidate : undefined;
  return { ip, userAgent };
}

function isPlausibleIp(value: string): boolean {
  // Loose check — Postgres `inet` will do the strict validation. We only want
  // to reject obvious garbage so we don't pass `not-an-ip` to the database.
  // IPv4: 1-3 digit groups separated by dots. IPv6: hex groups separated by colons.
  return /^[\d.]+$/.test(value) || /^[0-9a-f:]+$/i.test(value);
}
