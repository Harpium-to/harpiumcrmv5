-- ============================================================
-- 052_uso_plataforma.sql — usage signals for the platform panel (Fase 4)
--
-- See docs/plano-plataforma-agencia.md §6. The agency panel needs to
-- know, per client CRM, who is using it and how much. Two pieces:
--
--   1. account_activity_days — one row per (CRM, member, day) the
--      member had the CRM open. Written by touch_presence(), the
--      heartbeat the app already sends every ~30s (024), so "active
--      users" and "last access" need no new client code. member_presence
--      only keeps each user's latest heartbeat; this keeps history.
--      Days are São Paulo dates — the platform's clients are Brazilian.
--      The agency inside a client CRM (set_active_account) is NOT
--      counted: it would make an abandoned CRM look used.
--
--   2. agencia_platform_usage() — every non-archived CRM's numbers in
--      one set-based query: members, active users this week and last,
--      last access, messages per week for six weeks, open / unassigned /
--      unanswered conversations, a connected channel, modules in use,
--      deals moved and won. Aggregates only — no names, no text — so the
--      panel can show it whatever consent level each CRM granted.
--      Service role only.
--
-- Computed on demand rather than rolled up by a cron: at the agency's
-- scale (tens of CRMs) a 6-week aggregate is cheap, and there is no
-- scheduler to keep in sync. If volume grows, snapshot this function's
-- output into a daily table and read that instead.
--
-- The health score and alerts are computed in TypeScript from these
-- numbers (src/lib/agencia/health.ts), where they are easy to tune
-- and test.
--
-- Idempotent — safe to run multiple times.
-- ============================================================


