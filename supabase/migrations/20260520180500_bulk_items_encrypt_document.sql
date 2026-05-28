-- ============================================================================
-- bulk_job_items: encrypt the document value at rest
--
-- Replaces the plaintext `document_value text` column with `document_encrypted
-- bytea`. The Server Action that creates a job encrypts each CPF/CNPJ via
-- the `encrypt_payload` Vault RPC, and the Edge Function decrypts via
-- `decrypt_payload` immediately before the Predictus call.
--
-- Safe to apply because no data has shipped yet — we drop and recreate.
-- ============================================================================

alter table public.bulk_job_items
  drop column document_value;

alter table public.bulk_job_items
  add column document_encrypted bytea not null;

comment on column public.bulk_job_items.document_encrypted is
  'CPF/CNPJ encrypted with the predictus_cache_key Vault secret. Decrypted '
  'in-memory by the Edge Function via decrypt_payload before each Predictus '
  'call. The plaintext never persists outside that ephemeral scope.';
