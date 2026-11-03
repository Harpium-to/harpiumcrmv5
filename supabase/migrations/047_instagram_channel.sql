-- ============================================================
-- 047_instagram_channel.sql — Instagram Direct as a channel
--
-- The third component the product spec asks for: DMs from an
-- Instagram professional account landing in the same inbox as
-- WhatsApp, answered by the same people and the same agents.
--
-- THREE THINGS THE SCHEMA DID NOT HAVE
--
-- 1. An identity for someone with no phone number.
--    `contacts.phone` is NOT NULL and every de-dup path keys on it.
--    An Instagram DM carries an IGSID (an opaque per-app user id) and
--    no number at all. Inventing a placeholder number was the
--    tempting option and the wrong one: it would sit in the contact
--    list looking dialable, and a broadcast would try to send to it.
--
--    What makes the honest version possible is that 022's uniqueness
--    index is PARTIAL — `WHERE phone_normalized <> ''`. So an
--    Instagram contact carries phone = '' , stays out of the phone
--    index entirely, and gets its own identity below.
--
--    `contacts.instagram` (from 045) holds the @handle, which is for
--    reading and can change at any time. The stable key gets its own
--    column: a handle is a display name, not a primary key.
--
-- 2. A channel on the conversation.
--    Evolution and UAZAPI did not need one — all three WhatsApp
--    channels are interchangeable, so the account-level "which
--    provider is on" decides. Instagram is not interchangeable: an
--    account can run WhatsApp and Instagram at once, and a reply has
--    to leave by the door the message came in through. Replying to an
--    Instagram DM over WhatsApp is not a degraded send; it is a
--    message to a stranger's phone.
--
-- 3. Credentials for the account's Instagram.
--    Same shape as evolution_config / uazapi_config: one row per
--    account, token encrypted, members read, writes through the
--    service role after an admin check in the route.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Contact identity
-- ------------------------------------------------------------
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS instagram_id text;

COMMENT ON COLUMN contacts.instagram_id IS
  'Instagram-scoped user id (IGSID). Stable; the @handle in '
  '"instagram" is not. De-dup key for the Instagram channel.';

-- Partial, mirroring the phone index: contacts that never wrote in on
-- Instagram have no id and must not collide with each other on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_instagram_id
  ON contacts (account_id, instagram_id)
  WHERE instagram_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2. Conversation channel
-- ------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp';

-- Existing threads are all WhatsApp, which the DEFAULT already covers.
-- The CHECK is added separately so re-running cannot fail on a
-- constraint that is already there.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_channel_check'
      AND conrelid = 'conversations'::regclass
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_channel_check
      CHECK (channel IN ('whatsapp', 'instagram'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_account_channel
  ON conversations (account_id, channel);

-- ------------------------------------------------------------
-- 3. Credentials
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS instagram_config (
  account_id   UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  -- The Instagram professional account's id. This is what the webhook
  -- payload carries as `entry[].id`, so it is how an inbound DM finds
  -- its account.
  ig_user_id   TEXT,
  -- The Facebook Page the Instagram account is linked to. Meta issues
  -- the messaging token against the Page, not the Instagram account.
  page_id      TEXT,
  username     TEXT,
  access_token TEXT,              -- encrypted, same as every other channel
  enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One Instagram account cannot feed two workspaces: the webhook
-- resolves the account from this id, and two rows would make the
-- destination of an inbound DM a coin toss.
CREATE UNIQUE INDEX IF NOT EXISTS idx_instagram_config_ig_user_id
  ON instagram_config (ig_user_id)
  WHERE ig_user_id IS NOT NULL;

ALTER TABLE instagram_config ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON instagram_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON instagram_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS instagram_config_select ON instagram_config;
CREATE POLICY instagram_config_select ON instagram_config FOR SELECT
  USING (is_account_member(account_id));
