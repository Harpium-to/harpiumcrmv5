-- ============================================================
-- 042_evolution_channel.sql — Evolution API (unofficial) channel
--
-- Optional alternative WhatsApp channel per account, alongside the
-- official Meta Cloud API. Evolution API is self-hosted; each account
-- stores its instance's base URL + api key (encrypted) + instance name,
-- plus a per-account webhook token used in the URL Evolution posts to.
--
-- When `enabled`, the dashboard's send path routes text messages through
-- Evolution instead of Meta, and inbound Evolution webhooks create the
-- same contacts/conversations/messages as the Meta webhook.
--
-- Writes go through the service role (config route + webhook); members
-- read their account's config.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS evolution_config (
  account_id    UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  base_url      TEXT,
  api_key       TEXT,               -- encrypted
  instance      TEXT,
  webhook_token TEXT NOT NULL UNIQUE,
  enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE evolution_config ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON evolution_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON evolution_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Members read; all writes (create token, save creds, toggle) go through
-- the service role after an admin check in the config route.
DROP POLICY IF EXISTS evolution_config_select ON evolution_config;
CREATE POLICY evolution_config_select ON evolution_config FOR SELECT
  USING (is_account_member(account_id));
