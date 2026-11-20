-- ============================================================
-- 079_radar_metricas.sql — the Radar's daily ledger: one number per
-- metric, per day (in the CRM's time zone), per CRM.
--
-- See docs/plano-radar-monitoramento.md (§5.1, Fase 1). Pieces:
--
--   1. metric_daily — the ledger. `dimension` breaks a metric down
--      (the lead's origin); '' is the total. Count metrics get a row
--      for every day, zeros included, because a day with no leads is
--      data; a median (first response) only exists on days that had
--      something to measure.
--   2. radar_state — the scheduler's bookkeeping per CRM: its time
--      zone, the first day it tracks, the last day it closed, when it
--      last refreshed today. 080 adds the detection and digest marks.
--   3. radar_compute_days(account, from, to, tz) — (re)computes every
--      metric for those days in one pass and replaces what was there,
--      so running it twice changes nothing. Service role only: the
--      scheduler (src/lib/radar/livro.ts) is its one caller.
--
-- Metrics (keys read by src/lib/radar/metricas.ts):
--   leads (by origin)            contacts created that day (as the reports)
--   conversas_novas              conversations opened
--   mensagens_recebidas          messages from customers
--   primeira_resposta_min / _n   median minutes to the first reply, and
--                                how many waits it is the median of (048)
--   negocios_criados / _valor    deals created, and their value
--   negocios_ganhos / _valor     deals won (closed_at, 046)
--   negocios_perdidos            deals lost
--   consultas_marcadas           appointments booked that day
--   consultas_realizadas         appointments that day marked done
--   faltas                       appointments that day marked no-show
--   prazo_estourado              conversations past a setor deadline (078)
--
-- Idempotent — safe to run more than once.
-- ============================================================


-- ------------------------------------------------------------
-- 1. The ledger
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS metric_daily (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day        DATE NOT NULL,
  metric     TEXT NOT NULL CHECK (char_length(metric) BETWEEN 1 AND 60),
  dimension  TEXT NOT NULL DEFAULT '' CHECK (char_length(dimension) <= 120),
  value      NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, metric, dimension, day)
);

CREATE INDEX IF NOT EXISTS idx_metric_daily_account_day ON metric_daily (account_id, day);

ALTER TABLE metric_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS metric_daily_select ON metric_daily;
CREATE POLICY metric_daily_select ON metric_daily FOR SELECT
  USING (is_account_member(account_id));
REVOKE INSERT, UPDATE, DELETE ON metric_daily FROM anon, authenticated;


-- ------------------------------------------------------------
-- 2. The scheduler's bookkeeping
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radar_state (
  account_id         UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  -- The CRM has no zone of its own; days are cut here. Brazil by default.
  timezone           TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  -- First day the ledger covers (the CRM's first day, or 12 weeks back).
  tracked_since      DATE,
  -- Last day already closed (yesterday, once the scheduler caught up).
  computed_through   DATE,
  today_refreshed_at TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at ON radar_state;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON radar_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE radar_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS radar_state_select ON radar_state;
CREATE POLICY radar_state_select ON radar_state FOR SELECT
  USING (is_account_member(account_id));
REVOKE INSERT, UPDATE, DELETE ON radar_state FROM anon, authenticated;


-- ------------------------------------------------------------
-- 3. Compute a range of days
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.radar_compute_days(
  p_account UUID,
  p_from DATE,
  p_to DATE,
  p_tz TEXT DEFAULT 'America/Sao_Paulo'
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t0 TIMESTAMPTZ;
  v_t1 TIMESTAMPTZ;
  v_first JSONB;
  v_rows INT;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RETURN 0;
  END IF;
  IF p_to - p_from > 400 THEN
    RAISE EXCEPTION 'Intervalo grande demais: no máximo 400 dias' USING ERRCODE = '22023';
  END IF;

  -- Local midnights, as instants.
  v_t0 := p_from::timestamp AT TIME ZONE p_tz;
  v_t1 := (p_to + 1)::timestamp AT TIME ZONE p_tz;

  -- First response (048), one call for the whole range, by local day.
  BEGIN
    v_first := report_first_response(p_account, v_t0, v_t1, p_tz) -> 'by_day';
  EXCEPTION WHEN undefined_function THEN
    v_first := '[]'::jsonb;
  END;

  DELETE FROM metric_daily
   WHERE account_id = p_account
     AND day BETWEEN p_from AND p_to;

  WITH days AS (
    SELECT d::date AS day FROM generate_series(p_from, p_to, INTERVAL '1 day') AS d
  ),
  counted AS (
    -- leads (total) and their origins, as the reports count them
    SELECT 'leads' AS metric, '' AS dimension,
           (c.created_at AT TIME ZONE p_tz)::date AS day, count(*)::numeric AS value
      FROM contacts c
     WHERE c.account_id = p_account AND c.created_at >= v_t0 AND c.created_at < v_t1
     GROUP BY 3
    UNION ALL
    SELECT 'leads', COALESCE(NULLIF(btrim(c.source), ''), 'sem origem'),
           (c.created_at AT TIME ZONE p_tz)::date, count(*)
      FROM contacts c
     WHERE c.account_id = p_account AND c.created_at >= v_t0 AND c.created_at < v_t1
     GROUP BY 2, 3
    UNION ALL
    SELECT 'conversas_novas', '', (v.created_at AT TIME ZONE p_tz)::date, count(*)
      FROM conversations v
     WHERE v.account_id = p_account AND v.created_at >= v_t0 AND v.created_at < v_t1
     GROUP BY 3
    UNION ALL
    SELECT 'mensagens_recebidas', '', (m.created_at AT TIME ZONE p_tz)::date, count(*)
      FROM messages m
      JOIN conversations v ON v.id = m.conversation_id
     WHERE v.account_id = p_account
       AND m.sender_type = 'customer'
       AND m.created_at >= v_t0 AND m.created_at < v_t1
     GROUP BY 3
    UNION ALL
    SELECT 'negocios_criados', '', (d.created_at AT TIME ZONE p_tz)::date, count(*)
      FROM deals d
     WHERE d.account_id = p_account AND d.created_at >= v_t0 AND d.created_at < v_t1
     GROUP BY 3
    UNION ALL
    SELECT 'negocios_criados_valor', '', (d.created_at AT TIME ZONE p_tz)::date, COALESCE(sum(d.value), 0)
      FROM deals d
     WHERE d.account_id = p_account AND d.created_at >= v_t0 AND d.created_at < v_t1
     GROUP BY 3
    UNION ALL
    SELECT 'negocios_ganhos', '', (COALESCE(d.closed_at, d.updated_at) AT TIME ZONE p_tz)::date, count(*)
      FROM deals d
     WHERE d.account_id = p_account AND d.status = 'won'
       AND COALESCE(d.closed_at, d.updated_at) >= v_t0 AND COALESCE(d.closed_at, d.updated_at) < v_t1
     GROUP BY 3
    UNION ALL
    SELECT 'negocios_ganhos_valor', '', (COALESCE(d.closed_at, d.updated_at) AT TIME ZONE p_tz)::date,
           COALESCE(sum(d.value), 0)
      FROM deals d
     WHERE d.account_id = p_account AND d.status = 'won'
       AND COALESCE(d.closed_at, d.updated_at) >= v_t0 AND COALESCE(d.closed_at, d.updated_at) < v_t1
     GROUP BY 3
    UNION ALL
    SELECT 'negocios_perdidos', '', (COALESCE(d.closed_at, d.updated_at) AT TIME ZONE p_tz)::date, count(*)
      FROM deals d
     WHERE d.account_id = p_account AND d.status = 'lost'
       AND COALESCE(d.closed_at, d.updated_at) >= v_t0 AND COALESCE(d.closed_at, d.updated_at) < v_t1
     GROUP BY 3
    UNION ALL
    SELECT 'consultas_marcadas', '', (e.created_at AT TIME ZONE p_tz)::date, count(*)
      FROM calendar_events e
     WHERE e.account_id = p_account AND e.kind = 'appointment'
       AND e.created_at >= v_t0 AND e.created_at < v_t1
     GROUP BY 3
    UNION ALL
    SELECT 'consultas_realizadas', '', (e.starts_at AT TIME ZONE p_tz)::date, count(*)
      FROM calendar_events e
     WHERE e.account_id = p_account AND e.kind = 'appointment' AND e.status = 'done'
       AND e.starts_at >= v_t0 AND e.starts_at < v_t1
     GROUP BY 3
    UNION ALL
    SELECT 'faltas', '', (e.starts_at AT TIME ZONE p_tz)::date, count(*)
      FROM calendar_events e
     WHERE e.account_id = p_account AND e.kind = 'appointment' AND e.status = 'no_show'
       AND e.starts_at >= v_t0 AND e.starts_at < v_t1
     GROUP BY 3
    UNION ALL
    SELECT 'prazo_estourado', '', x.day, count(DISTINCT x.conversation_id)
      FROM (
        SELECT (t.created_at AT TIME ZONE p_tz)::date AS day, t.conversation_id
          FROM conversation_transfers t
         WHERE t.account_id = p_account AND t.source = 'prazo'
           AND t.created_at >= v_t0 AND t.created_at < v_t1
        UNION
        SELECT (n.created_at AT TIME ZONE p_tz)::date, n.conversation_id
          FROM notifications n
         WHERE n.account_id = p_account AND n.type = 'conversation_overdue'
           AND n.conversation_id IS NOT NULL
           AND n.created_at >= v_t0 AND n.created_at < v_t1
      ) x
     GROUP BY 3
  ),
  -- Count metrics: every day gets its total, zero when nothing happened.
  zero_filled AS (
    SELECT k.metric, '' AS dimension, days.day, COALESCE(c.value, 0) AS value
      FROM days
     CROSS JOIN (VALUES
       ('leads'), ('conversas_novas'), ('mensagens_recebidas'),
       ('negocios_criados'), ('negocios_criados_valor'),
       ('negocios_ganhos'), ('negocios_ganhos_valor'), ('negocios_perdidos'),
       ('consultas_marcadas'), ('consultas_realizadas'), ('faltas'),
       ('prazo_estourado')
     ) AS k(metric)
      LEFT JOIN counted c
        ON c.metric = k.metric AND c.dimension = '' AND c.day = days.day
  ),
  breakdowns AS (
    SELECT metric, dimension, day, value FROM counted WHERE dimension <> ''
  ),
  first_reply AS (
    SELECT 'primeira_resposta_min' AS metric, '' AS dimension,
           (e ->> 'day')::date AS day,
           round(((e ->> 'median_seconds')::numeric / 60), 1) AS value
      FROM jsonb_array_elements(COALESCE(v_first, '[]'::jsonb)) AS e
     WHERE (e ->> 'median_seconds') IS NOT NULL
    UNION ALL
    SELECT 'primeira_resposta_n', '', (e ->> 'day')::date, (e ->> 'replied')::numeric
      FROM jsonb_array_elements(COALESCE(v_first, '[]'::jsonb)) AS e
  )
  INSERT INTO metric_daily (account_id, day, metric, dimension, value)
  SELECT p_account, day, metric, left(dimension, 120), value
    FROM (
      SELECT * FROM zero_filled
      UNION ALL SELECT * FROM breakdowns
      UNION ALL SELECT * FROM first_reply
    ) all_rows
   WHERE day BETWEEN p_from AND p_to
  ON CONFLICT (account_id, metric, dimension, day)
  DO UPDATE SET value = EXCLUDED.value, updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

ALTER FUNCTION public.radar_compute_days(UUID, DATE, DATE, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.radar_compute_days(UUID, DATE, DATE, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.radar_compute_days(UUID, DATE, DATE, TEXT) TO service_role;
