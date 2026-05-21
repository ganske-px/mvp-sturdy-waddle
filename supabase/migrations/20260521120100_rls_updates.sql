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
