import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type AuthUser = { id: string } | null;
type UserRow = { id: string; role: 'admin' | 'operator'; is_active: boolean } | null;

let getUserMock: () => Promise<{ data: { user: AuthUser } }>;
let userRowMock: { data: UserRow } = { data: null };

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: () => getUserMock() },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => ({
            returns: <T>() => Promise.resolve(userRowMock as { data: T }),
          }),
        }),
      }),
    }),
  }),
}));

function makeRequest(pathname: string): NextRequest {
  return new NextRequest(`http://localhost${pathname}`);
}

async function callUpdateSession(req: NextRequest) {
  const { updateSession } = await import('./proxy');
  return updateSession(req);
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-pk';
  getUserMock = () => Promise.resolve({ data: { user: null } });
  userRowMock = { data: null };
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('updateSession (proxy)', () => {
  it('passes through public paths without auth', async () => {
    const res = await callUpdateSession(makeRequest('/login'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects unauthenticated users to /login on protected paths', async () => {
    const res = await callUpdateSession(makeRequest('/search'));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('redirects authenticated users to / when they hit /login', async () => {
    getUserMock = () => Promise.resolve({ data: { user: { id: 'u-1' } } });
    const res = await callUpdateSession(makeRequest('/login'));
    expect(res.status).toBeGreaterThanOrEqual(300);
    const loc = res.headers.get('location') ?? '';
    expect(loc.endsWith('/')).toBe(true);
  });

  it('redirects to /access-denied when user has no row in public.users', async () => {
    getUserMock = () => Promise.resolve({ data: { user: { id: 'u-1' } } });
    userRowMock = { data: null };
    const res = await callUpdateSession(makeRequest('/search'));
    expect(res.headers.get('location')).toContain('/access-denied');
  });

  it('redirects to /access-denied when user is soft-deleted (is_active=false)', async () => {
    getUserMock = () => Promise.resolve({ data: { user: { id: 'u-1' } } });
    userRowMock = { data: { id: 'u-1', role: 'operator', is_active: false } };
    const res = await callUpdateSession(makeRequest('/search'));
    expect(res.headers.get('location')).toContain('/access-denied');
  });

  it('redirects non-admin to /access-denied on /admin/* paths', async () => {
    getUserMock = () => Promise.resolve({ data: { user: { id: 'u-1' } } });
    userRowMock = { data: { id: 'u-1', role: 'operator', is_active: true } };
    const res = await callUpdateSession(makeRequest('/admin/users'));
    expect(res.headers.get('location')).toContain('/access-denied');
  });

  it('allows admins on /admin/* paths', async () => {
    getUserMock = () => Promise.resolve({ data: { user: { id: 'u-1' } } });
    userRowMock = { data: { id: 'u-1', role: 'admin', is_active: true } };
    const res = await callUpdateSession(makeRequest('/admin/users'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('allows active operators on non-admin protected paths', async () => {
    getUserMock = () => Promise.resolve({ data: { user: { id: 'u-1' } } });
    userRowMock = { data: { id: 'u-1', role: 'operator', is_active: true } };
    const res = await callUpdateSession(makeRequest('/search'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('treats /auth/* as public', async () => {
    const res = await callUpdateSession(makeRequest('/auth/callback'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});
