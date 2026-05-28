# Roles e Permissões — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar dois papéis (admin/operator) com permissões por usuário sobre três serviços (busca pessoa, busca empresa, busca lote), além de UI admin para criar/ativar/desativar operadores e visualizar audit log global.

**Architecture:** Tabela separada `user_service_permissions` (linha presente = permissão concedida). Helpers SQL `is_admin()` / `has_service_permission()` são fonte única de verdade consumida por RLS, proxy e a camada `lib/auth`. Admins têm todas as permissões automaticamente. Operadores existentes ficam sem nenhuma permissão após a migration; primeiro admin é promovido via SQL manual no Studio.

**Tech Stack:** Supabase (Postgres 16 + RLS + helpers SECURITY DEFINER) · Next.js 16 App Router + React 19 · Vitest (Node) · Storybook 10 + test-runner + Playwright para UI · Biome.

**Spec:** [`docs/superpowers/specs/2026-05-21-roles-and-permissions-design.md`](../specs/2026-05-21-roles-and-permissions-design.md)

---

## Atualização — design system Radar PX (pós-commit `be9150d`)

O commit `be9150d` aplicou o design system "Radar PX · KYC · KYB · KYE Check" e traduziu toda a UI para pt-BR. Padrões a seguir nas tasks de UI deste plano:

**Page header padrão** (todas as páginas; aplicar em /search/person, /search/company, /admin/users, /admin/users/new, /admin/users/[id], /admin/audit):

```tsx
<header className="flex flex-col gap-2">
  <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
    {EYEBROW}
  </span>
  <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
    {TITLE}
  </h1>
  <p className="text-muted-foreground">{DESCRIPTION}</p>
</header>
```

**Main container**: `mx-auto flex w-full max-w-{3xl|4xl|5xl|6xl} flex-col gap-6 px-6 py-12` (form pages: 3xl; tables: 4xl/5xl; admin shell: 6xl; home: 5xl + py-14).

**Estado vazio**: `<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/30 py-10">…</div>`.

**Badge**: o componente agora aceita `size="sm" | "default" | "lg"` e expandiu variants (`muted`, `info`, `success`, `warning`, `destructive`, `purple`, `dark-blue`, `outline`, `secondary`, `default`). Usar `size="sm"` em badges dentro de tabelas.

**Page titles**: sufixo `— Radar PX` em todos os `metadata.title` (`'Buscar pessoa — Radar PX'`, `'Operadores — Radar PX'`, etc.). Páginas dentro de `/admin` podem usar sufixo `— Admin · Radar PX`.

**AppHeader**: já tem visual definido (radar pill + "Radar PX" + KYC pílula + nav `rounded-full` com active state `bg-tertiary/60 text-primary`). A Task 12 abaixo **preserva o visual** e apenas adiciona props (`user`, `permissions`) com filtragem de itens.

**Vendor name remediation**: o commit traduziu copy mas ainda há 3 ocorrências de "Predictus":
- `app/layout.tsx:27` (description)
- `app/(app)/page.tsx:99` (home copy) — substituída pela Task 22 (home redesign)
- `app/(app)/search/page.tsx:18` (page copy) — substituída pela Task 13 (route split)
- `app/(app)/search/search-client.tsx:187` (empty state copy) — substituída pela Task 13

A Task 23 fica reduzida a (a) trocar a description em `app/layout.tsx` e (b) verificar com grep que nenhuma menção restou.

---

## File map

**Criados:**
- `supabase/migrations/20260521120000_user_roles_permissions.sql`
- `supabase/migrations/20260521120100_rls_updates.sql`
- `lib/auth/permissions.ts` + `.test.ts`
- `lib/auth/admin-guards.ts` + `.test.ts`
- `lib/validators/password.ts` + `.test.ts`
- `tests/helpers/fake-user.ts`
- `app/(app)/search/person/page.tsx` + `actions.ts` + `search-client.tsx`
- `app/(app)/search/company/page.tsx` + `actions.ts` + `search-client.tsx`
- `app/(app)/home-modules.tsx` + `.stories.tsx` (substitui o atual home embutido)
- `app/admin/layout.tsx`
- `app/admin/users/page.tsx`
- `app/admin/users/new/page.tsx`
- `app/admin/users/[id]/page.tsx`
- `app/admin/users/actions.ts`
- `app/admin/users/user-form.tsx` + `.stories.tsx`
- `app/admin/users/users-table.tsx` + `.stories.tsx`
- `app/admin/audit/page.tsx`
- `app/admin/audit/audit-table.tsx` + `.stories.tsx`

**Modificados:**
- `lib/supabase/types.ts`
- `lib/supabase/proxy.ts`
- `lib/audit.test.ts` (novos actions válidos)
- `components/app-header.tsx` + `.stories.tsx`
- `app/(app)/layout.tsx`
- `app/(app)/page.tsx`
- `app/(app)/bulk/actions.ts`
- `README.md`
- `CLAUDE.md`

**Removidos:**
- `app/(app)/search/page.tsx`, `actions.ts`, `search-client.tsx` (substituídos por person/company)
- `app/(app)/audit/page.tsx` (movido para `/admin/audit`)

---

## Fase 1 — Schema + tipos

### Task 1: Migration de schema (role, is_active, permissões, helpers, audit_log CHECK)

**Files:**
- Create: `supabase/migrations/20260521120000_user_roles_permissions.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- ============================================================================
-- 20260521120000_user_roles_permissions.sql
-- Adds two-role model (admin / operator), is_active flag, per-user service
-- permissions table, and SQL helpers used by RLS, proxy and lib/auth.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- public.users: role + is_active
-- ----------------------------------------------------------------------------
alter table public.users
  add column role text not null default 'operator'
    check (role in ('admin', 'operator')),
  add column is_active boolean not null default true;

create index users_active_role_idx on public.users (is_active, role);

comment on column public.users.role is
  'Two-role model. Admins always have all service permissions via helpers.';
comment on column public.users.is_active is
  'Soft-delete flag. Inactive users are blocked by the proxy. UI never deletes.';

-- ----------------------------------------------------------------------------
-- public.user_service_permissions
--   row present = permission granted; missing row = denied.
--   service vocabulary is extensible by widening the CHECK.
-- ----------------------------------------------------------------------------
create table public.user_service_permissions (
  user_id uuid not null references public.users(id) on delete cascade,
  service text not null check (service in (
    'search_person', 'search_company', 'search_bulk'
  )),
  granted_at timestamptz not null default now(),
  granted_by uuid references public.users(id) on delete set null,
  primary key (user_id, service)
);

create index user_service_permissions_user_idx
  on public.user_service_permissions (user_id);

alter table public.user_service_permissions enable row level security;

comment on table public.user_service_permissions is
  'Per-user grants for callable services. Admins bypass this table via helpers.';

-- ----------------------------------------------------------------------------
-- Helper: is_admin(uid)
-- ----------------------------------------------------------------------------
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = uid and role = 'admin' and is_active = true
  );
$$;

comment on function public.is_admin(uuid) is
  'True iff the given user is an active admin. SECURITY DEFINER so RLS '
  'policies and the proxy can call it without recursing into users RLS.';

-- ----------------------------------------------------------------------------
-- Helper: has_service_permission(uid, svc)
-- ----------------------------------------------------------------------------
create or replace function public.has_service_permission(uid uuid, svc text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users u
    where u.id = uid
      and u.is_active = true
      and (
        u.role = 'admin'
        or exists (
          select 1 from public.user_service_permissions p
          where p.user_id = uid and p.service = svc
        )
      )
  );
$$;

comment on function public.has_service_permission(uuid, text) is
  'Single source of truth: admin OR explicit grant, gated by is_active.';

-- ----------------------------------------------------------------------------
-- Expand audit_log.action vocabulary
-- ----------------------------------------------------------------------------
alter table public.audit_log drop constraint audit_log_action_check;

alter table public.audit_log
  add constraint audit_log_action_check
  check (action in (
    'login',
    'logout',
    'search_single',
    'search_bulk_item',
    'bulk_job_created',
    'export_csv',
    'admin_user_created',
    'admin_user_set_active',
    'admin_user_set_role',
    'admin_user_permission_changed'
  ));
```

- [ ] **Step 2: Aplicar contra o Supabase local**

```bash
pnpm exec supabase db reset
```

Expected: migration runs without error; output ends with `Finished supabase db reset`.

- [ ] **Step 3: Smoke do schema no Studio (psql)**

```bash
psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" -c "\d public.users" -c "\d public.user_service_permissions" -c "select public.is_admin('00000000-0000-0000-0000-000000000000');"
```

Expected: `users` lists `role` and `is_active` columns; `user_service_permissions` table exists with PK `(user_id, service)`; `is_admin(...)` returns `f`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260521120000_user_roles_permissions.sql
git commit -m "feat(db): add roles, is_active flag, per-user service permissions + helpers"
```

---

### Task 2: Migration de RLS

**Files:**
- Create: `supabase/migrations/20260521120100_rls_updates.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- ============================================================================
-- 20260521120100_rls_updates.sql
-- New policies for user_service_permissions, admin view over users,
-- and admin/global view over audit_log.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- audit_log: replace own-only policy with own-or-admin
-- ----------------------------------------------------------------------------
drop policy audit_log_own_select on public.audit_log;

create policy audit_log_select_own_or_admin on public.audit_log
  for select using (
    auth.uid() = user_id or public.is_admin(auth.uid())
  );

-- ----------------------------------------------------------------------------
-- users: admin can see every operator row (operator self-select policy stays).
-- Writes still service-role only — no policy here.
-- ----------------------------------------------------------------------------
create policy users_admin_select on public.users
  for select using (public.is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- user_service_permissions:
--   SELECT: self OR admin
--   ALL (incl. write): admin only (operators can never grant themselves)
-- ----------------------------------------------------------------------------
create policy usp_select_self_or_admin on public.user_service_permissions
  for select using (
    auth.uid() = user_id or public.is_admin(auth.uid())
  );

create policy usp_admin_write on public.user_service_permissions
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
```

- [ ] **Step 2: Aplicar e validar**

```bash
pnpm exec supabase db reset
```

Expected: migration runs to completion.

- [ ] **Step 3: Smoke das policies**

```bash
psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" -c "select policyname from pg_policies where schemaname='public' order by tablename, policyname;"
```

Expected (subset of output):
```
audit_log_select_own_or_admin
usp_admin_write
usp_select_self_or_admin
users_admin_select
users_self_select
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260521120100_rls_updates.sql
git commit -m "feat(db): RLS — admins see global audit + manage user permissions"
```

---

### Task 3: Atualizar lib/supabase/types.ts

**Files:**
- Modify: `lib/supabase/types.ts`

- [ ] **Step 1: Adicionar role+is_active na tabela users (Row/Insert/Update)**

Localizar o bloco `users:` (atualmente nas linhas 7-26 de `lib/supabase/types.ts`) e substituir por:

```ts
      users: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          role: 'admin' | 'operator';
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          role?: 'admin' | 'operator';
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string | null;
          role?: 'admin' | 'operator';
          is_active?: boolean;
          created_at?: string;
        };
      };
```

- [ ] **Step 2: Adicionar tabela user_service_permissions**

Inserir o bloco abaixo dentro de `Tables:`, antes de `audit_log:`:

```ts
      user_service_permissions: {
        Row: {
          user_id: string;
          service: 'search_person' | 'search_company' | 'search_bulk';
          granted_at: string;
          granted_by: string | null;
        };
        Insert: {
          user_id: string;
          service: 'search_person' | 'search_company' | 'search_bulk';
          granted_at?: string;
          granted_by?: string | null;
        };
        Update: {
          user_id?: string;
          service?: 'search_person' | 'search_company' | 'search_bulk';
          granted_at?: string;
          granted_by?: string | null;
        };
      };
