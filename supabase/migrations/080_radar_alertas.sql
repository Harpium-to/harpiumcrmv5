-- ============================================================
-- 080_radar_alertas.sql — what the Radar finds and says: anomaly
-- alerts, its settings, the weekly digests, and each deal's chance of
-- closing.
--
-- See docs/plano-radar-monitoramento.md (§5.2–5.4, Fases 2 a 4). Pieces:
--
--   1. radar_alerts — one row per finding: a metric (or a rate) of a
--      CRM, maybe broken down (the lead's origin), over a day or a week,
--      that went far from its normal. Unique per period, so the
--      scheduler running twice never repeats one. People only change
--      its status (visto / ignorado), through radar_set_alert_status().
--   2. radar_settings — one row per CRM (absent = the defaults):
--      on/off, sensitivity, who is told, the weekly digest's day and
--      hour, alerts switched off, "ignorar até" per alert, whether
--      attendants see the chance of closing, weeks of history before
--      any anomaly alert.
--   3. radar_state gains the daily marks: detected_through,
--      chances_at, digest_week.
--   4. radar_digests — the weekly summary (text and the numbers it was
--      written from), one per CRM per ISO week.
--   5. deals.win_probability (0–1), win_probability_at,
--      win_probability_basis ('historico' | 'fraca'): written by the
--      scheduler from the CRM's own closed deals (src/lib/radar/chance.ts).
--   6. Notification type 'radar'.
--   7. radar_stage_rates + a trigger giving a moved deal its new stage's
--      rate at once; radar_set_win_probabilities() for the night run.
--   8. radar_cooling_leads(): hot or warm contacts waiting for us too long.
--
-- Idempotent — safe to run more than once.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Alerts
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radar_alerts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  metric       TEXT NOT NULL CHECK (char_length(metric) BETWEEN 1 AND 60),
  dimension    TEXT NOT NULL DEFAULT '' CHECK (char_length(dimension) <= 120),
  period       TEXT NOT NULL CHECK (period IN ('dia', 'semana')),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  value        NUMERIC NOT NULL,
  expected     NUMERIC NOT NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('alta', 'queda')),
  tone         TEXT NOT NULL CHECK (tone IN ('ruim', 'bom', 'neutro')),
  severity     TEXT NOT NULL CHECK (severity IN ('atencao', 'alta')),
  title        TEXT NOT NULL CHECK (char_length(title) <= 300),
  detail       TEXT CHECK (detail IS NULL OR char_length(detail) <= 500),
  href         TEXT CHECK (href IS NULL OR href ~ '^/'),
  status       TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'visto', 'ignorado')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, metric, dimension, period, period_start)
);

