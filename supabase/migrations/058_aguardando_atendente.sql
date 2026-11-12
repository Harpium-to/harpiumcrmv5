-- ============================================================
-- 058_aguardando_atendente.sql — conversations waiting for a person
--
-- When the AI hands a conversation to the team, nothing made that
-- obvious: the thread just showed a grey "AI paused" banner and
-- nobody was told someone had to answer. This column is the one fact
-- the inbox, the menu and every other screen need to call attention
-- to it:
--
--   conversations.needs_human_since
--     When the AI handed the conversation to the team and no person
--     has written to the customer since. NULL otherwise.
--
-- It is kept by the database, not by the code paths that hand off or
-- reply, so every way a message reaches the customer clears it — the
-- inbox composer, a template, the public API, the extension, or the
-- business answering from the WhatsApp Business app (coexistence
-- echoes are stored as sender_type 'agent').
--
--   Set   — the bot pauses AND writes a new handoff note in the same
--           update (that is what a handoff is; a person pressing
--           "Assumir" pauses the bot without a note and is already
--           there, so it does not count).
--   Clear — a person's message is stored (sender_type 'agent'; the
--           AI's own messages are 'bot'), the AI is resumed, or the
--           conversation is closed.
--
-- Safe to apply before or after the code: the code treats a missing
-- column as "nobody waiting".
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS needs_human_since TIMESTAMPTZ;

COMMENT ON COLUMN conversations.needs_human_since IS
  'When the AI handed this conversation to the team and no person has replied since. NULL when nobody is waiting.';

CREATE INDEX IF NOT EXISTS idx_conversations_needs_human
  ON conversations (account_id, needs_human_since)
  WHERE needs_human_since IS NOT NULL;

-- ------------------------------------------------------------
-- Set / clear on the conversation row itself (BEFORE UPDATE, so it
-- lands in the same write and in the same realtime event).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION conversations_track_needs_human()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Handoff: the bot was on, now it is paused, with a new note.
  IF COALESCE(OLD.ai_autoreply_disabled, false) = false
     AND NEW.ai_autoreply_disabled = true
     AND NEW.ai_handoff_summary IS NOT NULL
     AND NEW.ai_handoff_summary IS DISTINCT FROM OLD.ai_handoff_summary THEN
    NEW.needs_human_since := COALESCE(NEW.needs_human_since, now());
  END IF;

  -- The AI took the conversation back, or it was closed.
  IF COALESCE(NEW.ai_autoreply_disabled, false) = false
     OR NEW.status = 'closed' THEN
    NEW.needs_human_since := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS track_needs_human ON conversations;
CREATE TRIGGER track_needs_human
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION conversations_track_needs_human();

-- ------------------------------------------------------------
-- Clear when a person writes to the customer.
--
-- SECURITY DEFINER because the webhook (coexistence echoes) and the
-- public API insert messages with roles that may not be allowed to
-- update conversations directly. It only ever nulls this one column
-- on the message's own conversation.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION messages_clear_needs_human()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender_type = 'agent' AND COALESCE(NEW.ai_generated, false) = false THEN
    UPDATE conversations
       SET needs_human_since = NULL
     WHERE id = NEW.conversation_id
       AND needs_human_since IS NOT NULL;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let this block the message itself.
  RAISE WARNING 'Failed to clear needs_human_since for conversation %: %', NEW.conversation_id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION messages_clear_needs_human() OWNER TO postgres;

DROP TRIGGER IF EXISTS clear_needs_human ON messages;
CREATE TRIGGER clear_needs_human
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION messages_clear_needs_human();

-- ------------------------------------------------------------
-- Backfill: conversations handed off before this migration that are
-- still open and that no person has answered since. The handoff time
-- is not stored anywhere, so use the AI's last message on the thread
-- (the handoff notice, or its last reply before handing off), falling
-- back to the conversation's last update.
-- ------------------------------------------------------------
WITH handed_off AS (
  SELECT c.id,
         COALESCE(
           (SELECT max(m.created_at)
              FROM messages m
             WHERE m.conversation_id = c.id
               AND m.ai_generated = true),
           c.updated_at
         ) AS since
    FROM conversations c
   WHERE c.ai_autoreply_disabled = true
     AND c.ai_handoff_summary IS NOT NULL
     AND c.status <> 'closed'
     AND c.needs_human_since IS NULL
)
UPDATE conversations c
   SET needs_human_since = h.since
  FROM handed_off h
 WHERE c.id = h.id
   AND NOT EXISTS (
     SELECT 1
       FROM messages m
      WHERE m.conversation_id = h.id
        AND m.sender_type = 'agent'
        AND COALESCE(m.ai_generated, false) = false
        AND m.created_at > h.since
   );
