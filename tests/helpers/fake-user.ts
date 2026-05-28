import type { Database } from '@/lib/supabase/types';

export type FakeUserRow = Database['public']['Tables']['users']['Row'];

export function fakeAdmin(overrides: Partial<FakeUserRow> = {}): FakeUserRow {
  return {
    id: 'admin-1',
    email: 'admin@example.com',
    display_name: 'Admin User',
    role: 'admin',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export function fakeOperator(overrides: Partial<FakeUserRow> = {}): FakeUserRow {
  return {
    id: 'op-1',
    email: 'op@example.com',
    display_name: 'Operator User',
    role: 'operator',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}