-- ============================================================
-- 1. ACTIVITY DAYS
-- ============================================================
CREATE TABLE IF NOT EXISTS account_activity_days (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day        DATE NOT NULL,
  PRIMARY KEY (account_id, user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_account_activity_days_account_day
  ON account_activity_days(account_id, day DESC);

ALTER TABLE account_activity_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_activity_days_select ON account_activity_days;
CREATE POLICY account_activity_days_select ON account_activity_days FOR SELECT
  USING (is_agencia());

-- Seed with what presence already knows: each member's last heartbeat.
INSERT INTO account_activity_days (account_id, user_id, day)
SELECT p.account_id, p.user_id, (p.last_seen_at AT TIME ZONE 'America/Sao_Paulo')::date
FROM member_presence p
JOIN account_members m ON m.account_id = p.account_id AND m.user_id = p.user_id
ON CONFLICT DO NOTHING;

-- 024's heartbeat, plus the day of activity for members.
CREATE OR REPLACE FUNCTION public.touch_presence(
  p_status TEXT DEFAULT 'online'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('online', 'away') THEN
    RAISE EXCEPTION 'Invalid presence status: %', p_status
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account_id
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;

  INSERT INTO member_presence (user_id, account_id, status, last_seen_at)
  VALUES (auth.uid(), v_account_id, p_status, now())
  ON CONFLICT (user_id) DO UPDATE
    SET status       = excluded.status,
        last_seen_at = now(),
        account_id   = excluded.account_id;

  -- Only real members count as use of the CRM; 'away' is a tab left
  -- open in the background, not use.
  IF p_status = 'online' AND member_role_in(v_account_id) IS NOT NULL THEN
    INSERT INTO account_activity_days (account_id, user_id, day)
    VALUES (v_account_id, auth.uid(), (now() AT TIME ZONE 'America/Sao_Paulo')::date)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

ALTER FUNCTION public.touch_presence(TEXT) OWNER TO postgres;


-- ============================================================
-- 2. PER-CRM USAGE
-- ============================================================
DROP FUNCTION IF EXISTS public.agencia_platform_usage();
CREATE FUNCTION public.agencia_platform_usage()
RETURNS TABLE (
  account_id           UUID,
  members_total        INT,
  active_users_7d      INT,
  active_users_prev_7d INT,
  last_activity_at     TIMESTAMPTZ,
  -- Messages per week: w0 = last 7 days, w1 = the 7 before, … w5.
  msgs_w0 INT, msgs_w1 INT, msgs_w2 INT, msgs_w3 INT, msgs_w4 INT, msgs_w5 INT,
  msgs_in_7d           INT,
  msgs_out_7d          INT,
  open_conversations   INT,
  open_unassigned      INT,
  -- Open conversations whose last message is the customer's, 24h+ ago.
  unanswered_24h       INT,
  channel_connected    BOOLEAN,
  automations_active   INT,
  flows_active         INT,
  agents_active        INT,
  broadcasts_30d       INT,
  deals_moved_30d      INT,
  won_30d              INT,
  won_value_30d        NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  clock AS (
    SELECT now() AS t, (now() AT TIME ZONE 'America/Sao_Paulo')::date AS today
  ),
  acc AS (
    SELECT id FROM accounts WHERE status <> 'archived'
  ),
  mem AS (
    SELECT m.account_id, count(*)::int AS n
    FROM account_members m GROUP BY 1
  ),
  act AS (
    SELECT d.account_id,
           count(DISTINCT d.user_id) FILTER (WHERE d.day > c.today - 7)::int AS a7,
           count(DISTINCT d.user_id) FILTER (
             WHERE d.day <= c.today - 7 AND d.day > c.today - 14)::int AS a14,
           max(d.day) AS last_day
    FROM account_activity_days d, clock c
    GROUP BY 1
  ),
  pres AS (
    SELECT p.account_id, max(p.last_seen_at) AS last_seen
    FROM member_presence p
    JOIN account_members m ON m.account_id = p.account_id AND m.user_id = p.user_id
    GROUP BY 1
  ),
  msg AS (
    SELECT cv.account_id,
           count(*) FILTER (WHERE ms.created_at > c.t - interval '7 days')::int AS w0,
           count(*) FILTER (WHERE ms.created_at <= c.t - interval '7 days'
                              AND ms.created_at > c.t - interval '14 days')::int AS w1,
           count(*) FILTER (WHERE ms.created_at <= c.t - interval '14 days'
                              AND ms.created_at > c.t - interval '21 days')::int AS w2,
           count(*) FILTER (WHERE ms.created_at <= c.t - interval '21 days'
                              AND ms.created_at > c.t - interval '28 days')::int AS w3,
           count(*) FILTER (WHERE ms.created_at <= c.t - interval '28 days'
                              AND ms.created_at > c.t - interval '35 days')::int AS w4,
           count(*) FILTER (WHERE ms.created_at <= c.t - interval '35 days')::int AS w5,
           count(*) FILTER (WHERE ms.created_at > c.t - interval '7 days'
                              AND ms.sender_type = 'customer')::int AS in7,
           count(*) FILTER (WHERE ms.created_at > c.t - interval '7 days'
                              AND ms.sender_type <> 'customer')::int AS out7
    FROM messages ms
    JOIN conversations cv ON cv.id = ms.conversation_id
    CROSS JOIN clock c
    WHERE ms.created_at > c.t - interval '42 days'
    GROUP BY 1
  ),
  conv AS (
    SELECT account_id,
           count(*)::int AS open_n,
           count(*) FILTER (WHERE assigned_agent_id IS NULL)::int AS unassigned
    FROM conversations
    WHERE status <> 'closed'
    GROUP BY 1
  ),
  unans AS (
    SELECT cv.account_id, count(*)::int AS n
    FROM conversations cv
    CROSS JOIN clock c
    CROSS JOIN LATERAL (
      SELECT ms.sender_type, ms.created_at
      FROM messages ms
      WHERE ms.conversation_id = cv.id
      ORDER BY ms.created_at DESC
      LIMIT 1
    ) last_msg
    WHERE cv.status <> 'closed'
      AND last_msg.sender_type = 'customer'
      AND last_msg.created_at < c.t - interval '24 hours'
    GROUP BY 1
  ),
  chan AS (
    SELECT account_id FROM whatsapp_config WHERE status = 'connected'
    UNION SELECT account_id FROM evolution_config WHERE enabled
    UNION SELECT account_id FROM uazapi_config WHERE enabled
    UNION SELECT account_id FROM instagram_config WHERE enabled
  ),
  autos AS (
    SELECT account_id, count(*)::int AS n FROM automations WHERE is_active GROUP BY 1
  ),
  flws AS (
    SELECT account_id, count(*)::int AS n FROM flows WHERE status = 'active' GROUP BY 1
  ),
  agts AS (
    SELECT account_id, count(*)::int AS n FROM agents WHERE is_active GROUP BY 1
  ),
  bcs AS (
    SELECT b.account_id, count(*)::int AS n
    FROM broadcasts b, clock c
    WHERE b.status IN ('sending', 'sent') AND b.created_at > c.t - interval '30 days'
    GROUP BY 1
  ),
  dls AS (
    SELECT d.account_id,
           count(*) FILTER (WHERE d.updated_at > c.t - interval '30 days')::int AS moved,
           count(*) FILTER (WHERE d.status = 'won'
                              AND COALESCE(d.closed_at, d.updated_at) > c.t - interval '30 days')::int AS won,
           COALESCE(sum(d.value) FILTER (WHERE d.status = 'won'
                              AND COALESCE(d.closed_at, d.updated_at) > c.t - interval '30 days'), 0) AS won_value
    FROM deals d, clock c
    GROUP BY 1
  )
  SELECT
    a.id,
    COALESCE(mem.n, 0),
    COALESCE(act.a7, 0),
    COALESCE(act.a14, 0),
    GREATEST(pres.last_seen, act.last_day::timestamptz),
    COALESCE(msg.w0, 0), COALESCE(msg.w1, 0), COALESCE(msg.w2, 0),
    COALESCE(msg.w3, 0), COALESCE(msg.w4, 0), COALESCE(msg.w5, 0),
    COALESCE(msg.in7, 0),
    COALESCE(msg.out7, 0),
    COALESCE(conv.open_n, 0),
    COALESCE(conv.unassigned, 0),
    COALESCE(unans.n, 0),
    a.id IN (SELECT account_id FROM chan),
    COALESCE(autos.n, 0),
    COALESCE(flws.n, 0),
    COALESCE(agts.n, 0),
    COALESCE(bcs.n, 0),
    COALESCE(dls.moved, 0),
    COALESCE(dls.won, 0),
    COALESCE(dls.won_value, 0)
  FROM acc a
  LEFT JOIN mem   ON mem.account_id   = a.id
  LEFT JOIN act   ON act.account_id   = a.id
  LEFT JOIN pres  ON pres.account_id  = a.id
  LEFT JOIN msg   ON msg.account_id   = a.id
  LEFT JOIN conv  ON conv.account_id  = a.id
  LEFT JOIN unans ON unans.account_id = a.id
  LEFT JOIN autos ON autos.account_id = a.id
  LEFT JOIN flws  ON flws.account_id  = a.id
  LEFT JOIN agts  ON agts.account_id  = a.id
  LEFT JOIN bcs   ON bcs.account_id   = a.id
  LEFT JOIN dls   ON dls.account_id   = a.id;
$$;

ALTER FUNCTION public.agencia_platform_usage() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.agencia_platform_usage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agencia_platform_usage() TO service_role;