CREATE INDEX IF NOT EXISTS idx_radar_alerts_account_recent ON radar_alerts (account_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON radar_alerts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON radar_alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE radar_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS radar_alerts_select ON radar_alerts;
CREATE POLICY radar_alerts_select ON radar_alerts FOR SELECT
  USING (is_account_member(account_id));
REVOKE INSERT, UPDATE, DELETE ON radar_alerts FROM anon, authenticated;

-- People change the status only. "ignorado" is a decision for the
-- whole CRM, so it takes an admin; "visto" any attendant.
CREATE OR REPLACE FUNCTION public.radar_set_alert_status(p_alert_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('aberto', 'visto', 'ignorado') THEN
    RAISE EXCEPTION 'Situação inválida' USING ERRCODE = '22023';
  END IF;
  SELECT account_id INTO v_account FROM radar_alerts WHERE id = p_alert_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Alerta não encontrado' USING ERRCODE = '22023';
  END IF;
  IF NOT is_account_member(v_account, CASE WHEN p_status = 'ignorado' THEN 'admin' ELSE 'agent' END::account_role_enum) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = '42501';
  END IF;
  UPDATE radar_alerts SET status = p_status WHERE id = p_alert_id;
END;
$$;

ALTER FUNCTION public.radar_set_alert_status(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.radar_set_alert_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.radar_set_alert_status(UUID, TEXT) TO authenticated, service_role;


-- ------------------------------------------------------------
-- 2. Settings
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radar_settings (
  account_id            UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  enabled               BOOLEAN NOT NULL DEFAULT true,
  sensitivity           TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('baixa', 'normal', 'alta')),
  recipients            TEXT NOT NULL DEFAULT 'admins' CHECK (recipients IN ('admins', 'escolhidos')),
  recipient_ids         UUID[] NOT NULL DEFAULT '{}',
  digest_enabled        BOOLEAN NOT NULL DEFAULT true,
  digest_weekday        SMALLINT NOT NULL DEFAULT 1 CHECK (digest_weekday BETWEEN 1 AND 7),
  digest_hour           SMALLINT NOT NULL DEFAULT 8 CHECK (digest_hour BETWEEN 0 AND 23),
  disabled_metrics      TEXT[] NOT NULL DEFAULT '{}',
  -- "metric|dimension" → the last day it stays quiet ('YYYY-MM-DD').
  snoozed               JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(snoozed) = 'object'),
  show_chance_to_agents BOOLEAN NOT NULL DEFAULT true,
  min_weeks             SMALLINT NOT NULL DEFAULT 4 CHECK (min_weeks BETWEEN 2 AND 12),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at ON radar_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON radar_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE radar_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS radar_settings_select ON radar_settings;
CREATE POLICY radar_settings_select ON radar_settings FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS radar_settings_insert ON radar_settings;
CREATE POLICY radar_settings_insert ON radar_settings FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS radar_settings_update ON radar_settings;
CREATE POLICY radar_settings_update ON radar_settings FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));


-- ------------------------------------------------------------
-- 3. The scheduler's daily marks
-- ------------------------------------------------------------
ALTER TABLE radar_state
  ADD COLUMN IF NOT EXISTS detected_through DATE,
  ADD COLUMN IF NOT EXISTS chances_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS digest_week TEXT;


-- ------------------------------------------------------------
-- 4. Weekly digests
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radar_digests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  week         TEXT NOT NULL CHECK (week ~ '^[0-9]{4}-W[0-9]{2}$'),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  text         TEXT NOT NULL CHECK (char_length(text) <= 6000),
  -- The numbers it was written from (the AI saw these and nothing else).
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  by_ai        BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, week)
);

CREATE INDEX IF NOT EXISTS idx_radar_digests_account ON radar_digests (account_id, created_at DESC);

ALTER TABLE radar_digests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS radar_digests_select ON radar_digests;
CREATE POLICY radar_digests_select ON radar_digests FOR SELECT
  USING (is_account_member(account_id));
REVOKE INSERT, UPDATE, DELETE ON radar_digests FROM anon, authenticated;


-- ------------------------------------------------------------
-- 5. Each deal's chance of closing
-- ------------------------------------------------------------
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS win_probability NUMERIC(4, 3)
    CHECK (win_probability IS NULL OR (win_probability >= 0 AND win_probability <= 1)),
  ADD COLUMN IF NOT EXISTS win_probability_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS win_probability_basis TEXT
    CHECK (win_probability_basis IS NULL OR win_probability_basis IN ('historico', 'fraca'));

COMMENT ON COLUMN deals.win_probability IS
  'Chance of closing (0–1), from the CRM''s own closed deals (080, src/lib/radar/chance.ts). NULL until computed.';


-- ------------------------------------------------------------
-- 6. Notification type
-- ------------------------------------------------------------
DO $$
DECLARE
  v_name  TEXT;
  v_def   TEXT;
  v_types TEXT[] := ARRAY[]::TEXT[];
BEGIN
  FOR v_name, v_def IN
    SELECT conname, pg_get_constraintdef(oid)
    FROM pg_constraint
    WHERE conrelid = 'public.notifications'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%conversation_assigned%'
  LOOP
    v_types := v_types || ARRAY(
      SELECT m[1] FROM regexp_matches(v_def, '''([a-z_]+)''', 'g') AS m
    );
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', v_name);
  END LOOP;

  v_types := v_types || ARRAY['conversation_assigned', 'radar'];

  EXECUTE format(
    'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (%s))',
    (SELECT string_agg(quote_literal(t), ', ' ORDER BY t)
     FROM (SELECT DISTINCT unnest(v_types) AS t) AS distinct_types)
  );