```

- [ ] **Step 3: Expandir o enum de audit_log.action nas 3 cláusulas (Row/Insert/Update)**

Substituir o array atual em cada cláusula:

```ts
          action:
            | 'login'
            | 'logout'
            | 'search_single'
            | 'search_bulk_item'
            | 'bulk_job_created'
            | 'export_csv'
            | 'admin_user_created'
            | 'admin_user_set_active'
            | 'admin_user_set_role'
            | 'admin_user_permission_changed';
```

(Aplicar nas três: `Row.action`, `Insert.action`, `Update.action`.)

- [ ] **Step 4: Adicionar bloco Functions com os helpers SQL**

Adicionar dentro de `public:`, depois de `Tables:`:

```ts
    Functions: {
      is_admin: {
        Args: { uid: string };
        Returns: boolean;
      };
      has_service_permission: {
        Args: { uid: string; svc: string };
        Returns: boolean;
      };
    };
```

- [ ] **Step 5: Verificar tipos**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add lib/supabase/types.ts
git commit -m "feat(types): add role, is_active, user_service_permissions, audit actions"
```

---

## Fase 2 — Camada lib/auth (TDD)

### Task 4: lib/auth/permissions.ts (TDD)

**Files:**
- Create: `lib/auth/permissions.ts`
- Create: `lib/auth/permissions.test.ts`
- Create: `tests/helpers/fake-user.ts`

- [ ] **Step 1: Escrever os helpers de teste**

Em `tests/helpers/fake-user.ts`:

```ts
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
```

- [ ] **Step 2: Escrever o teste falhando**

Em `lib/auth/permissions.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { fakeAdmin, fakeOperator } from '@/tests/helpers/fake-user';

// Mock next/navigation.redirect so we can assert without a real Next runtime.
const redirectMock = vi.fn((url: string) => {
  throw new Error(`__REDIRECT__${url}`);
});
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
            maybeSingle: () =>
              Promise.resolve({ data: userRow, error: null }),
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
  requireAuth,
  requireAdmin,
  requirePermission,
} from './permissions';

const mocked = vi.mocked(createClient);

describe('getCurrentUser', () => {
  it('returns null when no session', async () => {
    mocked.mockResolvedValueOnce(
      buildSupabaseMock({ userRow: null, authUser: null }) as never,
    );
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
    await expect(requirePermission('search_bulk')).rejects.toThrow(
      '__REDIRECT__/access-denied',
    );
  });
});

describe('ALL_SERVICES', () => {
  it('contains the three known services', () => {
    expect([...ALL_SERVICES].sort()).toEqual([
      'search_bulk',
      'search_company',
      'search_person',
    ]);
  });
});
```

- [ ] **Step 3: Rodar testes para confirmar que falham**

```bash
pnpm test -- lib/auth/permissions
```

Expected: tests FAIL with "Cannot find module './permissions'" or similar.

- [ ] **Step 4: Implementar lib/auth/permissions.ts**

```ts
import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type Service = 'search_person' | 'search_company' | 'search_bulk';

export const ALL_SERVICES: readonly Service[] = [
  'search_person',
  'search_company',
  'search_bulk',
] as const;

export type AppUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'operator';
  is_active: boolean;
};

export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: row } = await supabase
    .from('users')
    .select('id, email, display_name, role, is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
    is_active: row.is_active,
  };
}

export async function requireAuth(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user || !user.is_active) redirect('/access-denied');
  return user;
}

export async function requireAdmin(): Promise<AppUser> {
  const user = await requireAuth();
  if (user.role !== 'admin') redirect('/access-denied');
  return user;
}

export async function requirePermission(svc: Service): Promise<AppUser> {
  const user = await requireAuth();
  if (user.role === 'admin') return user;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('has_service_permission', {
    uid: user.id,
    svc,
  });
  if (error || data !== true) redirect('/access-denied');
  return user;
}

export async function listUserPermissions(userId: string): Promise<Set<Service>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('user_service_permissions')
    .select('service')
    .eq('user_id', userId);
  return new Set((data ?? []).map((r) => r.service as Service));
}
```

- [ ] **Step 5: Rodar testes para confirmar que passam**

```bash
pnpm test -- lib/auth/permissions
```

Expected: all tests PASS.

- [ ] **Step 6: Lint + typecheck**

```bash
pnpm typecheck && pnpm lint:fix
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add lib/auth/permissions.ts lib/auth/permissions.test.ts tests/helpers/fake-user.ts
git commit -m "feat(auth): permissions module (getCurrentUser, require*, listUserPermissions)"
```

---

### Task 5: lib/auth/admin-guards.ts (TDD)

**Files:**
- Create: `lib/auth/admin-guards.ts`
- Create: `lib/auth/admin-guards.test.ts`

- [ ] **Step 1: Escrever o teste falhando**

Em `lib/auth/admin-guards.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  assertNotLastActiveAdmin,
  assertNotSelf,
  LockoutError,
} from './admin-guards';

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
```

- [ ] **Step 2: Rodar testes (falham)**

```bash
pnpm test -- lib/auth/admin-guards
```

Expected: FAIL "Cannot find module './admin-guards'".

- [ ] **Step 3: Implementar admin-guards.ts**

```ts
import 'server-only';
import type { Database } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export class LockoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockoutError';
  }
}

export type AdminChange = 'deactivate' | 'demote';

export function assertNotSelf(
  adminId: string,
  targetId: string,
  change: AdminChange,
): void {
  if (adminId !== targetId) return;
  const action = change === 'deactivate' ? 'desativar' : 'rebaixar';
  throw new LockoutError(`Você não pode ${action} a si próprio.`);
}

export async function assertNotLastActiveAdmin(
  client: SupabaseClient<Database>,
  targetId: string,
  change: AdminChange,
): Promise<void> {
  const { count, error } = await client
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .eq('is_active', true)
    .neq('id', targetId);
  if (error) {
    throw new Error(`assertNotLastActiveAdmin query failed: ${error.message}`);
  }
  if (!count || count === 0) {
    const action = change === 'deactivate' ? 'desativar' : 'rebaixar';
    throw new LockoutError(`Não é possível ${action} o único administrador ativo.`);
  }
}
```

- [ ] **Step 4: Testes passam**

```bash
pnpm test -- lib/auth/admin-guards
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint:fix
git add lib/auth/admin-guards.ts lib/auth/admin-guards.test.ts
git commit -m "feat(auth): admin guards — assertNotSelf, assertNotLastActiveAdmin"
```

---

### Task 6: lib/validators/password.ts (TDD)

**Files:**
- Create: `lib/validators/password.ts`
- Create: `lib/validators/password.test.ts`

- [ ] **Step 1: Escrever o teste**

Em `lib/validators/password.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { generateStrongPassword, validateTempPassword } from './password';

describe('validateTempPassword', () => {
  it('rejects strings shorter than 12 chars', () => {
    expect(validateTempPassword('short')).toEqual({
      ok: false,
      error: 'A senha precisa ter pelo menos 12 caracteres.',
    });
  });
  it('rejects empty strings', () => {
    expect(validateTempPassword('')).toEqual({
      ok: false,
      error: 'A senha precisa ter pelo menos 12 caracteres.',
    });
  });
  it('accepts strings ≥12 chars', () => {
    expect(validateTempPassword('Twelve-chars')).toEqual({ ok: true });
    expect(validateTempPassword('a'.repeat(64))).toEqual({ ok: true });
  });
});

describe('generateStrongPassword', () => {
  it('produces ≥16 chars by default', () => {
    expect(generateStrongPassword().length).toBeGreaterThanOrEqual(16);
  });
  it('respects custom length ≥12', () => {
    expect(generateStrongPassword(20).length).toBe(20);
  });
  it('throws on length < 12', () => {
    expect(() => generateStrongPassword(8)).toThrow(/12/);
  });
  it('contains at least one of each class', () => {
    const pw = generateStrongPassword();
    expect(/[a-z]/.test(pw)).toBe(true);
    expect(/[A-Z]/.test(pw)).toBe(true);
    expect(/\d/.test(pw)).toBe(true);
    expect(/[!@#$%^&*\-_=+]/.test(pw)).toBe(true);
  });
});
```

- [ ] **Step 2: Confirmar falha**

```bash
pnpm test -- lib/validators/password
```

Expected: FAIL "Cannot find module './password'".

- [ ] **Step 3: Implementar**

Em `lib/validators/password.ts`:

```ts
const MIN_LENGTH = 12;
const DEFAULT_LENGTH = 16;

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*-_=+';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateTempPassword(value: string): ValidationResult {
  if (value.length < MIN_LENGTH) {
    return {
      ok: false,
      error: `A senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`,
    };
  }
  return { ok: true };
}

export function generateStrongPassword(length: number = DEFAULT_LENGTH): string {
  if (length < MIN_LENGTH) {
    throw new Error(`Password length must be at least ${MIN_LENGTH}.`);
  }
  const required = [
    pickRandom(LOWER),
    pickRandom(UPPER),
    pickRandom(DIGITS),
    pickRandom(SYMBOLS),
  ];
  const remaining = Array.from({ length: length - required.length }, () => pickRandom(ALL));
  const chars = shuffle([...required, ...remaining]);
  return chars.join('');
}

function pickRandom(pool: string): string {
  const idx = Math.floor(secureRandom() * pool.length);
  return pool[idx] ?? '';
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(secureRandom() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function secureRandom(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return (buf[0] ?? 0) / 0x1_0000_0000;
  }
  return Math.random();
}
```

- [ ] **Step 4: Testes passam**

```bash
pnpm test -- lib/validators/password
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint:fix
git add lib/validators/password.ts lib/validators/password.test.ts
git commit -m "feat(validators): password validator + strong password generator"
```

---

### Task 7: Atualizar lib/audit.test.ts (novos actions)

**Files:**
- Modify: `lib/audit.test.ts`

- [ ] **Step 1: Adicionar caso de teste para um dos novos actions**

Acrescentar ao final do bloco `describe('writeAuditLog — happy paths', ...)` em `lib/audit.test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar testes**

```bash
pnpm test -- lib/audit
```

Expected: all PASS (the strings flow through; the type system was widened in Task 3).

- [ ] **Step 3: Commit**

```bash
git add lib/audit.test.ts
git commit -m "test(audit): cover the four admin_user_* actions"
```

---

## Fase 3 — Proxy + gates nas Server Actions existentes

### Task 8: Atualizar lib/supabase/proxy.ts (is_active + /admin gate)

**Files:**
- Modify: `lib/supabase/proxy.ts`

- [ ] **Step 1: Substituir o bloco que faz a verificação de allowlist**

Localizar o bloco `if (user && !isPublic) { ... }` (linhas 41-56) e substituir por:

```ts
  if (user && !isPublic) {
    // Single SELECT pulls all the gates we need: allowlist presence,
    // soft-deletion (is_active), and admin-area access (role).
    const { data: row } = await supabase
      .from('users')
      .select('id, role, is_active')
      .eq('id', user.id)
      .maybeSingle();

    if (!row || !row.is_active) {
      const url = request.nextUrl.clone();
      url.pathname = '/access-denied';
      return NextResponse.redirect(url);
    }

    if (pathname.startsWith('/admin') && row.role !== 'admin') {
      const url = request.nextUrl.clone();
      url.pathname = '/access-denied';
      return NextResponse.redirect(url);
    }
  }
