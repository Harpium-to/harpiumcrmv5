-- ============================================================
-- 056_agencia_totais.sql — agency console totals counted in SQL
--
-- The console used to pull every contact / conversation / deal /
-- message row it summed. PostgREST caps a response at 1000 rows, so
-- past 1000 rows across all clients the counts silently stopped
-- growing (HANDOFF §3.1 fixed the same thing on the client dashboard).
-- Paging alone isn't enough at the agency's scale: a month of messages
-- across every client easily passes the 100k rows fetchAllRows allows
-- before it refuses.
--
-- So the totals are aggregated here and returned as ONE jsonb value
-- (a set-returning function would hit the same 1000-row cap once
-- accounts × days grows):
--
--   agencia_account_totals()     per CRM: contacts, open conversations,
--                                unassigned ones, open deals and value
--   agencia_message_stats(...)   messages per UTC day and per CRM
--                                (count in the window + last message)
--
-- Service role only, like the rest of the console's reads.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.agencia_account_totals()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'account_id',         a.id,
    'contacts',           COALESCE(c.n, 0),
    'open_conversations', COALESCE(v.open_n, 0),
    'open_unassigned',    COALESCE(v.unassigned, 0),
    'open_deals',         COALESCE(d.open_n, 0),
    'open_deal_value',    COALESCE(d.open_value, 0)
  )), '[]'::jsonb)
  FROM accounts a
  LEFT JOIN (
    SELECT account_id, count(*) AS n FROM contacts GROUP BY 1
  ) c ON c.account_id = a.id
  LEFT JOIN (
    SELECT account_id,
           count(*) AS open_n,
           count(*) FILTER (WHERE assigned_agent_id IS NULL) AS unassigned
    FROM conversations WHERE status <> 'closed' GROUP BY 1
  ) v ON v.account_id = a.id
  LEFT JOIN (
    SELECT account_id, count(*) AS open_n, sum(value) AS open_value
    FROM deals WHERE status NOT IN ('won', 'lost') GROUP BY 1
  ) d ON d.account_id = a.id;
$$;

ALTER FUNCTION public.agencia_account_totals() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.agencia_account_totals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agencia_account_totals() TO service_role;

-- Messages since p_since, optionally for one CRM.
--   daily       [{ day: 'YYYY-MM-DD' (UTC), incoming, outgoing }]
--   by_account  [{ account_id, messages, last_at }]
-- `messages` counts from p_count_since (defaults to p_since): the
-- console reads 14 days for "went quiet" but ranks on its own window.
DROP FUNCTION IF EXISTS public.agencia_message_stats(TIMESTAMPTZ, UUID, TIMESTAMPTZ);
CREATE FUNCTION public.agencia_message_stats(
  p_since TIMESTAMPTZ,
  p_account_id UUID DEFAULT NULL,
  p_count_since TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH m AS (
    SELECT ms.created_at, ms.sender_type, cv.account_id
    FROM messages ms
    JOIN conversations cv ON cv.id = ms.conversation_id
    WHERE ms.created_at >= p_since
      AND (p_account_id IS NULL OR cv.account_id = p_account_id)
  )
  SELECT jsonb_build_object(
    'daily', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('day', day, 'incoming', inc, 'outgoing', outg) ORDER BY day)
      FROM (
        SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
               count(*) FILTER (WHERE sender_type = 'customer') AS inc,
               count(*) FILTER (WHERE sender_type <> 'customer') AS outg
        FROM m GROUP BY 1
      ) x
    ), '[]'::jsonb),
    'by_account', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('account_id', account_id, 'messages', n, 'last_at', last_at))
      FROM (
        SELECT account_id,
               count(*) FILTER (WHERE created_at >= COALESCE(p_count_since, p_since)) AS n,
               max(created_at) AS last_at
        FROM m GROUP BY 1
      ) y
    ), '[]'::jsonb)
  );
$$;

ALTER FUNCTION public.agencia_message_stats(TIMESTAMPTZ, UUID, TIMESTAMPTZ) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.agencia_message_stats(TIMESTAMPTZ, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agencia_message_stats(TIMESTAMPTZ, UUID, TIMESTAMPTZ) TO service_role;
