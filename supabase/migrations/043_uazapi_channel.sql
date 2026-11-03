-- ============================================================
-- 043_uazapi_channel.sql — UAZAPI (unofficial) WhatsApp channel
--
-- Third WhatsApp channel, alongside the official Meta Cloud API (001)
-- and Evolution (042). UAZAPI is a hosted/self-hosted gateway where
-- each *server* holds many instances; an instance is one paired phone.
--
-- Why this table looks different from `evolution_config`
--   Evolution asks the operator to create the instance elsewhere and
--   paste credentials in. UAZAPI can mint the instance for us: with a
--   server-level `admin_token` we POST /instance/create and get back a
--   per-instance token. So we store BOTH:
--     - admin_token    — server scope, creates instances (encrypted)
--     - instance_token — instance scope, sends/receives (encrypted)
--   The operator only ever pastes the admin token; the instance token
--   is minted and stored by the app. An operator who already has an
--   instance can paste its token directly and leave admin_token null.
--
-- Pairing state (`status`, `paired_phone`) is a cache of what UAZAPI
-- reports, refreshed by the status route. It is display-only — the
-- gateway remains the source of truth — so it is never used to gate
-- sending; `enabled` + tokens are.
--
-- `webhook_token` is OUR secret in the inbound URL path, exactly as in
-- 042: it identifies the account on a request that carries no session.
--
-- Writes go through the service role (config/connect/status/webhook
-- routes); members read their own account's row.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS uazapi_config (
  account_id     UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  base_url       TEXT,                -- the UAZAPI server, e.g. https://seu-servidor.uazapi.com
  admin_token    TEXT,                -- encrypted; server scope, optional
  instance_token TEXT,                -- encrypted; instance scope, minted or pasted
  instance_name  TEXT,
  -- Cache of the gateway's own pairing state. See header: display only.
  status         TEXT NOT NULL DEFAULT 'disconnected',
  paired_phone   TEXT,
  webhook_token  TEXT NOT NULL UNIQUE,
  enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE uazapi_config ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON uazapi_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON uazapi_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Members read; every write (mint token, save creds, toggle, cache
-- status) goes through the service role after an admin check in the
-- route. Mirrors evolution_config.
DROP POLICY IF EXISTS uazapi_config_select ON uazapi_config;
CREATE POLICY uazapi_config_select ON uazapi_config FOR SELECT
  USING (is_account_member(account_id));
