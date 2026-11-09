-- ============================================================
-- 059_whatsapp_caminho.sql — the WhatsApp path a CRM chose (D1)
--
-- Each CRM picks how its WhatsApp is connected:
--
--   'oficial'      the Meta Cloud API (Embedded Signup, coexistence)
--   'nao_oficial'  a QR-code connection through UAZAPI, like
--                  WhatsApp Web. Cheaper and keeps WhatsApp Web, but
--                  the number can be banned by WhatsApp.
--
-- See docs/plano-whatsapp-dois-caminhos.md.
--
-- accounts.whatsapp_path
--   NULL means "not chosen yet" — every CRM that existed before this
--   migration. The app then keeps the rule it had until now (an
--   enabled UAZAPI/Evolution instance takes the sends, otherwise
--   Meta), so applying this changes nothing by itself.
--
--   Written only by the service role, from POST /api/whatsapp/path,
--   after the admin check and — for 'nao_oficial' — the risk
--   acceptance. accounts_update (017) lets a CRM's admins update the
--   row, so a trigger keeps them from flipping the path directly and
--   skipping the acceptance. Same pattern as 050.
--
-- whatsapp_path_log
--   One row per choice: who, when, from what, and — for
--   'nao_oficial' — the version of the risk text the person accepted
--   (WHATSAPP_RISK_TERMS_VERSION in src/lib/channels/whatsapp-route.ts).
--   A CHECK makes the acceptance impossible to skip at the database
--   level. Members read their CRM's history; nobody writes it except
--   the service role.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS whatsapp_path TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_path_changed_at TIMESTAMPTZ;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_whatsapp_path_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_whatsapp_path_check
  CHECK (whatsapp_path IS NULL OR whatsapp_path IN ('oficial', 'nao_oficial'));

CREATE OR REPLACE FUNCTION public.enforce_account_whatsapp_path()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND (
       NEW.whatsapp_path            IS DISTINCT FROM OLD.whatsapp_path
    OR NEW.whatsapp_path_changed_at IS DISTINCT FROM OLD.whatsapp_path_changed_at
  ) THEN
    RAISE EXCEPTION 'O caminho do WhatsApp muda só pela tela de Configurações'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_account_whatsapp_path() OWNER TO postgres;

DROP TRIGGER IF EXISTS enforce_account_whatsapp_path ON accounts;
CREATE TRIGGER enforce_account_whatsapp_path
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_account_whatsapp_path();

CREATE TABLE IF NOT EXISTS whatsapp_path_log (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  path                TEXT NOT NULL CHECK (path IN ('oficial', 'nao_oficial')),
  previous_path       TEXT CHECK (previous_path IS NULL OR previous_path IN ('oficial', 'nao_oficial')),
  chosen_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- True when the person chose through the agency's access, not as a
  -- member. The route refuses that for 'nao_oficial' (the risk is the
  -- client's to accept); recorded for 'oficial' all the same.
  via_agency          BOOLEAN NOT NULL DEFAULT FALSE,
  risk_terms_version  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_path_log_risk_accepted
    CHECK (path <> 'nao_oficial' OR risk_terms_version IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_path_log_account
  ON whatsapp_path_log(account_id, created_at DESC);

ALTER TABLE whatsapp_path_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_path_log_select ON whatsapp_path_log;
CREATE POLICY whatsapp_path_log_select ON whatsapp_path_log FOR SELECT
  USING (is_account_member(account_id));
