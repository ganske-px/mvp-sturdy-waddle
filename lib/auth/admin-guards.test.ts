import { describe, expect, it, vi } from 'vitest';

// `server-only` is a runtime marker shipped via Next.js; it has no Node
// resolution and would fail to import under Vitest. Stub it out.
vi.mock('server-only', () => ({}));

import { LockoutError, assertNotLastActiveAdmin, assertNotSelf } from './admin-guards';

function buildClient(otherAdminsCount: number) {
  return {
    from(table: string) {
      if (table !== 'users') throw new Error(`unexpected table ${table}`);
      return {
        select: (_cols: string, _opts: { count: 'exact'; head: true }) => ({
          eq: (_col: string, _val: unknown) => ({
            eq: (_col2: string, _val2: unknown) => ({
              neq: (_col3: string, _val3: unknown) =>
                Promise.resolve({ count: otherAdminsCount, error: null }),
            }),
          }),
        }),
      };
    },
  };
}

describe('assertNotSelf', () => {
  it('throws when adminId === targetId', () => {
    expect(() => assertNotSelf('u1', 'u1', 'deactivate')).toThrowError(LockoutError);
  });
  it('does not throw when ids differ', () => {
    expect(() => assertNotSelf('u1', 'u2', 'deactivate')).not.toThrow();
  });
});

describe('assertNotLastActiveAdmin', () => {
  it('throws when no other admins remain', async () => {
    await expect(
      assertNotLastActiveAdmin(buildClient(0) as never, 'target', 'deactivate'),
    ).rejects.toBeInstanceOf(LockoutError);
  });
  it('passes when at least one other admin remains', async () => {
    await expect(
      assertNotLastActiveAdmin(buildClient(1) as never, 'target', 'demote'),
    ).resolves.toBeUndefined();
  });
});
