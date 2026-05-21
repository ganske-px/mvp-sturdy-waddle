# Roles e Permissões — Design

**Data**: 2026-05-21
**Autor**: Andre Ganske (brainstorming com Claude)
**Status**: Aguardando aprovação

## Problema

Hoje a app trata todos os operadores como iguais: presença em `public.users` libera acesso a tudo. Precisamos de papéis e permissões para que:

- **Apenas admins** possam criar operadores e ativar/desativar contas pela UI.
- **Apenas admins** vejam o `audit_log` completo.
- **Permissões granulares por usuário** controlem acesso a três serviços: busca de pessoa (CPF/nome), busca de empresa (CNPJ), busca em lote.

## Decisões de produto

| Tema | Decisão |
|---|---|
| Escopo dos toggles | Por usuário (cada operador tem suas permissões) |
| Modelo de desativação | Soft via `is_active`; UI nunca remove |
| Criação de usuário | Admin define senha temporária (sem SMTP) |
| Bootstrap do 1º admin | SQL manual no Supabase Studio (uma vez) |
| Papel admin | Superuser: tem todas as permissões automaticamente |
| Default para novo operador | Todas as permissões desligadas (menor privilégio) |
| Migração de existentes | Todos viram operator+active **sem** permissões |
| Modelagem | Tabela separada `user_service_permissions` (extensível) |
| Mapeamento de buscas | "pessoa" cobre CPF + nome; "empresa" cobre CNPJ |
| Rotas | Padrão `/search/person`, `/search/company`, `/bulk`, `/admin/*` |
| Idioma da UI | Sempre pt-BR (labels, mensagens, validações, copy de e-mail) |
| Copy | Nunca citar nomes de fornecedores na UI (ex.: "Predictus"). Usar termos genéricos: "consulta", "serviço de consulta", "fonte de dados" |

## Modelo de dados

```sql
-- public.users ganha:
role        text not null default 'operator' check (role in ('admin','operator'))
is_active   boolean not null default true

-- nova tabela (extensível por nova linha em CHECK):
public.user_service_permissions (
  user_id     uuid    not null references public.users(id) on delete cascade,
  service     text    not null check (service in ('search_person','search_company','search_bulk')),
  granted_at  timestamptz not null default now(),
  granted_by  uuid    references public.users(id) on delete set null,
  primary key (user_id, service)
)
```

### Helpers SQL (SECURITY DEFINER, `search_path = public`)

- `public.is_admin(uid uuid) returns boolean` — `role='admin' AND is_active`
- `public.has_service_permission(uid uuid, svc text) returns boolean` — admin OU linha presente; só vale se `is_active`

Helpers são a **fonte única de verdade** consumida por RLS, proxy e `lib/auth`.

### Audit log

Expansão do `CHECK` em `audit_log.action`:

```
admin_user_created
admin_user_set_active
admin_user_set_role
admin_user_permission_changed
```

## RLS

| Tabela | Política | Quem |
|---|---|---|
| `users` | `users_self_select` (existente) | operador lê a si |
| `users` | `users_admin_select` (nova) | admin lê todos |
| `users` | sem policy de write | mutações só via service role |
| `user_service_permissions` | `usp_select_self_or_admin` | operador lê suas; admin lê todas |
| `user_service_permissions` | `usp_admin_write` (FOR ALL) | só admin (defesa em profundidade) |
| `audit_log` | `audit_log_select_own_or_admin` (substitui) | self OR `is_admin(auth.uid())` |

Demais policies (`searches`, `bulk_jobs`, `bulk_job_items`, `predictus_cache`, `predictus_token`) ficam inalteradas.

## Arquitetura de aplicação

```
lib/auth/
  permissions.ts         getCurrentUser, requireAuth, requireAdmin, requirePermission, listUserPermissions
  admin-guards.ts        assertNotLastActiveAdmin, assertNotSelf

lib/supabase/proxy.ts    +is_active check; +/admin/* role gate
```

`requirePermission(svc)` chama o RPC `has_service_permission` — não duplica lógica. `requireAdmin` redireciona para `/access-denied`. Páginas e Server Actions chamam `requirePermission(...)` no topo (defesa em profundidade contra navegação direta).

## Rotas