```

- [ ] **Step 2: Build typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/proxy.ts
git commit -m "feat(proxy): block inactive users; gate /admin to role=admin"
```

---

### Task 9: Gate em app/(app)/search/actions.ts (search_type → permission)

**Files:**
- Modify: `app/(app)/search/actions.ts`

> Esta task adiciona um gate condicional no `searchByDoc` atual (que ainda atende os três tipos). A Fase 4 separa em duas rotas (`/person` e `/company`), que substitui esse gate condicional por gates fixos.

- [ ] **Step 1: Importar requirePermission e mapear search_type**

No topo de `app/(app)/search/actions.ts`, acrescentar import:

```ts
import { requirePermission, type Service } from '@/lib/auth/permissions';
```

E logo após a verificação `if (!user) ...` (atualmente linha 49), inserir:

```ts
  const requiredService: Service =
    input.type === 'cnpj' ? 'search_company' : 'search_person';
  // person covers both 'cpf' and 'name' searches per the spec.
  await requirePermission(requiredService);
```

> Não passar pelo `requirePermission` se a action retornar erro antes (não há fluxo dessa natureza aqui — `user` ausente faz return). O `requirePermission` redireciona via `next/navigation.redirect`, encerrando a Server Action.

- [ ] **Step 2: Build**

```bash
pnpm build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/search/actions.ts
git commit -m "feat(search): gate searchByDoc by search_person/search_company permission"
```

---

### Task 10: Gate em app/(app)/bulk/actions.ts

**Files:**
- Modify: `app/(app)/bulk/actions.ts`

- [ ] **Step 1: Importar e gatear**

No topo de `app/(app)/bulk/actions.ts`, acrescentar:

```ts
import { requirePermission } from '@/lib/auth/permissions';
```

Logo após `if (!user) return { error: 'Not authenticated.' };` (atualmente linha 28), inserir:

```ts
  await requirePermission('search_bulk');
```

- [ ] **Step 2: Build**

```bash
pnpm build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/bulk/actions.ts
git commit -m "feat(bulk): gate createBulkJobAction by search_bulk permission"
```

---

### Task 11: app/(app)/layout.tsx carrega user + permissions

**Files:**
- Modify: `app/(app)/layout.tsx`

- [ ] **Step 1: Substituir o conteúdo completo do arquivo**

Conteúdo atual presumido: layout simples renderizando `<AppHeader />` e `{children}`. Substituir por:

```tsx
import { AppHeader } from '@/components/app-header';
import { listUserPermissions, requireAuth } from '@/lib/auth/permissions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  const permissions = await listUserPermissions(user.id);
  return (
    <>
      <AppHeader user={user} permissions={[...permissions]} />
      {children}
    </>
  );
}
```

> Passamos `permissions` como array (não `Set`) porque o `AppHeader` é client component e Set não atravessa o serializador do RSC sem custom plumbing.

- [ ] **Step 2: Build**

```bash
pnpm build
```

Expected: build typecheck passa (AppHeader vai precisar aceitar as novas props — feito na próxima task).

> Se a build falhar nessa task por causa do props mismatch, é esperado — vai resolver na Task 12. Não comitar ainda.

- [ ] **Step 3: Continuar para Task 12 antes de commitar**

(este passo só comita junto com a Task 12)

---

### Task 12: app/(app)/layout.tsx + components/app-header.tsx + stories

**Files:**
- Modify: `components/app-header.tsx`
- Modify: `components/app-header.stories.tsx`

- [ ] **Step 1: Reescrever components/app-header.tsx — preserva visual Radar PX, adiciona props**

```tsx
'use client';

import { SignOutButton } from '@/components/sign-out-button';
import type { AppUser, Service } from '@/lib/auth/permissions';
import { cn } from '@/lib/utils';
import { RadarIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavItem = { href: string; label: string; gate?: Service | 'admin' };

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/search/person', label: 'Pessoa', gate: 'search_person' },
  { href: '/search/company', label: 'Empresa', gate: 'search_company' },
  { href: '/bulk', label: 'Lote', gate: 'search_bulk' },
  { href: '/history', label: 'Histórico' },
  { href: '/admin/users', label: 'Operadores', gate: 'admin' },
  { href: '/admin/audit', label: 'Auditoria', gate: 'admin' },
] as const;

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative inline-flex h-9 items-center rounded-full px-3.5 text-[0.85rem] font-medium transition-colors',
        active
          ? 'bg-tertiary/60 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {label}
    </Link>
  );
}

function isVisible(item: NavItem, user: AppUser, permissions: ReadonlySet<Service>): boolean {
  if (!item.gate) return true;
  if (item.gate === 'admin') return user.role === 'admin';
  if (user.role === 'admin') return true;
  return permissions.has(item.gate);
}

export function AppHeader({
  user,
  permissions,
}: {
  user: AppUser;
  permissions: readonly Service[];
}) {
  const permSet = new Set(permissions);
  const visible = NAV_ITEMS.filter((i) => isVisible(i, user, permSet));
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-6">
        <Link
          href="/"
          className="group flex items-center gap-2.5"
          aria-label="Radar PX — página inicial"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-card transition-transform group-hover:-rotate-6">
            <RadarIcon className="size-[18px]" strokeWidth={2.2} />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-heading text-[1.05rem] font-semibold tracking-tight text-foreground">
              Radar <span className="text-primary">PX</span>
            </span>
            <span className="hidden text-[0.65rem] font-medium uppercase tracking-[0.18em] text-muted-foreground sm:inline">
              KYC · KYB · KYE
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Principal">
          {visible.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} />
          ))}
        </nav>

        <SignOutButton />
      </div>
    </header>
  );
}
```

> **Variável**: `user` é prop dummy (não usado no JSX direto); fica reservado para futura badge "Admin" no header. Mantida na interface para a Task 11 não precisar mudar.

- [ ] **Step 2: Atualizar `components/app-header.stories.tsx` completamente**

```tsx
import type { Meta, StoryObj } from '@storybook/nextjs';
import type { AppUser, Service } from '@/lib/auth/permissions';
import { AppHeader } from './app-header';

const admin: AppUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  display_name: 'Admin',
  role: 'admin',
  is_active: true,
};

const operator: AppUser = {
  id: 'op-1',
  email: 'op@example.com',
  display_name: 'Operadora',
  role: 'operator',
  is_active: true,
};

const ALL_PERMS: readonly Service[] = ['search_person', 'search_company', 'search_bulk'];

const meta = {
  title: 'App/AppHeader',
  component: AppHeader,
  parameters: {
    layout: 'fullscreen',
    nextjs: {
      appDirectory: true,
      navigation: { pathname: '/search/person' },
    },
  },
  decorators: [
    (Story) => (
      <div className="min-h-[200px] bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AppHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AsAdmin: Story = {
  args: { user: admin, permissions: [] },
};

export const AsOperatorWithAll: Story = {
  args: { user: operator, permissions: ALL_PERMS },
};

export const AsOperatorWithPersonOnly: Story = {
  args: { user: operator, permissions: ['search_person'] },
};

export const AsOperatorWithoutPermissions: Story = {
  args: { user: operator, permissions: [] },
};

export const CompanyActive: Story = {
  args: { user: operator, permissions: ALL_PERMS },
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: '/search/company' } },
  },
};

export const BulkJobDetail: Story = {
  name: 'Bulk job detail (active = Lote)',
  args: { user: operator, permissions: ALL_PERMS },
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: '/bulk/abc-123' } },
  },
};
```

- [ ] **Step 3: Atualizar baselines visuais**

```bash
pnpm test:visual:update
```

Expected: snapshot files updated under `__image_snapshots__/`. Inspect and verify diff is intentional.

- [ ] **Step 4: Build + lint**

```bash
pnpm build && pnpm lint:fix && pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit (junto com a mudança do layout)**

```bash
git add app/\(app\)/layout.tsx components/app-header.tsx components/app-header.stories.tsx __image_snapshots__/
git commit -m "feat(ui): header filters nav by user permissions; pt-BR labels"
```

---

## Fase 4 — Separar /search em pessoa e empresa

### Task 13: Criar app/(app)/search/person/ a partir do /search atual

**Files:**
- Create: `app/(app)/search/person/page.tsx`
- Create: `app/(app)/search/person/actions.ts`
- Create: `app/(app)/search/person/search-client.tsx`
- Delete: `app/(app)/search/page.tsx`
- Delete: `app/(app)/search/actions.ts`
- Delete: `app/(app)/search/search-client.tsx`

- [ ] **Step 1: Copiar os três arquivos atuais para a nova pasta**

```bash
mkdir -p app/\(app\)/search/person
cp app/\(app\)/search/page.tsx app/\(app\)/search/person/page.tsx
cp app/\(app\)/search/actions.ts app/\(app\)/search/person/actions.ts
cp app/\(app\)/search/search-client.tsx app/\(app\)/search/person/search-client.tsx
```

- [ ] **Step 2: Substituir `app/(app)/search/person/actions.ts` por completo**

```ts
'use server';

import { extractRequestContext, writeAuditLog } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/permissions';
import { hashDocument } from '@/lib/hash';
import { getCachedResults, setCachedResults } from '@/lib/predictus/cache';
import { createServerPredictusClient } from '@/lib/predictus/server-client';
import type { PredictusProcess } from '@/lib/predictus/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { format as formatCpf, isValid as isCpfValid, mask as maskCpf } from '@/lib/validators/cpf';
import { maskName } from '@/lib/validators/name';
import { headers } from 'next/headers';

export type PersonSearchType = 'cpf' | 'name';

export type SearchPersonInput = { type: PersonSearchType; rawInput: string };

export type SearchPersonOk = {
  ok: true;
  results: PredictusProcess[];
  displayTerm: string;
  searchType: PersonSearchType;
  cached: boolean;
  fetchedAt: string;
};

export type SearchPersonErr = { ok: false; error: string };

export type SearchPersonResult = SearchPersonOk | SearchPersonErr;

