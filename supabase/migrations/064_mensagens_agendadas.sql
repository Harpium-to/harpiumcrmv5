-- ============================================================
-- 064_mensagens_agendadas.sql — messages scheduled for a contact, and
-- follow-up "only if they don't reply" (Fase 5 of
-- docs/plano-extensao-chrome.md)
--
--   scheduled_messages        one message to one contact at a set time:
--                             a text, or a quick reply's file with its
--                             caption. `only_if_no_reply` makes it a
--                             follow-up: when the time comes, it is
--                             skipped if the customer wrote since it
--                             was scheduled.
--   claim_scheduled_messages() hands the scheduler the messages that
--                             are due, each exactly once.
--
-- The scheduler that already runs the automations
-- (/api/automations/cron) sends them through the CRM's WhatsApp, the
-- same send core as the inbox.
--
-- Everyone on the team sees a contact's scheduled messages; agents and
-- above schedule and cancel them — the same rule as tasks (060).
--
-- Safe to apply before or after the code: before, nothing uses it;
-- after, until it runs, scheduling says it is unavailable.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id       UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The text, or the caption of the file. Empty only for a file.
  content_text     TEXT,
  media_kind       TEXT CHECK (media_kind IS NULL OR media_kind IN ('image', 'video', 'document', 'audio')),
  media_url        TEXT,
  media_filename   TEXT,
  send_at          TIMESTAMPTZ NOT NULL,
  -- A follow-up: skipped if the customer writes before send_at.
  only_if_no_reply BOOLEAN NOT NULL DEFAULT FALSE,
  status           TEXT NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('scheduled', 'sending', 'sent', 'skipped', 'cancelled', 'failed')),
  -- Why it was skipped or failed, for the person.
  outcome          TEXT,
  sent_message_id  UUID REFERENCES messages(id) ON DELETE SET NULL,
  processed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT scheduled_messages_has_content CHECK (
    (media_kind IS NULL AND NULLIF(btrim(content_text), '') IS NOT NULL)
    OR (media_kind IS NOT NULL AND NULLIF(btrim(media_url), '') IS NOT NULL)
  ),
  CONSTRAINT scheduled_messages_text_size CHECK (
    content_text IS NULL OR char_length(content_text) <= 4096
  )
);

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_contact
  ON scheduled_messages (account_id, contact_id, send_at);

-- What claim_scheduled_messages() scans.
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_due
  ON scheduled_messages (send_at)
  WHERE status = 'scheduled';

ALTER TABLE scheduled_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scheduled_messages_select ON scheduled_messages;
DROP POLICY IF EXISTS scheduled_messages_insert ON scheduled_messages;
DROP POLICY IF EXISTS scheduled_messages_update ON scheduled_messages;
DROP POLICY IF EXISTS scheduled_messages_delete ON scheduled_messages;

CREATE POLICY scheduled_messages_select ON scheduled_messages FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY scheduled_messages_insert ON scheduled_messages FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY scheduled_messages_update ON scheduled_messages FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY scheduled_messages_delete ON scheduled_messages FOR DELETE
  USING (is_account_member(account_id, 'agent'));

CREATE OR REPLACE FUNCTION public.scheduled_messages_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scheduled_messages_touch ON scheduled_messages;
CREATE TRIGGER scheduled_messages_touch
  BEFORE UPDATE ON scheduled_messages
  FOR EACH ROW EXECUTE FUNCTION public.scheduled_messages_touch();

-- The messages that are due, marked 'sending' in the same statement
-- that picks them, so two overlapping scheduler runs never send one
-- twice. Oldest first.
CREATE OR REPLACE FUNCTION public.claim_scheduled_messages(p_limit INT DEFAULT 50)
RETURNS SETOF scheduled_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT s.id
    FROM scheduled_messages s
    WHERE s.status = 'scheduled'
      AND s.send_at <= NOW()
    ORDER BY s.send_at
    LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE scheduled_messages s
  SET status = 'sending'
  FROM due
  WHERE s.id = due.id
  RETURNING s.*;
END;
$$;

ALTER FUNCTION public.claim_scheduled_messages(INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_scheduled_messages(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scheduled_messages(INT) TO service_role;
