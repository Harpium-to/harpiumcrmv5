-- ============================================================
-- 065_disparos_qr.sql — bulk sends through the QR-code number, with
-- limits (Fase 8 of docs/plano-extensao-chrome.md)
--
--   bulk_sends                     one bulk send: the message (a text,
--                                  or a quick reply's file and caption),
--                                  who it went to, when the risk was
--                                  accepted, and whether it was stopped
--   scheduled_messages.bulk_send_id each recipient is a scheduled
--                                  message (064), spaced 30–90 s apart,
--                                  sent by the same scheduler
--
-- The limits live in the app (src/lib/bulk/sends.ts): 200 sends a day
-- per CRM, one every 30–90 s, one bulk after another — never two at
-- once. The official API keeps its approved-template broadcasts; this is
-- for the QR-code number only.
--
-- Everyone on the team sees the bulk sends; admins and above start and
-- stop them.
--
-- Safe to apply before or after the code: before, nothing uses it;
-- after, until it runs, the screen says it is unavailable.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS bulk_sends (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name             TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  content_text     TEXT,
  media_kind       TEXT CHECK (media_kind IS NULL OR media_kind IN ('image', 'video', 'document', 'audio')),
  media_url        TEXT,
  media_filename   TEXT,
  -- Who it was for: { "tag_id": … } or { "phones": n } — a record, not
  -- a rule; the recipients are the scheduled messages.
  audience         JSONB NOT NULL DEFAULT '{}'::jsonb,
  total            INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  -- The person read the risk of a ban and went ahead.
  risk_accepted_at TIMESTAMPTZ NOT NULL,
  stopped_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bulk_sends_has_content CHECK (
    NULLIF(btrim(content_text), '') IS NOT NULL OR NULLIF(btrim(media_url), '') IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_bulk_sends_account
  ON bulk_sends (account_id, created_at DESC);

ALTER TABLE bulk_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bulk_sends_select ON bulk_sends;
DROP POLICY IF EXISTS bulk_sends_insert ON bulk_sends;
DROP POLICY IF EXISTS bulk_sends_update ON bulk_sends;

CREATE POLICY bulk_sends_select ON bulk_sends FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY bulk_sends_insert ON bulk_sends FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY bulk_sends_update ON bulk_sends FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

ALTER TABLE scheduled_messages
  ADD COLUMN IF NOT EXISTS bulk_send_id UUID REFERENCES bulk_sends(id) ON DELETE SET NULL;

-- A bulk's own messages, and the day's count for the daily limit.
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_bulk
  ON scheduled_messages (bulk_send_id)
  WHERE bulk_send_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_bulk_day
  ON scheduled_messages (account_id, send_at)
  WHERE bulk_send_id IS NOT NULL;