export async function searchPerson(input: SearchPersonInput): Promise<SearchPersonResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado.' };

  await requirePermission('search_person');

  const trimmed = input.rawInput.trim();
  if (!trimmed) return { ok: false, error: 'Termo de busca vazio.' };

  let documentHash: string;
  let termPreview: string;
  let displayTerm: string;

  if (input.type === 'cpf') {
    if (!isCpfValid(trimmed)) return { ok: false, error: 'CPF inválido.' };
    documentHash = hashDocument('cpf', trimmed);
    termPreview = maskCpf(trimmed);
    displayTerm = formatCpf(trimmed);
  } else {
    if (trimmed.length < 3) {
      return { ok: false, error: 'O nome precisa ter ao menos 3 caracteres.' };
    }
    documentHash = hashDocument('name', trimmed);
    termPreview = maskName(trimmed);
    displayTerm = trimmed;
  }

  const admin = createAdminClient();
  const requestContext = extractRequestContext(await headers());

  await writeAuditLog(
    {
      userId: user.id,
      action: 'search_single',
      searchType: input.type,
      documentHash,
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
    },
    admin,
    { allowFailure: true },
  );

  let cached: { results: PredictusProcess[]; fetchedAt: string } | null = null;
  try {
    cached = await getCachedResults(admin, documentHash);
  } catch (e) {
    console.warn('cache lookup failed:', e);
  }

  if (cached) {
    await supabase.from('searches').insert({
      user_id: user.id,
      search_type: input.type,
      document_hash: documentHash,
      term_preview: termPreview,
      result_count: cached.results.length,
    } as never);
    return {
      ok: true,
      results: cached.results,
      displayTerm,
      searchType: input.type,
      cached: true,
      fetchedAt: cached.fetchedAt,
    };
  }

  let results: PredictusProcess[];
  const fetchedAt = new Date().toISOString();
  try {
    const client = await createServerPredictusClient();
    results =
      input.type === 'cpf'
        ? await client.searchByCpf(trimmed.replace(/\D/g, ''))
        : await client.searchByName(trimmed);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro na consulta.';
    await supabase.from('searches').insert({
      user_id: user.id,
      search_type: input.type,
      document_hash: documentHash,
      term_preview: termPreview,
      result_count: 0,
      error_message: message,
    } as never);
    return { ok: false, error: message };
  }

  try {
    await setCachedResults(admin, documentHash, input.type, results);
  } catch (e) {
    console.warn('cache write failed:', e);
  }

  await supabase.from('searches').insert({
    user_id: user.id,
    search_type: input.type,
    document_hash: documentHash,
    term_preview: termPreview,
    result_count: results.length,
  } as never);

  return {
    ok: true,
    results,
    displayTerm,
    searchType: input.type,
    cached: false,
    fetchedAt,
  };
}
```

- [ ] **Step 3: Substituir `app/(app)/search/person/page.tsx` por completo**

```tsx
import { PersonSearchClient } from './search-client';

export const metadata = { title: 'Buscar pessoa — Radar PX' };

export default function PersonSearchPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
          Consulta individual
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          Buscar pessoa
        </h1>
        <p className="text-muted-foreground">
          Consulta processual por CPF ou nome. Resultados são guardados em cache por 30 dias.
        </p>
      </header>
      <PersonSearchClient />
    </main>
  );
}
```

- [ ] **Step 4: Substituir `app/(app)/search/person/search-client.tsx` por completo**

Conteúdo (versão sem opção CNPJ; export renomeado para `PersonSearchClient`; copy pt-BR sem nome de fornecedor):

```tsx
'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertCircleIcon, CheckCircle2Icon, ClockIcon, SearchIcon, SparklesIcon,
} from 'lucide-react';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { type PersonSearchType, type SearchPersonResult, searchPerson } from './actions';

const TYPE_LABELS: Record<PersonSearchType, string> = {
  cpf: 'CPF',
  name: 'Nome',
};

const TYPE_DESCRIPTIONS: Record<PersonSearchType, string> = {
  cpf: 'Pessoa física por CPF',
  name: 'Pessoa física por nome',
};

const PLACEHOLDERS: Record<PersonSearchType, string> = {
  cpf: '123.456.789-10',
  name: 'João Silva',
};

function formatBRL(value: number | string | undefined): string {
  if (value === undefined || value === null || value === '') return '—';
  const num = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(num)) return String(value);
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'agora';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} d`;
}

async function submitAction(
  _previous: SearchPersonResult | null,
  formData: FormData,
): Promise<SearchPersonResult> {
  const type = (formData.get('type') as PersonSearchType | null) ?? 'cpf';
  const rawInput = String(formData.get('q') ?? '');
  return searchPerson({ type, rawInput });
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      <SearchIcon className="size-4" />
      {pending ? 'Consultando…' : 'Consultar'}
    </Button>
  );
}

export function PersonSearchClient() {
  const [type, setType] = useState<PersonSearchType>('cpf');
  const [state, formAction] = useActionState<SearchPersonResult | null, FormData>(submitAction, null);

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Nova consulta</CardTitle>
          <CardDescription>{TYPE_DESCRIPTIONS[type]}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-5">
            <input type="hidden" name="type" value={type} />

            <div className="flex flex-col gap-2">
              <Label>Tipo</Label>
              <div
                className="inline-flex gap-0.5 rounded-xl border border-border bg-muted/50 p-1"
                role="radiogroup"
                aria-label="Tipo de consulta"
              >
                {(['cpf', 'name'] as const).map((t) => {
                  const active = type === t;
                  return (
                    <button
                      type="button"
                      key={t}
                      // biome-ignore lint/a11y/useSemanticElements: visual segmented toggle
                      role="radio"
                      aria-checked={active}
                      onClick={() => setType(t)}
                      className={
                        active
                          ? 'flex-1 rounded-lg bg-card px-4 py-2 text-sm font-semibold text-primary shadow-card transition-all'
                          : 'flex-1 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground'
                      }
                    >
                      {TYPE_LABELS[t]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="q">Termo</Label>
              <Input
                id="q" name="q" placeholder={PLACEHOLDERS[type]}
                autoComplete="off" required
                className={type === 'name' ? '' : 'font-mono tracking-tight'}
              />
            </div>

            <div className="flex justify-end"><SubmitButton /></div>
          </form>
        </CardContent>
      </Card>

      {state ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <CardTitle>
                  {state.ok
                    ? `${state.results.length} ${state.results.length === 1 ? 'resultado' : 'resultados'}`
                    : 'Consulta falhou'}
                </CardTitle>
                {state.ok ? (
                  <CardDescription>
                    Termo: <span className="font-mono text-foreground">{state.displayTerm}</span>
                  </CardDescription>
                ) : null}
              </div>
              {state.ok ? (
                state.cached ? (
                  <Badge variant="info">
                    <ClockIcon />Em cache · {timeAgo(state.fetchedAt)}
                  </Badge>
                ) : (
                  <Badge variant="success">
                    <SparklesIcon />Resultado fresco
                  </Badge>
                )
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {state.ok ? (
              state.results.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/30 py-10">
                  <CheckCircle2Icon className="size-8 text-success" />
                  <p className="text-sm font-medium">Nenhum processo encontrado</p>
                  <p className="text-xs text-muted-foreground">
                    O documento aparenta estar limpo na fonte de dados.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Processo</TableHead>
                      <TableHead>Tribunal</TableHead>
                      <TableHead>Classe</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.results.map((p, i) => (
                      <TableRow key={p.numeroProcessoUnico ?? `idx-${i}`}>
                        <TableCell className="font-mono text-xs">
                          {p.numeroProcessoUnico ?? '—'}
                        </TableCell>
                        <TableCell className="text-sm">{p.tribunal ?? '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {p.classeProcessual ?? '—'}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatBRL(p.valorCausa?.valor)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )
            ) : (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                <span>{state.error}</span>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Remover os arquivos originais**

```bash
git rm app/\(app\)/search/page.tsx app/\(app\)/search/actions.ts app/\(app\)/search/search-client.tsx
```

- [ ] **Step 6: Build**

```bash
pnpm build
```

Expected: build succeeds. Se algum link no código apontar para `/search` (sem `/person`), corrigir.

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/search/person
git commit -m "feat(search): split person route — CPF + name only"
```

---

### Task 14: Criar app/(app)/search/company/

**Files:**
- Create: `app/(app)/search/company/page.tsx`
- Create: `app/(app)/search/company/actions.ts`
- Create: `app/(app)/search/company/search-client.tsx`

- [ ] **Step 1: actions.ts**

```ts
'use server';

import { extractRequestContext, writeAuditLog } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/permissions';
import { hashDocument } from '@/lib/hash';
import { getCachedResults, setCachedResults } from '@/lib/predictus/cache';
import { createServerPredictusClient } from '@/lib/predictus/server-client';
import type { PredictusProcess } from '@/lib/predictus/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { format as formatCnpj, isValid as isCnpjValid, mask as maskCnpj } from '@/lib/validators/cnpj';
import { headers } from 'next/headers';

export type SearchByCnpjInput = { rawInput: string };

export type SearchByCnpjOk = {
  ok: true;
  results: PredictusProcess[];
  displayTerm: string;
  cached: boolean;
  fetchedAt: string;
};

export type SearchByCnpjErr = { ok: false; error: string };

export type SearchByCnpjResult = SearchByCnpjOk | SearchByCnpjErr;

export async function searchByCnpj(input: SearchByCnpjInput): Promise<SearchByCnpjResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado.' };

  await requirePermission('search_company');

  const trimmed = input.rawInput.trim();
  if (!trimmed) return { ok: false, error: 'Termo de busca vazio.' };
  if (!isCnpjValid(trimmed)) return { ok: false, error: 'CNPJ inválido.' };

  const documentHash = hashDocument('cnpj', trimmed);
  const termPreview = maskCnpj(trimmed);
  const displayTerm = formatCnpj(trimmed);

  const admin = createAdminClient();
  const requestContext = extractRequestContext(await headers());

  await writeAuditLog(
    {
      userId: user.id,
      action: 'search_single',
      searchType: 'cnpj',
      documentHash,
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
    },
    admin,
    { allowFailure: true },
  );

  let cached: { results: PredictusProcess[]; fetchedAt: string } | null = null;
  try {
    cached = await getCachedResults(admin, documentHash);
  } catch (e) {
    console.warn('cache lookup failed, falling through:', e);
  }

  if (cached) {
    await supabase.from('searches').insert({
      user_id: user.id,
      search_type: 'cnpj',
      document_hash: documentHash,
      term_preview: termPreview,
      result_count: cached.results.length,
    } as never);
    return {
      ok: true,
      results: cached.results,
      displayTerm,
      cached: true,
      fetchedAt: cached.fetchedAt,
    };
  }

  let results: PredictusProcess[];
  const fetchedAt = new Date().toISOString();
  try {
    const client = await createServerPredictusClient();
    results = await client.searchByCnpj(trimmed.replace(/\D/g, ''));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro na consulta.';
    await supabase.from('searches').insert({
      user_id: user.id,
      search_type: 'cnpj',
      document_hash: documentHash,
      term_preview: termPreview,
      result_count: 0,
      error_message: message,
    } as never);
    return { ok: false, error: message };
  }

  try {
    await setCachedResults(admin, documentHash, 'cnpj', results);
  } catch (e) {
    console.warn('cache write failed:', e);
  }

  await supabase.from('searches').insert({
    user_id: user.id,
    search_type: 'cnpj',
    document_hash: documentHash,
    term_preview: termPreview,
    result_count: results.length,
  } as never);

  return { ok: true, results, displayTerm, cached: false, fetchedAt };
}
```

- [ ] **Step 2: search-client.tsx (CNPJ-only, sem seletor de tipo)**

```tsx
'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertCircleIcon, CheckCircle2Icon, ClockIcon, SearchIcon, SparklesIcon,
} from 'lucide-react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { type SearchByCnpjResult, searchByCnpj } from './actions';

function formatBRL(value: number | string | undefined): string {
  if (value === undefined || value === null || value === '') return '—';
  const num = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(num)) return String(value);
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'agora';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} d`;
}

async function submitAction(
  _previous: SearchByCnpjResult | null,
  formData: FormData,
): Promise<SearchByCnpjResult> {
  return searchByCnpj({ rawInput: String(formData.get('q') ?? '') });
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      <SearchIcon className="size-4" />
      {pending ? 'Consultando…' : 'Consultar'}
    </Button>
  );
}

