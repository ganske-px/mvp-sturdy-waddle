import { fakeAdmin, fakeOperator } from '@/tests/helpers/fake-user';
import { describe, expect, it, vi } from 'vitest';

// `server-only` is a runtime marker shipped via Next.js; it has no Node
// resolution and would fail to import under Vitest. Stub it out.
vi.mock('server-only', () => ({}));

// Mock next/navigation.redirect so we can assert without a real Next runtime.
// `vi.hoisted` ensures the mock is available when `vi.mock`'s hoisted factory
// runs at the top of the module.
const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__${url}`);
  }),
}));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

// We need to mock the Supabase server client per test. The mock factory
// builds a client whose `.from('users').select(...).eq(...).maybeSingle()`
// chain returns whatever row we configure, and whose `.rpc()` returns whatever
// boolean we configure.
type FakeUserRow = ReturnType<typeof fakeOperator>;

function buildSupabaseMock({
  userRow,
  authUser,
  rpcResult,
}: {
  userRow: FakeUserRow | null;
  authUser: { id: string } | null;
  rpcResult?: boolean;
}) {
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: authUser }, error: null }),
    },
    from(table: string) {
      if (table !== 'users') throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: userRow, error: null }),
          }),
        }),
      };
    },
    rpc: (_fn: string, _args: unknown) =>
      Promise.resolve({ data: rpcResult ?? false, error: null }),
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import {
  ALL_SERVICES,
  getCurrentUser,
  requireAdmin,
  requireAuth,
  requirePermission,
} from './permissions';

const mocked = vi.mocked(createClient);

describe('getCurrentUser', () => {
  it('returns null when no session', async () => {
    mocked.mockResolvedValueOnce(buildSupabaseMock({ userRow: null, authUser: null }) as never);
    expect(await getCurrentUser()).toBeNull();
  });

  it('returns the mapped AppUser when session + row exist', async () => {
    const row = fakeOperator();
    mocked.mockResolvedValueOnce(
      buildSupabaseMock({ userRow: row, authUser: { id: row.id } }) as never,
    );
    const result = await getCurrentUser();
    expect(result).toEqual({
      id: row.id,
      email: row.email,
      display_name: row.display_name,
      role: row.role,
      is_active: row.is_active,
    });
  });

  it('returns null when session exists but no allowlist row', async () => {
    mocked.mockResolvedValueOnce(
      buildSupabaseMock({ userRow: null, authUser: { id: 'ghost' } }) as never,
    );
    expect(await getCurrentUser()).toBeNull();
  });
});

describe('requireAuth', () => {
  it('redirects to /access-denied when inactive', async () => {
    const row = fakeOperator({ is_active: false });
    mocked.mockResolvedValueOnce(
      buildSupabaseMock({ userRow: row, authUser: { id: row.id } }) as never,
    );
    await expect(requireAuth()).rejects.toThrow('__REDIRECT__/access-denied');
  });

  it('returns the user when active', async () => {
    const row = fakeOperator();
    mocked.mockResolvedValueOnce(
      buildSupabaseMock({ userRow: row, authUser: { id: row.id } }) as never,
    );
    const user = await requireAuth();
    expect(user.id).toBe(row.id);
  });
});

describe('requireAdmin', () => {
  it('redirects operator', async () => {
    const row = fakeOperator();
    mocked.mockResolvedValueOnce(
      buildSupabaseMock({ userRow: row, authUser: { id: row.id } }) as never,
    );
    await expect(requireAdmin()).rejects.toThrow('__REDIRECT__/access-denied');
  });

  it('returns admin', async () => {
    const row = fakeAdmin();
    mocked.mockResolvedValueOnce(
      buildSupabaseMock({ userRow: row, authUser: { id: row.id } }) as never,
    );
    expect((await requireAdmin()).role).toBe('admin');
  });
});

describe('requirePermission', () => {
  it('admin bypasses RPC and returns user', async () => {
    const row = fakeAdmin();
    const client = buildSupabaseMock({
      userRow: row,
      authUser: { id: row.id },
      rpcResult: false, // intentionally false to prove admin bypass
    });
    const rpcSpy = vi.spyOn(client, 'rpc');
    mocked.mockResolvedValueOnce(client as never);
    const user = await requirePermission('search_person');
    expect(user.role).toBe('admin');
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('operator with permission passes', async () => {
    const row = fakeOperator();
    mocked.mockResolvedValueOnce(
      buildSupabaseMock({
        userRow: row,
        authUser: { id: row.id },
        rpcResult: true,
      }) as never,
    );
    const user = await requirePermission('search_company');
    expect(user.role).toBe('operator');
  });

  it('operator without permission redirects', async () => {
    const row = fakeOperator();
    mocked.mockResolvedValueOnce(
      buildSupabaseMock({
        userRow: row,
        authUser: { id: row.id },
        rpcResult: false,
      }) as never,
    );
    await expect(requirePermission('search_bulk')).rejects.toThrow('__REDIRECT__/access-denied');
  });
});

describe('ALL_SERVICES', () => {
  it('contains the three known services', () => {
    expect([...ALL_SERVICES].sort()).toEqual(['search_bulk', 'search_company', 'search_person']);
  });
});