```
app/(app)/
  page.tsx                 home: atalhos por permissão; empty state se sem nenhuma
  search/
    person/                CPF + nome   — gate: search_person
    company/               CNPJ         — gate: search_company
  bulk/                                 — gate: search_bulk
  history/                              — qualquer operador ativo
app/admin/                              — gate: role='admin'
  users/
    page.tsx               lista
    new/                   form de criação
    [id]/                  form de edição
    actions.ts             createUser, setUserActive, setUserRole, setUserPermission
  audit/                   audit_log global com filtros
```

Header (`components/app-header.tsx`) recebe `user` e `permissions: Set<Service>` como props do `app/(app)/layout.tsx`. Cada item de navegação aparece só se a permissão correspondente estiver presente; menu "Admin" só para admins.

## Fluxo de criação de operador

1. Admin abre `/admin/users/new`.
2. Preenche: e-mail, display name, senha temporária (gerador disponível, ≥12 chars), role, permissões (todas desligadas por default).
3. Server Action chama `supabase.auth.admin.createUser({ email, password, email_confirm: true })`.
4. Trigger `on_auth_user_created` cria mirror em `public.users` com defaults (`role='operator'`, `is_active=true`).
5. Server Action aplica `role` (se admin) e insere linhas em `user_service_permissions` para cada permissão marcada.
6. Página de confirmação mostra a senha temporária **uma vez** para o admin copiar e repassar pelo canal seguro.
7. Audit: `admin_user_created` com `{ target_email, role }`.

## Guards críticos (`lib/auth/admin-guards.ts`)

- `assertNotSelf(adminId, targetId, op)`: admin não desativa nem rebaixa a si mesmo via UI.
- `assertNotLastActiveAdmin(supabase, targetId, change)`: bloqueia desativar/rebaixar o único admin ativo restante.

Aplicados em `setUserActive` e `setUserRole`. Erro retorna em formato `{ ok: false, error }` para a UI tratar.

## Bootstrap

Após a migration entrar:

```sql
-- Rodar uma vez no Supabase Studio do ambiente alvo
update public.users set role='admin' where email='andre.ganske@px.center';
```

Documentar no `CLAUDE.md` (seção "bootstrap"). Admin tem todas as permissões via helper, então não precisa popular `user_service_permissions`.

## Testes

### Vitest / Node (`lib/**`)

- `lib/auth/permissions.test.ts` (novo) — redirecionamentos por estado de usuário/permissão; admin bypassa RPC; `getCurrentUser` mapeia campos
- `lib/auth/admin-guards.test.ts` (novo) — `assertNotLastActiveAdmin`, `assertNotSelf`
- `lib/validators/password.test.ts` (novo, se ausente) — ≥12 chars
- `lib/audit.test.ts` (atualizar) — novos `action` válidos

Crescimento esperado: 13 → ~17 arquivos; ~157 → ~200 casos.

### UI / Storybook + test-runner

O projeto **já tem** Storybook 10 + `@storybook/test-runner` + Playwright + `jest-image-snapshot`. Scripts: `pnpm test:visual`, `pnpm test:visual:update`. **Não introduzir RTL** — testes de UI são stories com `play` + visual diff.

Novas stories:

- `components/app-header.stories.tsx` — `AsAdmin`, `AsOperatorWithPersonOnly`, `AsOperatorWithAll`, `AsOperatorWithoutPermissions`
- `app/(app)/home-empty-state.stories.tsx` (extraindo client component) — `WithPermissions`, `WithoutPermissions`
- `app/admin/users/user-form.stories.tsx` — `CreateOperator`, `CreateAdmin`, `EditOperator`, `EditLastAdmin` (com `play` para validações)
- `app/admin/users/users-table.stories.tsx` — `Mixed`
- `app/admin/audit/audit-table.stories.tsx` — `Empty`, `Mixed`

Mocks padronizados em `tests/helpers/fakeUser.ts`.

### Smoke manual (documentado, não automatizado)

1. Logar como admin → ver `/admin/users` e `/admin/audit`.
2. Criar operador sem permissões → logar como ele → `/` mostra mensagem; rotas de busca redirecionam para `/access-denied`.
3. Admin liga `search_person` → operador atualiza e consegue buscar pessoa, mas não empresa nem bulk.
4. Admin desativa operador → próximo request vai para `/access-denied`.
5. Admin tenta desativar a si próprio (último admin) → erro.

