-- ============================================================
-- 040_meta_lead_pages.sql — Native Meta Lead Ads connection
--
-- Stores the Facebook Pages an account has connected for native lead
-- delivery. When a lead is submitted, Meta's app-level `leadgen` webhook
-- fires with a page_id + leadgen_id; we look the page up here to know
-- (a) which account it belongs to and (b) the Page access token to fetch
-- the lead details from the Graph API. This is the direct/native path —
-- the generic /api/leads/ingest webhook (Zapier/Make/Google) still works
-- unchanged alongside it.
--
-- The page access token is encrypted at rest (same AES helper as
-- whatsapp_config.access_token). Writes go through the service role
-- (OAuth callback + webhook); members may read their account's pages.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS meta_lead_pages (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- A Facebook Page belongs to at most one account here.
  page_id       TEXT NOT NULL UNIQUE,
  page_name     TEXT,
  access_token  TEXT NOT NULL,         -- encrypted Page access token
  subscribed    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meta_lead_pages_account
  ON meta_lead_pages(account_id);

ALTER TABLE meta_lead_pages ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON meta_lead_pages;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON meta_lead_pages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Members read; admins may disconnect (delete). Insert/token writes are
-- service-role only (OAuth callback).
DROP POLICY IF EXISTS meta_lead_pages_select ON meta_lead_pages;
DROP POLICY IF EXISTS meta_lead_pages_delete ON meta_lead_pages;
CREATE POLICY meta_lead_pages_select ON meta_lead_pages FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY meta_lead_pages_delete ON meta_lead_pages FOR DELETE
  USING (is_account_member(account_id, 'admin'));
