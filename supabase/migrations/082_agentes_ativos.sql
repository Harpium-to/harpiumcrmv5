-- ============================================================
-- 082_agentes_ativos.sql — agents that start work on their own
--
-- docs/plano-agentes-ativos.md, Fases 0–2.
--
--   agent_engine_state    — when the agent engine last ran. The queue
--                           (045) is inert without its scheduler, and
--                           nothing told anyone when it stopped; the
--                           Agentes screen now warns.
--   agents.daily_token_cap — a ceiling on what one agent spends in a
--                           day. The CRM does not know each model's
--                           price, so the cap is in tokens, which it
--                           does know (agent_tasks.total_tokens).
--   agent_rondas          — the agent's rounds: on a schedule it looks
--                           at the CRM with a cheap query and only calls
--                           the AI for what the query found.
--   agent_ronda_runs      — every round, including the empty ones: "it
--                           ran, found nothing" is an answer people ask
--                           for.
--   agent_proactive_sends — every message an agent sent on its own
--                           initiative, so the per-contact limit (1 a
--                           day, 3 a week) is a count, not a guess.
--
-- RLS: members read; agents' settings (rondas) are admin+ to write,
-- like `agents` itself (044); the rest is written by the service role.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The engine's pulse. One row for the whole instance.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_engine_state (
  id            smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_tick_at  timestamptz,
  last_summary  jsonb
);
INSERT INTO agent_engine_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE agent_engine_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_engine_state_select ON agent_engine_state;
-- Holds a timestamp and counts, nothing about any CRM.
CREATE POLICY agent_engine_state_select ON agent_engine_state FOR SELECT
  TO authenticated USING (true);

-- ------------------------------------------------------------
-- 2. A day's ceiling per agent, in tokens.
-- ------------------------------------------------------------
ALTER TABLE agents ADD COLUMN IF NOT EXISTS daily_token_cap integer NOT NULL DEFAULT 300000;
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_daily_token_cap_check;
ALTER TABLE agents ADD CONSTRAINT agents_daily_token_cap_check
  CHECK (daily_token_cap BETWEEN 10000 AND 10000000);

-- The cap sums an agent's recent tasks.
CREATE INDEX IF NOT EXISTS agent_tasks_agent_started_idx
  ON agent_tasks (agent_id, started_at DESC);

-- ------------------------------------------------------------
-- 3. Rondas.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_rondas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  agent_id            uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name                text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  -- What the cheap query looks for. See src/lib/agents/rondas-checks.ts.
  check_kind          text NOT NULL CHECK (check_kind IN (
                        'conversas_sem_resposta',
                        'lead_sem_contato',
                        'orcamento_parado',
                        'cliente_sumido',
                        'reuniao_sem_confirmacao',
                        'falta_na_agenda',
                        'pos_venda'
                      )),
  -- The check's knobs: {"horas": 2}, {"dias": 3}, {"minutos": 15}.
  params              jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- What the agent should do with each case found. Plain language.
  instruction         text NOT NULL DEFAULT ''
                        CHECK (length(instruction) <= 2000),
  -- Either every N minutes while the agent is on shift…
  every_minutes       integer CHECK (every_minutes IS NULL OR every_minutes BETWEEN 15 AND 1440),
  -- …or once a day at a fixed time, on these ISO weekdays.
  run_at              time,
  run_days            smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',
  -- Cases handed to the agent per round. The rest wait for the next.
  max_per_run         smallint NOT NULL DEFAULT 5 CHECK (max_per_run BETWEEN 1 AND 20),
  -- Messages from this round ask a person first, whatever the agent's
  -- autonomy, until someone switches this off for the round.
  send_needs_approval boolean NOT NULL DEFAULT true,
  is_active           boolean NOT NULL DEFAULT true,
  next_run_at         timestamptz NOT NULL DEFAULT now(),
  last_run_at         timestamptz,
  last_found          integer,
  last_note           text,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (every_minutes IS NOT NULL OR run_at IS NOT NULL)
);

-- The scheduler's scan: active rounds that are due.
CREATE INDEX IF NOT EXISTS agent_rondas_due_idx
  ON agent_rondas (next_run_at) WHERE is_active;
CREATE INDEX IF NOT EXISTS agent_rondas_account_idx
  ON agent_rondas (account_id, agent_id);

ALTER TABLE agent_rondas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_rondas_select ON agent_rondas;
CREATE POLICY agent_rondas_select ON agent_rondas FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS agent_rondas_insert ON agent_rondas;
CREATE POLICY agent_rondas_insert ON agent_rondas FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS agent_rondas_update ON agent_rondas;
CREATE POLICY agent_rondas_update ON agent_rondas FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS agent_rondas_delete ON agent_rondas;
CREATE POLICY agent_rondas_delete ON agent_rondas FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON agent_rondas;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON agent_rondas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 4. Every round that ran.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_ronda_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ronda_id    uuid NOT NULL REFERENCES agent_rondas(id) ON DELETE CASCADE,
  agent_id    uuid REFERENCES agents(id) ON DELETE SET NULL,
  ran_at      timestamptz NOT NULL DEFAULT now(),
  -- What the query found, and how many became work for the agent.
  found       integer NOT NULL DEFAULT 0,
  queued      integer NOT NULL DEFAULT 0,
  -- Why the others were left alone: {"limite": 2, "opt_out": 1}.
  skipped     jsonb NOT NULL DEFAULT '{}'::jsonb,
  note        text
);
CREATE INDEX IF NOT EXISTS agent_ronda_runs_ronda_idx
  ON agent_ronda_runs (ronda_id, ran_at DESC);

ALTER TABLE agent_ronda_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_ronda_runs_select ON agent_ronda_runs;
CREATE POLICY agent_ronda_runs_select ON agent_ronda_runs FOR SELECT
  USING (is_account_member(account_id));

-- ------------------------------------------------------------
-- 5. Messages an agent sent on its own initiative.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_proactive_sends (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  agent_id    uuid REFERENCES agents(id) ON DELETE SET NULL,
  ronda_id    uuid REFERENCES agent_rondas(id) ON DELETE SET NULL,
  task_id     uuid REFERENCES agent_tasks(id) ON DELETE SET NULL,
  sent_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_proactive_sends_contact_idx
  ON agent_proactive_sends (account_id, contact_id, sent_at DESC);

ALTER TABLE agent_proactive_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_proactive_sends_select ON agent_proactive_sends;
CREATE POLICY agent_proactive_sends_select ON agent_proactive_sends FOR SELECT
  USING (is_account_member(account_id));
