-- ============================================================
-- 081_whatsapp_connect_links.sql — WhatsApp connect link without login
-- (Fase A, docs/plano-link-conexao-e-nova-conversa.md).
--
-- An admin of the CRM, or the agency, sends a link to whoever runs the
-- company's Facebook. Opened (no login), it shows the CRM's name and
-- the "Conectar com o Facebook" button, and connects the OFFICIAL
-- WhatsApp of that CRM — nothing else: no conversations, no contacts.
--
--   whatsapp_connect_links   one row per link. Only the SHA-256 of the
--                            token is stored (like API keys); the
--                            plaintext leaves the server once. Good for
--                            7 days and ONE connection; generating a
--                            new link cancels the CRM's open ones.
--                            Server only (service role).
--
-- Safe to apply before the code: nothing reads it yet. The code
-- answers "falta a atualização do banco" until it runs.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_connect_links (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_hash  TEXT NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- 'crm' (Settings › WhatsApp) or 'agencia' (the agency console).
  created_via TEXT NOT NULL DEFAULT 'crm' CHECK (created_via IN ('crm', 'agencia')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  used_at     TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ
);

-- "Is there an open link for this CRM?"
CREATE INDEX IF NOT EXISTS idx_whatsapp_connect_links_open
  ON whatsapp_connect_links (account_id, expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE whatsapp_connect_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON whatsapp_connect_links FROM anon, authenticated;
