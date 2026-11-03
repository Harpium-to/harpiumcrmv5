-- ============================================================
-- 039_leads.sql — Inbound lead capture (Meta / Google / generic)
--
-- Adds two tables:
--
--   lead_ingest — one row per account holding the secret token that
--     identifies the account in the public ingest URL
--     (/api/leads/ingest/<token>) plus an optional `google_key` used to
--     validate Google Lead Form deliveries. The token is a URL secret,
--     stored in plaintext because it must be looked up by its value on
--     every inbound POST (same model as whatsapp_config.verify_token).
--
--   leads — one row per received lead, with the normalized fields we
--     could extract (name/email/phone/campaign/form), the full raw
--     payload (jsonb, for debugging / re-processing), and a link to the
--     contact it created (when a phone was present).
--
-- Writes happen only through the service role (the webhook has no
-- auth.uid()). Account members may read both tables via is_account_member.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- LEAD_INGEST — per-account ingest token + Google key
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_ingest (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  google_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE lead_ingest ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON lead_ingest;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON lead_ingest
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Members read; admins update the google_key. Token creation/rotation
-- goes through the service role (the /api/leads/config route).
DROP POLICY IF EXISTS lead_ingest_select ON lead_ingest;
DROP POLICY IF EXISTS lead_ingest_update ON lead_ingest;
CREATE POLICY lead_ingest_select ON lead_ingest FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY lead_ingest_update ON lead_ingest FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- Backfill: give every existing account an ingest token. New accounts
-- get one lazily on first visit to the leads settings (service role).
INSERT INTO lead_ingest (account_id, token)
SELECT a.id,
       replace(uuid_generate_v4()::text, '-', '') ||
       replace(uuid_generate_v4()::text, '-', '')
FROM accounts a
WHERE NOT EXISTS (SELECT 1 FROM lead_ingest li WHERE li.account_id = a.id);

-- ============================================================
-- LEADS — received leads
-- ============================================================
CREATE TABLE IF NOT EXISTS leads (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,            -- 'meta' | 'google' | 'other'
  external_id TEXT,                     -- provider lead id (best effort)
  campaign    TEXT,
  form_name   TEXT,
  full_name   TEXT,
  email       TEXT,
  phone       TEXT,
  raw         JSONB,                    -- full original payload
  contact_id  UUID REFERENCES contacts(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_account_created
  ON leads(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_contact ON leads(contact_id);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Members read; service role inserts (no client write policy).
DROP POLICY IF EXISTS leads_select ON leads;
CREATE POLICY leads_select ON leads FOR SELECT
  USING (is_account_member(account_id));
