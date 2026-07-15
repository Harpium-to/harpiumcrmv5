-- ============================================================
-- 038_agencia_auditoria.sql — Agency access audit log
--
-- The /agencia console lets an agency operator read every client's
-- private data (contacts, conversations, deals) through the service
-- role. This table records who looked at what, so that privileged
-- access is accountable — the standard control for any "god-mode"
-- admin surface.
--
-- Written only by the server through the service role (see
-- src/lib/agencia/queries.ts `logAgenciaAccess`). Readable by agency
-- members via the is_agencia() predicate from migration 037. There is
-- no client-facing INSERT/UPDATE/DELETE policy — the log is append-only
-- from the app's perspective and cannot be tampered with from a session.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS agencia_auditoria (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Nullable + ON DELETE SET NULL so removing a client account never
  -- erases the history of it having been accessed.
  account_id      UUID REFERENCES accounts(id) ON DELETE SET NULL,
  -- No FK: conversations get deleted/merged, but the access record must
  -- survive. We keep the raw id for reference.
  conversation_id UUID,
  action          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agencia_auditoria_created
  ON agencia_auditoria(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agencia_auditoria_account
  ON agencia_auditoria(account_id);
CREATE INDEX IF NOT EXISTS idx_agencia_auditoria_actor
  ON agencia_auditoria(actor_user_id);

ALTER TABLE agencia_auditoria ENABLE ROW LEVEL SECURITY;

-- Agency members may read the log. No write policy — service role only.
DROP POLICY IF EXISTS agencia_auditoria_select ON agencia_auditoria;
CREATE POLICY agencia_auditoria_select ON agencia_auditoria FOR SELECT
  USING (is_agencia());
