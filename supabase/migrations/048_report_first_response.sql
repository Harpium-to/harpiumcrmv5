-- ============================================================
-- 048_report_first_response.sql
--
-- "Quanto tempo o cliente espera pela primeira resposta?" — as a
-- function, because the honest answer needs every message of the
-- window paired against the next one in its conversation.
--
-- Why SQL and not the TypeScript the rest of the reports use. The
-- other sections aggregate rows that are already the answer (a deal
-- closed, a lead arrived). This one has to walk message *pairs*: over
-- 90 days that is every message the account sent or received, shipped
-- to the server just to find a few thousand gaps. Here the database
-- reads the index and returns one small JSON object.
--
-- What counts:
--   * A "wait" starts at a customer message whose previous message in
--     the conversation is NOT from the customer (or there is none). A
--     customer who sends five lines in a row is waiting once, from the
--     first line — counting each line would inflate the sample count
--     and shrink the median, because the later lines are answered
--     sooner by construction.
--   * It ends at the next agent or bot message in that conversation,
--     even if that lands after the window closes: the wait started in
--     the window, so it belongs to it.
--   * No reply yet → `unreplied`, not a zero. A zero would read as
--     "answered instantly", the opposite of the truth.
--   * Clock time, not business hours. The account has no opening hours
--     stored, and a guess at them would be a number nobody can check.
--
-- SECURITY INVOKER: the caller's RLS applies to `messages` and
-- `conversations` as it does to every other report query, and the
-- explicit account filter makes the scoping true in the query too.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- Both lookups below are "the message right before / right after this
-- one in its conversation". Without this index each is a scan of the
-- whole conversation; with it, one index probe.
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messages (conversation_id, created_at, id);

CREATE OR REPLACE FUNCTION public.report_first_response(
  p_account_id uuid,
  p_from       timestamptz,
  p_to         timestamptz,
  p_timezone   text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH starts AS (
    SELECT m.id, m.conversation_id, m.created_at
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.account_id = p_account_id
      AND m.sender_type = 'customer'
      AND m.created_at >= p_from
      AND m.created_at <  p_to
      -- The previous message may sit before the window; look it up
      -- regardless, or a wait that began yesterday would be counted
      -- again from this morning's follow-up line.
      AND COALESCE((
        SELECT p.sender_type
        FROM messages p
        WHERE p.conversation_id = m.conversation_id
          AND (p.created_at, p.id) < (m.created_at, m.id)
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT 1
      ), '') <> 'customer'
  ),
  paired AS (
    SELECT
      s.created_at AS customer_at,
      r.created_at AS reply_at,
      r.sender_type AS responder,
      EXTRACT(EPOCH FROM (r.created_at - s.created_at))::double precision AS seconds
    FROM starts s
    LEFT JOIN LATERAL (
      SELECT n.created_at, n.sender_type
      FROM messages n
      WHERE n.conversation_id = s.conversation_id
        AND n.sender_type <> 'customer'
        AND (n.created_at, n.id) > (s.created_at, s.id)
      ORDER BY n.created_at, n.id
      LIMIT 1
    ) r ON true
  ),
  replied AS (
    SELECT * FROM paired WHERE reply_at IS NOT NULL
  )
  SELECT jsonb_build_object(
    'replied',   (SELECT count(*) FROM replied),
    'unreplied', (SELECT count(*) FROM paired WHERE reply_at IS NULL),
    'median_seconds',
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds) FROM replied),
    'p90_seconds',
      (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY seconds) FROM replied),
    'by_responder', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('responder', responder, 'replied', n, 'median_seconds', med)
        ORDER BY responder
      )
      FROM (
        SELECT responder, count(*) AS n,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds) AS med
        FROM replied
        GROUP BY responder
      ) x
    ), '[]'::jsonb),
    -- Bucketed by the day the customer wrote, in the reader's zone, so
    -- the keys line up with every other per-day series on the screen.
    'by_day', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('day', day, 'replied', n, 'median_seconds', med)
        ORDER BY day
      )
      FROM (
        SELECT to_char(customer_at AT TIME ZONE p_timezone, 'YYYY-MM-DD') AS day,
               count(*) AS n,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds) AS med
        FROM replied
        GROUP BY 1
      ) y
    ), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.report_first_response(uuid, timestamptz, timestamptz, text)
  TO authenticated;