export function CompanySearchClient() {
  const [state, formAction] = useActionState<SearchByCnpjResult | null, FormData>(submitAction, null);

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Nova consulta</CardTitle>
          <CardDescription>Pessoa jurídica por CNPJ</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="q">CNPJ</Label>
              <Input
                id="q" name="q" placeholder="12.345.678/0001-99"
                autoComplete="off" required
                className="font-mono tracking-tight"
              />
            </div>
            <div className="flex justify-end"><SubmitButton /></div>
          </form>
        </CardContent>
      </Card>

      {state ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <CardTitle>
                  {state.ok
                    ? `${state.results.length} ${state.results.length === 1 ? 'resultado' : 'resultados'}`
                    : 'Consulta falhou'}
                </CardTitle>
                {state.ok ? (
                  <CardDescription>
                    CNPJ: <span className="font-mono text-foreground">{state.displayTerm}</span>
                  </CardDescription>
                ) : null}
              </div>
              {state.ok ? (
                state.cached ? (
                  <Badge variant="info"><ClockIcon />Em cache · {timeAgo(state.fetchedAt)}</Badge>
                ) : (
                  <Badge variant="success"><SparklesIcon />Resultado fresco</Badge>
                )
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {state.ok ? (
              state.results.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/30 py-10">
                  <CheckCircle2Icon className="size-8 text-success" />
                  <p className="text-sm font-medium">Nenhum processo encontrado</p>
                  <p className="text-xs text-muted-foreground">
                    A empresa aparenta estar limpa na fonte de dados.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Processo</TableHead>
                      <TableHead>Tribunal</TableHead>
                      <TableHead>Classe</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.results.map((p, i) => (
                      <TableRow key={p.numeroProcessoUnico ?? `idx-${i}`}>
                        <TableCell className="font-mono text-xs">{p.numeroProcessoUnico ?? '—'}</TableCell>
                        <TableCell className="text-sm">{p.tribunal ?? '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.classeProcessual ?? '—'}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{formatBRL(p.valorCausa?.valor)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )
            ) : (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                <span>{state.error}</span>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: page.tsx**

```tsx
import { CompanySearchClient } from './search-client';

export const metadata = { title: 'Buscar empresa — Radar PX' };

export default function CompanySearchPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
          Consulta individual
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          Buscar empresa
        </h1>
        <p className="text-muted-foreground">
          Consulta processual por CNPJ. Resultados são guardados em cache por 30 dias.
        </p>
      </header>
      <CompanySearchClient />
    </main>
  );
}
```

- [ ] **Step 4: Build**

```bash
pnpm build
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/search/company
git commit -m "feat(search): company route — CNPJ search with gate"
```

---

## Fase 5 — UI Admin

### Task 15: app/admin/layout.tsx (requireAdmin)

**Files:**
- Create: `app/admin/layout.tsx`

- [ ] **Step 1: Criar o layout**

```tsx
import { AppHeader } from '@/components/app-header';
import { listUserPermissions, requireAdmin } from '@/lib/auth/permissions';

export const metadata = { title: 'Admin — Radar PX' };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const permissions = await listUserPermissions(user.id);
  return (
    <>
      <AppHeader user={user} permissions={[...permissions]} />
      <div className="mx-auto w-full max-w-6xl px-6 py-12">{children}</div>
    </>
  );
}
```

- [ ] **Step 2: Criar `app/admin/page.tsx` (redireciona para users)**

```tsx
import { redirect } from 'next/navigation';
export default function AdminIndex() {
  redirect('/admin/users');
}
```

- [ ] **Step 3: Build**

```bash
pnpm build
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add app/admin/layout.tsx app/admin/page.tsx
git commit -m "feat(admin): admin layout with requireAdmin gate"
```

---

### Task 16: app/admin/users/users-table.tsx + page.tsx + story

**Files:**
- Create: `app/admin/users/users-table.tsx`
- Create: `app/admin/users/page.tsx`
- Create: `app/admin/users/users-table.stories.tsx`

- [ ] **Step 1: users-table.tsx (client component, recebe linhas + counts)**

```tsx
'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Service } from '@/lib/auth/permissions';
import Link from 'next/link';
import { useTransition } from 'react';
import { setUserActive } from './actions';

export type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'operator';
  is_active: boolean;
  permissions: Service[];
  is_self: boolean;
};

const SERVICE_LABEL: Record<Service, string> = {
  search_person: 'Pessoa',
  search_company: 'Empresa',
  search_bulk: 'Lote',
};

export function UsersTable({ rows }: { rows: UserRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nome</TableHead>
          <TableHead>E-mail</TableHead>
          <TableHead>Papel</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Permissões</TableHead>
          <TableHead className="text-right">Ações</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <UserRowView key={r.id} row={r} />
        ))}
      </TableBody>
    </Table>
  );
}

function UserRowView({ row }: { row: UserRow }) {
  const [pending, start] = useTransition();
  return (
    <TableRow>
      <TableCell className="font-medium">{row.display_name ?? '—'}</TableCell>
      <TableCell className="text-muted-foreground">{row.email}</TableCell>
      <TableCell>
        <Badge variant={row.role === 'admin' ? 'info' : 'outline'}>
          {row.role === 'admin' ? 'Admin' : 'Operador'}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge variant={row.is_active ? 'success' : 'muted'}>
          {row.is_active ? 'Ativo' : 'Inativo'}
        </Badge>
      </TableCell>
      <TableCell className="text-xs">
        {row.role === 'admin'
          ? <span className="text-muted-foreground">(todas)</span>
          : row.permissions.length === 0
            ? <span className="text-muted-foreground">—</span>
            : row.permissions.map((s) => SERVICE_LABEL[s]).join(', ')}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/users/${row.id}`}>Editar</Link>
          </Button>
          <Button
            type="button"
            variant={row.is_active ? 'destructive' : 'default'}
            size="sm"
            disabled={pending || row.is_self}
            title={row.is_self ? 'Você não pode desativar a si mesmo' : undefined}
            onClick={() =>
              start(async () => {
                await setUserActive(row.id, !row.is_active);
              })
            }
          >
            {row.is_active ? 'Desativar' : 'Reativar'}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
```

- [ ] **Step 2: page.tsx (server component, agrega dados)**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { requireAdmin, type Service } from '@/lib/auth/permissions';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { UsersTable, type UserRow } from './users-table';

export default async function UsersListPage() {
  const me = await requireAdmin();
  const supabase = await createClient();

  const { data: users } = await supabase
    .from('users')
    .select('id, email, display_name, role, is_active')
    .order('created_at', { ascending: false });

  const { data: perms } = await supabase
    .from('user_service_permissions')
    .select('user_id, service');

  const permsByUser = new Map<string, Service[]>();
  for (const p of perms ?? []) {
    const list = permsByUser.get(p.user_id) ?? [];
    list.push(p.service as Service);
    permsByUser.set(p.user_id, list);
  }

  const rows: UserRow[] = (users ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    display_name: u.display_name,
    role: u.role,
    is_active: u.is_active,
    permissions: permsByUser.get(u.id) ?? [],
    is_self: u.id === me.id,
  }));

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
            Administração
          </span>
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
            Operadores
          </h1>
          <p className="text-muted-foreground">Gestão de contas internas e suas permissões.</p>
        </div>
        <Button asChild>
          <Link href="/admin/users/new">+ Novo operador</Link>
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Todos os operadores</CardTitle>
        </CardHeader>
        <CardContent>
          <UsersTable rows={rows} />
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 3: Story**

`app/admin/users/users-table.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/nextjs';
import { UsersTable, type UserRow } from './users-table';

const rows: UserRow[] = [
  {
    id: '1', email: 'admin@example.com', display_name: 'Admin',
    role: 'admin', is_active: true, permissions: [], is_self: true,
  },
  {
    id: '2', email: 'maria@example.com', display_name: 'Maria',
    role: 'operator', is_active: true,
    permissions: ['search_person', 'search_bulk'], is_self: false,
  },
  {
    id: '3', email: 'joao@example.com', display_name: 'João',
    role: 'operator', is_active: false, permissions: [], is_self: false,
  },
];

const meta = { title: 'Admin/UsersTable', component: UsersTable } satisfies Meta<typeof UsersTable>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Mixed: Story = { args: { rows } };
export const Empty: Story = { args: { rows: [] } };
```

- [ ] **Step 4: Visual update + build**

```bash
pnpm test:visual:update && pnpm build
```

Expected: snapshots updated; build OK.

- [ ] **Step 5: Commit**

```bash
git add app/admin/users
git commit -m "feat(admin): users list page + table component + story"
```

---

### Task 17: app/admin/users/user-form.tsx + story

**Files:**
- Create: `app/admin/users/user-form.tsx`
- Create: `app/admin/users/user-form.stories.tsx`

- [ ] **Step 1: Componente user-form.tsx**

```tsx
'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ALL_SERVICES, type Service } from '@/lib/auth/permissions';
import { generateStrongPassword, validateTempPassword } from '@/lib/validators/password';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';

export type UserFormMode = 'create' | 'edit';

export type UserFormValues = {
  email: string;
  display_name: string;
  role: 'admin' | 'operator';
  permissions: Service[];
  password?: string;
};

const SERVICE_LABEL: Record<Service, string> = {
  search_person: 'Buscar pessoa (CPF e nome)',
  search_company: 'Buscar empresa (CNPJ)',
  search_bulk: 'Buscar em lote',
};

export function UserForm({
  mode,
  initial,
  isLastActiveAdmin = false,
  onSubmit,
}: {
  mode: UserFormMode;
  initial: UserFormValues;
  isLastActiveAdmin?: boolean;
  onSubmit: (values: UserFormValues) => Promise<{ ok: false; error: string } | void>;
}) {
  const [values, setValues] = useState<UserFormValues>(initial);
  const [error, setError] = useState<string | null>(null);

  function togglePermission(svc: Service) {
    setValues((v) => ({
      ...v,
      permissions: v.permissions.includes(svc)
        ? v.permissions.filter((s) => s !== svc)
        : [...v.permissions, svc],
    }));
  }

  async function handleSubmit(formData: FormData) {
    setError(null);
    if (mode === 'create') {
      const pwCheck = validateTempPassword(values.password ?? '');
      if (!pwCheck.ok) {
        setError(pwCheck.error);
        return;
      }
    }
    const result = await onSubmit(values);
    if (result && !result.ok) setError(result.error);
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-6 max-w-xl">
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm font-medium">E-mail</label>
        <Input
          id="email" name="email" type="email" required
          value={values.email} disabled={mode === 'edit'}
          onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="display_name" className="text-sm font-medium">Nome de exibição</label>
        <Input
          id="display_name" name="display_name"
          value={values.display_name}
          onChange={(e) => setValues((v) => ({ ...v, display_name: e.target.value }))}
        />
      </div>

      {mode === 'create' && (
        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="text-sm font-medium">Senha temporária</label>
          <div className="flex gap-2">
            <Input
              id="password" name="password" required minLength={12}
              value={values.password ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
            />
            <Button
              type="button" variant="outline"
              onClick={() => setValues((v) => ({ ...v, password: generateStrongPassword() }))}
            >
              Gerar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Mínimo 12 caracteres. Repasse pelo canal seguro; será exibida apenas uma vez.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Papel</label>
        <div className="flex gap-4 text-sm">
          {(['operator', 'admin'] as const).map((r) => (
            <label key={r} className="flex items-center gap-2">
              <input
                type="radio" name="role" value={r}
                checked={values.role === r}
                disabled={mode === 'edit' && isLastActiveAdmin && r === 'operator' && initial.role === 'admin'}
                onChange={() => setValues((v) => ({ ...v, role: r }))}
              />
              {r === 'admin' ? 'Admin' : 'Operador'}
            </label>
          ))}
        </div>
        {mode === 'edit' && isLastActiveAdmin && initial.role === 'admin' && (
          <p className="text-xs text-amber-600">Este é o único admin ativo — não pode ser rebaixado.</p>
        )}
      </div>

      <fieldset className="flex flex-col gap-2" disabled={values.role === 'admin'}>
        <legend className="text-sm font-medium">Permissões de serviço</legend>
        {values.role === 'admin' && (
          <p className="text-xs text-muted-foreground">
            Admins têm todas as permissões automaticamente.
          </p>
        )}
        {ALL_SERVICES.map((svc) => (
          <label key={svc} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.permissions.includes(svc)}
              onChange={() => togglePermission(svc)}
            />
            {SERVICE_LABEL[svc]}
          </label>
        ))}
      </fieldset>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <SubmitButton mode={mode} />
    </form>
  );
}

function SubmitButton({ mode }: { mode: UserFormMode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Salvando…' : mode === 'create' ? 'Criar operador' : 'Salvar alterações'}
    </Button>
  );
}
```

- [ ] **Step 2: Story**

`app/admin/users/user-form.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/nextjs';
import { UserForm, type UserFormValues } from './user-form';

const empty: UserFormValues = {
  email: '', display_name: '', role: 'operator', permissions: [], password: '',
};

const meta = {
  title: 'Admin/UserForm',
  component: UserForm,
  args: { onSubmit: async () => undefined },
} satisfies Meta<typeof UserForm>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CreateOperator: Story = {
  args: { mode: 'create', initial: empty },
};

export const CreateAdmin: Story = {
  args: { mode: 'create', initial: { ...empty, role: 'admin' } },
};

export const EditOperator: Story = {
  args: {
    mode: 'edit',
    initial: { email: 'maria@example.com', display_name: 'Maria', role: 'operator', permissions: ['search_person'] },
  },
};

export const EditLastAdmin: Story = {
  args: {
    mode: 'edit',
    isLastActiveAdmin: true,
    initial: { email: 'admin@example.com', display_name: 'Admin', role: 'admin', permissions: [] },
  },
};
```

- [ ] **Step 3: Visual update + build**

```bash
pnpm test:visual:update && pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add app/admin/users/user-form.tsx app/admin/users/user-form.stories.tsx
git commit -m "feat(admin): UserForm component + stories (pt-BR labels)"
```

---

### Task 18: app/admin/users/actions.ts (Server Actions)

**Files:**
- Create: `app/admin/users/actions.ts`

- [ ] **Step 1: Implementar as 4 actions**

```ts
'use server';

import { writeAuditLog } from '@/lib/audit';
import { LockoutError, assertNotLastActiveAdmin, assertNotSelf } from '@/lib/auth/admin-guards';
import { type AppUser, type Service, requireAdmin } from '@/lib/auth/permissions';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

export type ActionResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };

export type CreateUserInput = {
  email: string;
  display_name: string;
  password: string;
  role: 'admin' | 'operator';
  permissions: Service[];
};

export async function createUser(input: CreateUserInput): Promise<ActionResult<{ userId: string }>> {
  const me = await requireAdmin();
  const supabase = createAdminClient();

  await writeAuditLog(
    {
      userId: me.id,
      action: 'admin_user_created',
      metadata: { target_email: input.email, role: input.role },
    },
    supabase,
    { allowFailure: true },
  );

  const { data, error } = await supabase.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { display_name: input.display_name },
  });
  if (error || !data.user) {
    return { ok: false, error: error?.message ?? 'Falha ao criar usuário.' };
  }
  const newUserId = data.user.id;

  if (input.role === 'admin') {
    await supabase.from('users').update({ role: 'admin' } as never).eq('id', newUserId);
  } else if (input.permissions.length > 0) {
    await supabase.from('user_service_permissions').insert(
      input.permissions.map((service) => ({
        user_id: newUserId,
        service,
        granted_by: me.id,
      })) as never,
    );
  }

  revalidatePath('/admin/users');
  return { ok: true, data: { userId: newUserId } };
}

export async function setUserActive(userId: string, active: boolean): Promise<ActionResult> {
  const me = await requireAdmin();
  try {
    assertNotSelf(me.id, userId, 'deactivate');
    if (!active) {
      const supabase = createAdminClient();
      await assertNotLastActiveAdmin(supabase, userId, 'deactivate');
    }
  } catch (e) {
    if (e instanceof LockoutError) return { ok: false, error: e.message };
    throw e;
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('users')
    .update({ is_active: active } as never)
    .eq('id', userId);
  if (error) return { ok: false, error: error.message };

  await writeAuditLog(
    {
      userId: me.id,
      action: 'admin_user_set_active',
      metadata: { target_user_id: userId, active },
    },
    supabase,
    { allowFailure: true },
  );

  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true };
}

export async function setUserRole(
  userId: string,
  newRole: 'admin' | 'operator',
): Promise<ActionResult> {
  const me = await requireAdmin();
  const supabase = createAdminClient();

  try {
    if (newRole === 'operator') {
      assertNotSelf(me.id, userId, 'demote');
      await assertNotLastActiveAdmin(supabase, userId, 'demote');
    }
  } catch (e) {
    if (e instanceof LockoutError) return { ok: false, error: e.message };
    throw e;
  }

  const { data: current } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  const { error } = await supabase
    .from('users')
    .update({ role: newRole } as never)
    .eq('id', userId);
  if (error) return { ok: false, error: error.message };

  await writeAuditLog(
    {
      userId: me.id,
      action: 'admin_user_set_role',
      metadata: { target_user_id: userId, from: current?.role ?? null, to: newRole },
    },
    supabase,
    { allowFailure: true },
  );

  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true };
}

export async function setUserPermission(
  userId: string,
  service: Service,
  granted: boolean,
): Promise<ActionResult> {
  const me = await requireAdmin();
  const supabase = createAdminClient();

  if (granted) {
    await supabase.from('user_service_permissions').upsert(
      { user_id: userId, service, granted_by: me.id } as never,
      { onConflict: 'user_id,service' } as never,
    );
  } else {
    await supabase
      .from('user_service_permissions')
      .delete()
      .eq('user_id', userId)
      .eq('service', service);
  }

  await writeAuditLog(
    {
      userId: me.id,
      action: 'admin_user_permission_changed',
      metadata: { target_user_id: userId, service, granted },
    },
    supabase,
    { allowFailure: true },
  );

  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true };
}
```

- [ ] **Step 2: Build**

```bash
pnpm typecheck && pnpm build
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add app/admin/users/actions.ts
git commit -m "feat(admin): server actions — createUser, setUserActive/Role/Permission"
```

---

### Task 19: app/admin/users/new/page.tsx (create flow)

**Files:**
- Create: `app/admin/users/new/page.tsx`

- [ ] **Step 1: Página de criação**

```tsx
import { UserForm, type UserFormValues } from '../user-form';
import { createUser } from '../actions';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Novo operador — Admin' };

export default function NewUserPage() {
  async function handleSubmit(values: UserFormValues) {
    'use server';
    if (!values.password) return { ok: false as const, error: 'Senha obrigatória.' };
    const result = await createUser({
      email: values.email.trim(),
      display_name: values.display_name.trim(),
      password: values.password,
      role: values.role,
      permissions: values.role === 'admin' ? [] : values.permissions,
    });
    if (!result.ok) return result;
    redirect(`/admin/users/${result.data?.userId}?created=1`);
  }

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
          Administração · Operadores
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          Novo operador
        </h1>
        <p className="text-muted-foreground">
          Crie a conta e defina a senha temporária. Repasse pelo canal seguro.
        </p>
      </header>
      <UserForm
        mode="create"
        initial={{ email: '', display_name: '', role: 'operator', permissions: [], password: '' }}
        onSubmit={handleSubmit}
      />
    </main>
  );
}
```

- [ ] **Step 2: Build**

```bash
pnpm build
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add app/admin/users/new
git commit -m "feat(admin): new operator page using UserForm + createUser action"
```

---

### Task 20: app/admin/users/[id]/page.tsx (edit flow)

**Files:**
- Create: `app/admin/users/[id]/page.tsx`

- [ ] **Step 1: Página de edição**

```tsx
import { UserForm, type UserFormValues } from '../user-form';
import {
  setUserActive,
  setUserPermission,
  setUserRole,
} from '../actions';
import { ALL_SERVICES, type Service, requireAdmin } from '@/lib/auth/permissions';
import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Editar operador — Admin' };

export default async function EditUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireAdmin();
  const supabase = await createClient();

  const { data: user } = await supabase
    .from('users')
    .select('id, email, display_name, role, is_active')
    .eq('id', id)
    .maybeSingle();
  if (!user) notFound();

  const { data: permRows } = await supabase
    .from('user_service_permissions')
    .select('service')
    .eq('user_id', id);
  const permissions = (permRows ?? []).map((r) => r.service as Service);

  const { count: otherActiveAdmins } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .eq('is_active', true)
    .neq('id', id);
  const isLastActiveAdmin = user.role === 'admin' && (!otherActiveAdmins || otherActiveAdmins === 0);

  async function handleSubmit(values: UserFormValues) {
    'use server';

    if (values.role !== user.role) {
      const r = await setUserRole(id, values.role);
      if (!r.ok) return r;
    }

    if (values.role !== 'admin') {
      const current = new Set(permissions);
      const next = new Set(values.permissions);
      for (const svc of ALL_SERVICES) {
        const wasGranted = current.has(svc);
        const isGranted = next.has(svc);
        if (wasGranted !== isGranted) {
          const r = await setUserPermission(id, svc, isGranted);
          if (!r.ok) return r;
        }
      }
    }

    redirect('/admin/users');
  }

  async function deactivate() {
    'use server';
    await setUserActive(id, false);
  }
  async function reactivate() {
    'use server';
    await setUserActive(id, true);
  }

  return (
    <main className="flex flex-col gap-6">
      {sp.created === '1' && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
          Operador criado. A senha temporária foi exibida na tela anterior — repasse pelo canal seguro.
        </div>
      )}

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
            Administração · Operadores
          </span>
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
            Editar operador
          </h1>
          <p className="text-muted-foreground">{user.email}</p>
        </div>
        <form action={user.is_active ? deactivate : reactivate}>
          <Button
            variant={user.is_active ? 'destructive' : 'default'}
            disabled={user.id === me.id || (user.is_active && isLastActiveAdmin)}
            type="submit"
            title={
              user.id === me.id ? 'Você não pode desativar a si mesmo' :
              user.is_active && isLastActiveAdmin ? 'Único admin ativo' : undefined
            }
          >
            {user.is_active ? 'Desativar' : 'Reativar'}
          </Button>
        </form>
      </header>

      <UserForm
        mode="edit"
        initial={{
          email: user.email,
          display_name: user.display_name ?? '',
          role: user.role,
          permissions,
        }}
        isLastActiveAdmin={isLastActiveAdmin}
        onSubmit={handleSubmit}
      />
    </main>
  );
}
```

- [ ] **Step 2: Build**

```bash
pnpm build
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add app/admin/users/\[id\]
git commit -m "feat(admin): edit operator page — role, permissions, activate/deactivate"
```

---

### Task 21: Mover audit para /admin/audit (admin global view, pt-BR)

**Files:**
- Create: `app/admin/audit/page.tsx`
- Create: `app/admin/audit/audit-table.tsx`
- Create: `app/admin/audit/audit-table.stories.tsx`
- Delete: `app/(app)/audit/page.tsx`

- [ ] **Step 1: audit-table.tsx**

```tsx
'use client';

import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { useMemo, useState } from 'react';

export type AuditAction =
  | 'login' | 'logout' | 'search_single' | 'search_bulk_item'
  | 'bulk_job_created' | 'export_csv' | 'admin_user_created'
  | 'admin_user_set_active' | 'admin_user_set_role'
  | 'admin_user_permission_changed';

export type AuditRow = {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action: AuditAction;
  search_type: 'cpf' | 'cnpj' | 'name' | null;
  document_hash: string | null;
  result_count: number | null;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const ACTION_LABELS: Record<AuditAction, string> = {
  login: 'Login',
  logout: 'Logout',
  search_single: 'Busca avulsa',
  search_bulk_item: 'Item de lote',
  bulk_job_created: 'Lote criado',
  export_csv: 'Exportação CSV',
  admin_user_created: 'Operador criado',
  admin_user_set_active: 'Ativação alterada',
  admin_user_set_role: 'Papel alterado',
  admin_user_permission_changed: 'Permissão alterada',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function truncateHash(hash: string | null): string {
  if (!hash) return '—';
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  const [filterEmail, setFilterEmail] = useState('');
  const [filterAction, setFilterAction] = useState<'all' | AuditAction>('all');

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterAction !== 'all' && r.action !== filterAction) return false;
      if (filterEmail && !(r.user_email ?? '').includes(filterEmail.toLowerCase())) return false;
      return true;
    });
  }, [rows, filterEmail, filterAction]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3 flex-wrap">
        <Input
          placeholder="Filtrar por e-mail"
          value={filterEmail}
          onChange={(e) => setFilterEmail(e.target.value.toLowerCase())}
          className="max-w-xs"
        />
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value as 'all' | AuditAction)}
          className="rounded-md border border-input bg-background px-3 py-1 text-sm"
        >
          <option value="all">Todas as ações</option>
          {(Object.entries(ACTION_LABELS) as [AuditAction, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Quando</TableHead>
            <TableHead>Operador</TableHead>
            <TableHead>Ação</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Hash do documento</TableHead>
            <TableHead>IP</TableHead>
            <TableHead className="text-right">Resultados</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                {formatDateTime(r.created_at)}
              </TableCell>
              <TableCell className="text-muted-foreground">{r.user_email ?? '—'}</TableCell>
              <TableCell><Badge variant="outline">{ACTION_LABELS[r.action]}</Badge></TableCell>
              <TableCell>
                {r.search_type
                  ? <Badge variant="outline" className="uppercase">{r.search_type}</Badge>
                  : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                {truncateHash(r.document_hash)}
              </TableCell>
              <TableCell className="font-mono text-xs">{r.ip ?? '—'}</TableCell>
              <TableCell className="text-right">
                {r.result_count !== null ? r.result_count : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: page.tsx**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/server';
import { AuditTable, type AuditRow } from './audit-table';

export const metadata = { title: 'Auditoria — Admin' };

export default async function AdminAuditPage() {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from('audit_log')
    .select(`
      id, user_id, action, search_type, document_hash, result_count,
      ip, metadata, created_at,
      users:users!audit_log_user_id_fkey ( email )
    `)
    .order('created_at', { ascending: false })
    .limit(500);

  const mapped: AuditRow[] = (rows ?? []).map((r: any) => ({
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
        <CardHeader><CardTitle>Últimos 500 eventos</CardTitle></CardHeader>
        <CardContent>
          {error ? (
            <p role="alert" className="text-destructive">Falha ao carregar: {error.message}</p>
          ) : (
            <AuditTable rows={mapped} />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
```

> **Nota**: o `select(... users:users!audit_log_user_id_fkey ( email ))` depende da FK existir (já existe — `audit_log.user_id references users(id)`). Se o nome da constraint divergir, ajustar pra `users:public.users!user_id (email)` ou rodar duas queries e juntar no servidor.

- [ ] **Step 3: Story**

`app/admin/audit/audit-table.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/nextjs';
import { AuditTable, type AuditRow } from './audit-table';

const sample: AuditRow[] = [
  {
    id: '1', user_id: 'u1', user_email: 'maria@example.com',
    action: 'search_single', search_type: 'cpf',
    document_hash: '0123456789abcdef0123456789abcdef0123456789abcdef',
    result_count: 3, ip: '10.0.0.1', metadata: null,
    created_at: '2026-05-20T10:30:00Z',
  },
  {
    id: '2', user_id: 'u1', user_email: 'maria@example.com',
    action: 'bulk_job_created', search_type: null, document_hash: null,
    result_count: null, ip: '10.0.0.1', metadata: { job_id: 'abc', total_items: 50 },
    created_at: '2026-05-20T10:15:00Z',
  },
  {
    id: '3', user_id: 'a1', user_email: 'admin@example.com',
    action: 'admin_user_permission_changed', search_type: null, document_hash: null,
    result_count: null, ip: '10.0.0.2',
    metadata: { target_user_id: 'u1', service: 'search_bulk', granted: true },
    created_at: '2026-05-20T09:00:00Z',
  },
];

const meta = { title: 'Admin/AuditTable', component: AuditTable } satisfies Meta<typeof AuditTable>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Mixed: Story = { args: { rows: sample } };
export const Empty: Story = { args: { rows: [] } };
```

- [ ] **Step 4: Remover audit antigo**

```bash
git rm -r app/\(app\)/audit
```

- [ ] **Step 5: Visual update + build**

```bash
pnpm test:visual:update && pnpm build
```

Expected: 0 errors. Header não mostra mais "Audit" no nav principal (foi removido em Task 12).

- [ ] **Step 6: Commit**

```bash
git add app/admin/audit
git commit -m "feat(admin): global audit page (pt-BR) replacing per-user /audit"
```

---

## Fase 6 — Home, polish, docs

### Task 22: Home permission-aware (preserva visual atual + empty state)

**Files:**
- Create: `app/(app)/home-modules.tsx`
- Create: `app/(app)/home-modules.stories.tsx`
- Modify: `app/(app)/page.tsx`

> **Contexto**: a home atual (commit `be9150d`) usa cards modulares (`PRIMARY` + `SECONDARY`) com radar pill, badges de domínio (KYC/Operação/30 dias/LGPD) e eyebrow uppercase. Esta task **preserva 100% desse visual** e só (a) filtra módulos por permissão, (b) substitui as rotas antigas pelas novas (`/search/person`, `/search/company`, `/admin/audit`), (c) adiciona empty state.

- [ ] **Step 1: Extrair `HomeModules` (client) com filtragem por permissão**

`app/(app)/home-modules.tsx`:

```tsx
'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Service } from '@/lib/auth/permissions';
import {
  ArrowRightIcon,
  Building2Icon,
  ClockIcon,
  LayersIcon,
  SearchIcon,
  ShieldCheckIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';

type DomainVariant = 'info' | 'success' | 'purple' | 'muted' | 'dark-blue';

type Module = {
  href: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  domain: { label: string; variant: DomainVariant };
  gate: Service | 'admin' | null; // null = sempre visível para qualquer ativo
};

const PRIMARY: Module[] = [
  {
    href: '/search/person',
    title: 'Buscar pessoa',
    description: 'Consulta processual por CPF ou nome.',
    icon: SearchIcon,
    domain: { label: 'KYC · KYE', variant: 'info' },
    gate: 'search_person',
  },
  {
    href: '/search/company',
    title: 'Buscar empresa',
    description: 'Consulta processual por CNPJ.',
    icon: Building2Icon,
    domain: { label: 'KYB', variant: 'dark-blue' },
    gate: 'search_company',
  },
  {
    href: '/bulk',
    title: 'Busca em lote',
    description: 'CSV com até 250 documentos por execução.',
    icon: LayersIcon,
    domain: { label: 'Operação', variant: 'purple' },
    gate: 'search_bulk',
  },
];

const SECONDARY: Module[] = [
  {
    href: '/history',
    title: 'Histórico',
    description: 'Suas últimas 100 consultas, com previews mascarados.',
    icon: ClockIcon,
    domain: { label: '30 dias', variant: 'muted' },
    gate: null,
  },
  {
    href: '/admin/users',
    title: 'Operadores',
    description: 'Criar, ativar e gerenciar permissões.',
    icon: UsersIcon,
    domain: { label: 'Admin', variant: 'info' },
    gate: 'admin',
  },
  {
    href: '/admin/audit',
    title: 'Auditoria',
    description: 'Trilha global de eventos, hashes SHA-256.',
    icon: ShieldCheckIcon,
    domain: { label: 'LGPD · Admin', variant: 'success' },
    gate: 'admin',
  },
];

function ModuleCard({ mod, primary }: { mod: Module; primary?: boolean }) {
  const Icon = mod.icon;
  return (
    <Link href={mod.href} className="group">
      <Card
        className={
          primary
            ? 'h-full transition-all hover:-translate-y-0.5 hover:shadow-elevated'
            : 'h-full transition-all hover:border-primary/30 hover:bg-card hover:shadow-elevated'
        }
      >
        <CardHeader>
          <div className="flex items-start justify-between">
            <span
              className={
                primary
                  ? 'grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground shadow-card'
                  : 'grid size-11 place-items-center rounded-xl bg-tertiary/60 text-primary'
              }
            >
              <Icon className="size-[20px]" strokeWidth={2.1} />
            </span>
            <Badge variant={mod.domain.variant} size="sm">
              {mod.domain.label}
            </Badge>
          </div>
          <CardTitle className="mt-3">{mod.title}</CardTitle>
          <CardDescription>{mod.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <span className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-transform group-hover:translate-x-0.5">
            Abrir
            <ArrowRightIcon className="size-3.5" />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

function isVisible(mod: Module, role: 'admin' | 'operator', perms: ReadonlySet<Service>): boolean {
  if (mod.gate === null) return true;
  if (mod.gate === 'admin') return role === 'admin';
  if (role === 'admin') return true;
  return perms.has(mod.gate);
}

export function HomeModules({
  role,
  permissions,
}: {
  role: 'admin' | 'operator';
  permissions: readonly Service[];
}) {
  const permSet = new Set(permissions);
  const visiblePrimary = PRIMARY.filter((m) => isVisible(m, role, permSet));
  const visibleSecondary = SECONDARY.filter((m) => isVisible(m, role, permSet));

  if (visiblePrimary.length === 0 && role === 'operator') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-base font-medium">Sua conta está ativa.</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Você ainda não tem nenhum serviço habilitado. Fale com um administrador para liberar
            Buscar pessoa, Buscar empresa ou Busca em lote.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {visiblePrimary.length > 0 && (
        <section aria-label="Módulos principais">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visiblePrimary.map((mod) => (
              <ModuleCard key={mod.href} mod={mod} primary />
            ))}
          </div>
        </section>
      )}

      {visibleSecondary.length > 0 && (
        <section aria-label="Auxiliares" className="flex flex-col gap-4">
          <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Apoio à operação
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleSecondary.map((mod) => (
              <ModuleCard key={mod.href} mod={mod} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
```

- [ ] **Step 2: Story**

`app/(app)/home-modules.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/nextjs';
import { HomeModules } from './home-modules';

const meta = { title: 'App/HomeModules', component: HomeModules } satisfies Meta<typeof HomeModules>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AsAdmin: Story = { args: { role: 'admin', permissions: [] } };

export const AsOperatorWithAll: Story = {
  args: { role: 'operator', permissions: ['search_person', 'search_company', 'search_bulk'] },
};

export const AsOperatorWithPersonOnly: Story = {
  args: { role: 'operator', permissions: ['search_person'] },
};

export const AsOperatorWithoutPermissions: Story = {
  args: { role: 'operator', permissions: [] },
};
```

- [ ] **Step 3: Substituir `app/(app)/page.tsx`**

```tsx
import { listUserPermissions, requireAuth } from '@/lib/auth/permissions';
import { HomeModules } from './home-modules';

export const metadata = { title: 'Radar PX' };

export default async function HomePage() {
  const user = await requireAuth();
  const permissions = await listUserPermissions(user.id);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-14">
      <header className="flex flex-col gap-3">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
          PX Center · Compliance
        </span>
        <h1 className="font-heading text-4xl font-semibold tracking-tight text-foreground sm:text-[2.75rem]">
          Background check sob radar.
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          Consulte processos judiciais por CPF, CNPJ ou nome — com cache, auditoria e rate-limit já
          integrados. Pensado para checagens de KYC, KYB e KYE.
        </p>
      </header>

      <HomeModules role={user.role} permissions={[...permissions]} />

      <footer className="border-t border-border/60 pt-6 text-xs text-muted-foreground">
        Dados retidos por 30 dias · CPF e CNPJ nunca persistidos em texto claro.
      </footer>
    </main>
  );
}
```

> **Observação**: a copy do `<p>` removeu a menção a "via Predictus" do home atual.

- [ ] **Step 4: Visual update + build**

```bash
pnpm test:visual:update && pnpm build
```

Esperar: snapshots da home regerados (cards agora filtrados; rotas trocadas para `/search/person` etc.). Inspeção visual deve confirmar que o radar pill, eyebrow, font-heading e badges seguem idênticos.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/home-modules.tsx app/\(app\)/home-modules.stories.tsx app/\(app\)/page.tsx
git commit -m "feat(home): permission-aware modules + empty state (preserves design system)"
```

---

### Task 23: Limpeza de menções a fornecedor

**Files:**
- Modify: `app/layout.tsx`

> **Contexto**: o commit `be9150d` já traduziu a UI para pt-BR. Tasks 13 (Person), 14 (Company) e 22 (Home) sobrescrevem os 3 arquivos com menção a "Predictus" (search/page.tsx, search/search-client.tsx, (app)/page.tsx). Resta apenas o `description` em `app/layout.tsx`.

- [ ] **Step 1: Atualizar a description em `app/layout.tsx`**

Localizar a linha equivalente a:

```ts
description: 'Radar PX — background check via Predictus. Internal PX Center tool.',
```

Substituir por:

```ts
description: 'Radar PX — verificação interna do PX Center.',
```

- [ ] **Step 2: Verificar que nenhuma menção restou**

```bash
grep -RIn --include="*.tsx" --include="*.ts" -E "Predictus|predictus" app/ components/ \
  | grep -v ".test.ts" \
  | grep -v "predictus_cache\|predictus_token\|predictus/types\|predictus/server-client\|predictus/cache" \
  | grep -v "PredictusProcess\|createServerPredictusClient" \
  || echo "OK — nenhuma menção visível ao operador."
```

> Resultados esperados que **devem permanecer** (são nomes técnicos internos, não UI):
> - imports de `@/lib/predictus/*`
> - tipos `PredictusProcess`
> - função `createServerPredictusClient`
> - tabelas `predictus_cache`, `predictus_token`

Se aparecer qualquer outra menção (string em JSX, mensagem de erro ao operador, copy), substituir por "consulta", "serviço de consulta" ou "fonte de dados".

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "chore(ui): remove vendor name from meta description"
```

- [ ] **Step 3: Visual update + build**

```bash
pnpm test:visual:update && pnpm build
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add -A app/ components/
git commit -m "chore(ui): pt-BR copy sweep; remove vendor names from user-visible text"
```

---

### Task 24: Atualizar README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Adicionar seção "Papéis e permissões"**

Inserir após a seção "Recursos" (ou equivalente). Conteúdo:

```markdown
## Papéis e permissões

A app tem dois papéis: **admin** e **operator**.

- **Operator** acessa apenas os serviços que um admin habilitou para ele:
  - Buscar pessoa (CPF e nome)
  - Buscar empresa (CNPJ)
  - Buscar em lote (CSV)
- **Admin** tem todas as permissões automaticamente, além de:
  - Criar operadores e definir senha temporária
  - Ativar/desativar contas
  - Promover/rebaixar entre admin e operator
  - Mudar permissões de qualquer operador
  - Ver o audit log de todos os operadores em `/admin/audit`

Operadores são criados pela UI em `/admin/users/new`. A senha temporária é exibida uma única vez para o admin repassar pelo canal seguro. Sem dependência de SMTP.

## Bootstrap do primeiro admin

Depois de aplicar as migrations (`pnpm exec supabase db push`), promova um usuário existente a admin via SQL no Supabase Studio:

```sql
update public.users
set role = 'admin'
where email = 'seu-email@px.center';
```

Todos os operadores que já existiam quando a migration entrou ficam como `role='operator'`, `is_active=true`, **sem permissões**. Use a tela `/admin/users` para liberar acesso individualmente.
```

- [ ] **Step 2: Substituir referências antigas a "criar usuário via Studio"**

Localizar trechos no README que documentam o fluxo antigo (Studio → Auth → Add user) e substituir pela referência ao novo fluxo (`/admin/users/new`), mantendo a observação de que o passo de SQL para promover o primeiro admin continua via Studio.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): document roles, permissions, and admin bootstrap"
```

---

### Task 25: Atualizar CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Adicionar nova seção "Papéis e permissões" em "Invariants"**

Inserir após a seção "Auth + RLS":

```markdown
### Papéis e permissões

- Dois papéis: `admin` e `operator`. Coluna `role` em `public.users`, default `operator`.
- `is_active` em `public.users` é a flag de soft-delete; o proxy bloqueia operadores com `is_active=false`.
- Permissões por serviço vivem em `public.user_service_permissions` (linha presente = permissão concedida). Vocabulário fechado por CHECK: `search_person`, `search_company`, `search_bulk`.
- Admin **sempre** tem todas as permissões — `has_service_permission` retorna true para admins independentemente de linhas em `user_service_permissions`. Não popular permissões para admins.
- Helper SQL `public.is_admin(uuid)` e `public.has_service_permission(uuid, text)` são fonte única de verdade. Use-os em RLS, no proxy e via RPC em `lib/auth/permissions.ts`.
- Server Actions e páginas chamam `requireAuth() / requireAdmin() / requirePermission(svc)` no topo — defesa em profundidade contra navegação direta.
- Mutações sobre `public.users` (toggle is_active, mudar role) e `user_service_permissions` rodam sempre via `createAdminClient()` em Server Actions.
- Guards `assertNotSelf` e `assertNotLastActiveAdmin` em `lib/auth/admin-guards.ts` impedem self-lockout.
```

- [ ] **Step 2: Adicionar nova seção "Bootstrap" antes ou depois de "Things to never do"**

```markdown
## Bootstrap do primeiro admin

Operadores existentes quando a migration de roles entrou ficam `role='operator', is_active=true, sem permissões`. Para criar o primeiro admin, rode no Studio:

```sql
update public.users set role='admin' where email='seu-email@px.center';
```

Depois, o admin cria os demais operadores via `/admin/users/new`.
```

- [ ] **Step 3: Acrescentar em "Things to never do"**

Adicionar como bullets:

```markdown
- **Nunca** citar nomes de fornecedores (ex.: Predictus) em copy visível ao operador. Use "consulta", "serviço de consulta" ou "fonte de dados".
- **Nunca** misturar copy em inglês na UI. A interface é toda pt-BR.
- **Nunca** criar usuário no Supabase Studio para uso operacional. Use `/admin/users/new`. Studio fica reservado para bootstrap inicial e operações de emergência.
- **Nunca** chamar `requireAdmin` / `requirePermission` apenas no proxy — sempre repetir na Server Action ou Page como defesa em profundidade.
```

- [ ] **Step 4: Adicionar receita em "Recipes"**

```markdown
### Adicionar uma nova permissão de serviço

1. Migration nova: `alter table public.user_service_permissions drop constraint user_service_permissions_service_check; alter table public.user_service_permissions add constraint user_service_permissions_service_check check (service in ('search_person','search_company','search_bulk','<novo>'));`
2. Adicionar o literal em `Service` em `lib/auth/permissions.ts` e em `ALL_SERVICES`.
3. Adicionar a label em `SERVICE_LABEL` em `components/app-header.tsx`, `app/admin/users/user-form.tsx` e `app/(app)/home-empty-state.tsx` (todas em pt-BR).
4. Adicionar item de navegação em `NAV_ITEMS` no header, com gate apontando para o novo Service.
5. Gatear o entrypoint do serviço com `await requirePermission('<novo>')` no Server Action correspondente.
6. Atualizar stories que enumeram `ALL_SERVICES` (UserForm, HomeEmptyState).
7. Documentar o serviço no README.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude.md): roles, bootstrap, never-do rules, recipe for new permission"
```

---

## Fase 7 — Verificação final

### Task 26: Smoke completo + verificação

**Files:** nenhuma

- [ ] **Step 1: Type + lint + testes Node**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 0 errors; ~200+ casos passando.

- [ ] **Step 2: Testes visuais**

```bash
pnpm build-storybook && pnpm test:visual
```

Expected: snapshots OK (nenhum diff inesperado).

- [ ] **Step 3: Build de produção**

```bash
pnpm build
```

Expected: build limpa.

- [ ] **Step 4: Smoke manual com Supabase local**

```bash
pnpm exec supabase db reset
psql "$(pnpm exec supabase status -o env | grep DB_URL | cut -d= -f2)" -f scripts/bootstrap-vault.sql
```

Criar manualmente um usuário inicial no Studio (Auth → Add user) e promovê-lo a admin:

```sql
update public.users set role='admin' where email='andre.ganske@px.center';
```

Rodar `pnpm dev` e validar o checklist da spec:

1. Login como admin → vê "Operadores" e "Auditoria" no header
2. `/admin/users/new`: criar `op1@example.com` com senha temporária, sem permissões → toast/página de sucesso
3. Login como `op1` → home mostra "Sua conta está ativa. Você ainda não tem nenhum serviço habilitado..."
4. Acessar `/search/person` direto na URL → redireciona para `/access-denied`
5. Como admin, ativar `search_person` para op1
6. Como op1, recarregar → "Pessoa" aparece no header; busca por CPF funciona
7. Como admin, tentar desativar a si mesmo → botão desabilitado / erro
8. Como admin, desativar op1 → próximo request de op1 vai para `/access-denied`

- [ ] **Step 5: Commit do estado final (se houve ajustes)**

Se algum ajuste de copy ou bug menor apareceu durante o smoke, comitar com:

```bash
git add -A
git commit -m "chore: smoke fixes from manual verification"
```

---

## Self-review (preencher ao finalizar todas as tasks)

- [ ] Toda decisão da spec tem task correspondente
- [ ] Senha temp ≥12 chars (config.toml) é validada no client e server
- [ ] Self-lockout coberto em backend + UI
- [ ] Nenhuma string "Predictus" em copy visível
- [ ] UI 100% pt-BR
- [ ] Migrations são append-only (nenhuma migration antiga foi editada)
- [ ] Cada Server Action que muda estado chama `requireAdmin` ou `requirePermission`
- [ ] Operadores existentes (anteriores à migration) podem ser religados via `/admin/users/[id]`
