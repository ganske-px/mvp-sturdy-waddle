import { describe, expect, it, vi } from 'vitest';
import { type AuditEvent, writeAuditLog } from './audit';

type InsertedRow = Record<string, unknown>;

function buildFakeClient() {
  const insertCalls: InsertedRow[] = [];
  let failNext: { message: string } | null = null;
  const client = {
    from(table: string) {
      if (table !== 'audit_log') {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        insert: (row: InsertedRow) => {
          insertCalls.push(row);
          if (failNext) {
            const err = failNext;
            failNext = null;
            return Promise.resolve({ data: null, error: err });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  return {
    client,
    insertCalls,
    failWith: (message: string) => {
      failNext = { message };
    },
  };
}

describe('writeAuditLog — happy paths', () => {
  it('inserts a minimal login event', async () => {
    const { client, insertCalls } = buildFakeClient();
    const event: AuditEvent = {
      userId: 'user-1',
      action: 'login',
    };

    await writeAuditLog(event, client as never);

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({
      user_id: 'user-1',
      action: 'login',
    });
  });

  it('maps camelCase fields to snake_case columns', async () => {
    const { client, insertCalls } = buildFakeClient();
    await writeAuditLog(
      {
        userId: 'user-1',
        action: 'search_single',
        searchType: 'cpf',
        documentHash: 'deadbeef',
        resultCount: 3,
        ip: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
        metadata: { source: 'unit-test' },
      },
      client as never,
    );

    expect(insertCalls[0]).toEqual({
      user_id: 'user-1',
      action: 'search_single',
      search_type: 'cpf',
      document_hash: 'deadbeef',
      result_count: 3,
      ip: '127.0.0.1',
      user_agent: 'Mozilla/5.0',
      metadata: { source: 'unit-test' },
    });
  });

  it('omits undefined fields from the inserted row', async () => {
    const { client, insertCalls } = buildFakeClient();
    await writeAuditLog(
      {
        userId: 'user-1',
        action: 'logout',
      },
      client as never,
    );

    const row = insertCalls[0] as Record<string, unknown>;
    expect(row.search_type).toBeUndefined();
    expect(row.document_hash).toBeUndefined();
    expect(row.result_count).toBeUndefined();
    expect(row.ip).toBeUndefined();
    expect(row.user_agent).toBeUndefined();
    expect(row.metadata).toBeUndefined();
  });

  it('allows a null userId (e.g. failed login before auth)', async () => {
    const { client, insertCalls } = buildFakeClient();
    await writeAuditLog(
      {
        userId: null,
        action: 'login',
        metadata: { reason: 'invalid_credentials' },
      },
      client as never,
    );

    expect(insertCalls[0]).toMatchObject({
      user_id: null,
      action: 'login',
      metadata: { reason: 'invalid_credentials' },
    });
  });

  it('accepts the new admin_user_created action', async () => {
    const { client, insertCalls } = buildFakeClient();
    await writeAuditLog(
      {
        userId: 'admin-1',
        action: 'admin_user_created',
        metadata: { target_email: 'new@example.com', role: 'operator' },
      },
      client as never,
    );
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({
      user_id: 'admin-1',
      action: 'admin_user_created',
      metadata: { target_email: 'new@example.com', role: 'operator' },
    });
  });

  it('accepts admin_user_set_active / set_role / permission_changed', async () => {
    const { client, insertCalls } = buildFakeClient();
    const actions = [
      'admin_user_set_active',
      'admin_user_set_role',
      'admin_user_permission_changed',
    ] as const;
    for (const action of actions) {
      await writeAuditLog({ userId: 'admin-1', action }, client as never);
    }
    expect(insertCalls.map((r) => r.action)).toEqual([...actions]);
  });
});

describe('writeAuditLog — error handling', () => {
  it('throws when the database insert fails', async () => {
    const { client, failWith } = buildFakeClient();
    failWith('insert blew up');
    await expect(
      writeAuditLog({ userId: 'user-1', action: 'login' }, client as never),
    ).rejects.toThrow(/insert blew up/);
  });
});

describe('extractRequestContext', () => {
  it('reads ip from x-forwarded-for header (first value)', async () => {
    const { extractRequestContext } = await import('./audit');
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.5, 10.0.0.1',
      'user-agent': 'TestAgent/1.0',
    });
    expect(extractRequestContext(headers)).toEqual({
      ip: '203.0.113.5',
      userAgent: 'TestAgent/1.0',
    });
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', async () => {
    const { extractRequestContext } = await import('./audit');
    const headers = new Headers({ 'x-real-ip': '198.51.100.7' });
    expect(extractRequestContext(headers)).toEqual({
      ip: '198.51.100.7',
      userAgent: undefined,
    });
  });

  it('returns undefined ip when no proxy headers are present', async () => {
    const { extractRequestContext } = await import('./audit');
    const headers = new Headers();
    expect(extractRequestContext(headers)).toEqual({
      ip: undefined,
      userAgent: undefined,
    });
  });

  it('rejects an obviously invalid x-forwarded-for value', async () => {
    const { extractRequestContext } = await import('./audit');
    const headers = new Headers({ 'x-forwarded-for': 'not-an-ip' });
    expect(extractRequestContext(headers).ip).toBeUndefined();
  });
});

describe('writeAuditLog — never throws when fire-and-forget mode is enabled', () => {
  it('swallows insert errors when { allowFailure: true }', async () => {
    const { client, failWith } = buildFakeClient();
    failWith('db down');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      writeAuditLog({ userId: 'user-1', action: 'login' }, client as never, { allowFailure: true }),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