END $$;


-- ------------------------------------------------------------
-- 7. Chance of closing: per-stage rates, kept fresh on stage moves
--
-- The scheduler (src/lib/radar/chance.ts) writes, each night, every
-- open deal's chance and each stage's base rate. When a person moves a
-- deal, the trigger below gives it its new stage's base rate at once,
-- so the card never shows the old stage's chance until the night run
-- refines it (temperature, time stopped, origin).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radar_stage_rates (
  stage_id     UUID PRIMARY KEY REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pipeline_id  UUID NOT NULL,
  rate         NUMERIC(4, 3) NOT NULL CHECK (rate >= 0 AND rate <= 1),
  -- Median days from creation to a win in this pipeline (the "normal" pace).
  typical_days INT NOT NULL DEFAULT 30,
  basis        TEXT NOT NULL CHECK (basis IN ('historico', 'fraca')),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_radar_stage_rates_account ON radar_stage_rates (account_id);

ALTER TABLE radar_stage_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS radar_stage_rates_select ON radar_stage_rates;
CREATE POLICY radar_stage_rates_select ON radar_stage_rates FOR SELECT
  USING (is_account_member(account_id));
REVOKE INSERT, UPDATE, DELETE ON radar_stage_rates FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.deals_radar_stage_chance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate  NUMERIC;
  v_basis TEXT;
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id AND NEW.status = 'open' THEN
    SELECT rate, basis INTO v_rate, v_basis FROM radar_stage_rates WHERE stage_id = NEW.stage_id;
    IF FOUND THEN
      NEW.win_probability := v_rate;
      NEW.win_probability_basis := v_basis;
      NEW.win_probability_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS radar_stage_chance ON deals;
CREATE TRIGGER radar_stage_chance
  BEFORE UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION deals_radar_stage_chance();

-- The night run writes every chance in one statement.
CREATE OR REPLACE FUNCTION public.radar_set_win_probabilities(p_account UUID, p_rows JSONB)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INT;
BEGIN
  UPDATE deals d
     SET win_probability = LEAST(GREATEST((r ->> 'p')::numeric, 0), 1),
         win_probability_basis = r ->> 'basis',
         win_probability_at = now()
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS r
   WHERE d.id = (r ->> 'id')::uuid
     AND d.account_id = p_account;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

ALTER FUNCTION public.radar_set_win_probabilities(UUID, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.radar_set_win_probabilities(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.radar_set_win_probabilities(UUID, JSONB) TO service_role;


-- ------------------------------------------------------------
-- 8. "Esfriando": hot or warm contacts whose last message is theirs
--    and has waited longer than it should (2 h hot, 24 h warm).
--    Service role only; the Radar route asks for its own CRM.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.radar_cooling_leads(p_account UUID, p_limit INT DEFAULT 30)
RETURNS TABLE (
  conversation_id UUID,
  contact_id UUID,
  name TEXT,
  temperature TEXT,
  waiting_since TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.id, c.id, COALESCE(NULLIF(c.name, ''), c.phone), c.temperature, last.created_at
    FROM conversations v
    JOIN contacts c ON c.id = v.contact_id
    CROSS JOIN LATERAL (
      SELECT m.sender_type, m.created_at
        FROM messages m
       WHERE m.conversation_id = v.id
       ORDER BY m.created_at DESC
       LIMIT 1
    ) last
   WHERE v.account_id = p_account
     AND v.status <> 'closed'
     AND c.temperature IN ('hot', 'warm')
     AND v.last_message_at > now() - INTERVAL '14 days'
     AND last.sender_type = 'customer'
     AND last.created_at < now() - CASE WHEN c.temperature = 'hot' THEN INTERVAL '2 hours' ELSE INTERVAL '24 hours' END
   ORDER BY (c.temperature = 'hot') DESC, last.created_at ASC
   LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

ALTER FUNCTION public.radar_cooling_leads(UUID, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.radar_cooling_leads(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.radar_cooling_leads(UUID, INT) TO service_role;
