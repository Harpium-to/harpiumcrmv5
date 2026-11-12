-- ============================================================
-- 068_leads_tokens_depara.sql — receiving leads: one token per origin
-- and a "de/para" per origin
--
--   lead_ingest_tokens   named tokens for the lead URL ("Quiz
--                        planejados", "Google Ads", "Zapier"), each
--                        revocable on its own. If one leaks, only that
--                        one is replaced. The account's original token
--                        (lead_ingest.token, 039) keeps working.
--   leads.ingest_token_id  which token brought the lead.
--   lead_field_mappings  per origin, where each incoming field key goes:
--                        'note', 'ignore', 'contact:<column>' or
--                        'custom:<custom_field_id>'. A key without a row
--                        follows the default rule (the custom field with
--                        the same name, else the contact's note).
--   idx_leads_external   backs the "same id_externo within 24 h is not
--                        written twice" lookup on every delivery.
--
-- Members read; writes go through the service role in the API routes,
-- after an admin check (same model as lead_ingest in 039).
--
-- Safe to apply before or after the code: the code falls back to the
-- original token and to the default rule while these tables are absent.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- LEAD_INGEST_TOKENS
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_ingest_tokens (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  token        TEXT NOT NULL UNIQUE,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lead_ingest_tokens_account
  ON lead_ingest_tokens (account_id, created_at DESC);

ALTER TABLE lead_ingest_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_ingest_tokens_select ON lead_ingest_tokens;
CREATE POLICY lead_ingest_tokens_select ON lead_ingest_tokens FOR SELECT
  USING (is_account_member(account_id));

-- ============================================================
-- LEADS — which token brought each lead
-- ============================================================
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS ingest_token_id UUID
    REFERENCES lead_ingest_tokens(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_external
  ON leads (account_id, source, external_id, created_at DESC)
  WHERE external_id IS NOT NULL;

-- ============================================================
-- LEAD_FIELD_MAPPINGS — the "de/para" per origin
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_field_mappings (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- leads.source of the origin ('quiz-planejados', 'google', 'meta'…)
  source     TEXT NOT NULL CHECK (char_length(source) BETWEEN 1 AND 60),
  -- the incoming key, folded (lowercase, no accents, '_' separators)
  field_key  TEXT NOT NULL CHECK (char_length(field_key) BETWEEN 1 AND 100),
  target     TEXT NOT NULL CHECK (
    target IN ('note', 'ignore')
    OR target ~ '^contact:[a-z_]{1,40}$'
    OR target ~ '^custom:[0-9a-f-]{36}$'
  ),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, source, field_key)
);

ALTER TABLE lead_field_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_field_mappings_select ON lead_field_mappings;
CREATE POLICY lead_field_mappings_select ON lead_field_mappings FOR SELECT
  USING (is_account_member(account_id));