## Plano de rollout

Fases são sequenciais, mas cada commit deixa `main` verde — fases 1/2 podem ir juntas no mesmo deploy se preferir uma janela única. Migrações são append-only.

### Fase 1 — Schema + helpers + RLS

- `supabase/migrations/20260521120000_user_roles_permissions.sql`
- `supabase/migrations/20260521120100_rls_updates.sql`
- Atualizar `lib/supabase/types.ts`

### Fase 2 — Camada `lib/auth` + proxy + gates

- `lib/auth/permissions.ts` + testes (TDD)
- `lib/auth/admin-guards.ts` + testes
- Atualizar `lib/supabase/proxy.ts` (is_active + `/admin/*` gate)
- Adicionar `requirePermission(...)` no `searchByDoc` atual (ainda monolítico em `app/(app)/search/actions.ts`; gate por `search_type` mapeado para `search_person`/`search_company`) e em `createBulkJob`. A separação da Server Action em duas (Fase 3) substitui esse gate condicional.
- Atualizar `app/(app)/layout.tsx` para carregar `user`+`permissions`

> **Atenção**: após a Fase 2, operadores existentes ficam sem permissões. Promover `andre.ganske@px.center` a admin **via SQL** antes do deploy a qualquer ambiente compartilhado.

### Fase 3 — Renomear rotas e separar pessoa/empresa

- `app/(app)/search/` → `app/(app)/search/person/`
- Nova `app/(app)/search/company/`
- Atualizar Server Actions, links no header, redirects existentes
- Atualizar/criar `components/app-header.stories.tsx`

### Fase 4 — UI admin

- `app/admin/layout.tsx` (com `requireAdmin()`)
- `app/admin/users/page.tsx`, `new/page.tsx`, `[id]/page.tsx`, `actions.ts`
- `app/admin/audit/page.tsx` substituindo o antigo `/audit`
- Stories + `pnpm test:visual:update`

### Fase 5 — Polimento + documentação

- Empty state na home para operador sem permissões (copy pt-BR, sem nome de fornecedor)
- Varredura de copy da UI: substituir qualquer referência a fornecedor por termo genérico ("consulta", "fonte de dados")
- **README**:
  - Atualizar visão geral mencionando o conceito de papéis (admin/operator) e permissões por serviço
  - Substituir referências a "criar usuário via Studio" pelo novo fluxo `/admin/users/new`
  - Documentar o passo de bootstrap do primeiro admin (SQL no Studio)
- **CLAUDE.md**:
  - Nova seção "Papéis e permissões" explicando os helpers SQL, `lib/auth/permissions.ts` e a convenção de gate em Server Actions
  - Nova seção "Bootstrap" cobrindo o UPDATE inicial e o que esperar dos operadores existentes após a migration
  - Em "Things to never do": acrescentar "Nunca citar nomes de fornecedores na UI" e "UI sempre em pt-BR"
  - Em "Recipes": acrescentar "Adicionar uma nova permissão" (passos: novo valor no CHECK, novo botão na UI, propagar no header)
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:visual`

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Operadores existentes perdem acesso após Fase 2 | Janela combinada; UPDATE de admin no Studio antes do `db push` em prod |
| Admin se trava (desativar/rebaixar a si) | Guards em `lib/auth/admin-guards.ts`; UI desabilita opção |
| Último admin removido | `assertNotLastActiveAdmin` em backend; UI desabilita |
| Drift entre proxy gate e Server Action gate | Helper SQL é fonte única; ambos chamam `has_service_permission` via mesma função |
| RLS regredida por nova migration | Testes de RLS são manuais (sem pgtap); checklist de smoke documentado |

## Fora de escopo

- Self-service de cadastro (signup permanece desligado).
- Recuperação de senha por e-mail (sem SMTP; usar Supabase Studio em emergência).
- Auditoria de quem visualizou audit_log (admins consumindo audit não geram nova entrada).
- pgtap para testes de RLS.
- Permissões mais granulares (ex.: limites de quantidade por dia) — pode entrar numa segunda iteração.
