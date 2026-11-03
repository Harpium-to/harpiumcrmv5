-- ============================================================
-- 044_agent_team.sql — a team of AI agents, and a record of their work
--
-- Before this migration an account had exactly one AI persona:
-- `ai_configs.system_prompt`. That is the right shape for "a bot that
-- answers WhatsApp", and the wrong shape for an operation where sales,
-- support and billing answer differently, hand off to different people
-- and are turned on and off independently.
--
-- So this splits the two concerns that were fused in `ai_configs`:
--
--   ai_configs  — the ACCOUNT's provider credentials. Still one row:
--                 the BYO key, the default model, the master switch.
--                 Unchanged by this migration.
--   agents      — the PEOPLE. Many rows: each with its own persona,
--                 its own routing rules, its own on/off switch, and
--                 optionally its own model.
--
-- An agent never carries a key. It borrows the account's, which keeps
-- "where is my provider key" a single answer and means adding the
-- ninth agent costs nothing to set up.
--
-- ROUTING
--   An inbound message picks exactly one agent:
--     1. active agents whose `keywords` match the message text, taking
--        the highest `priority` (ties broken by oldest, for stability
--        across deploys);
--     2. otherwise the account's `is_fallback` agent;
--     3. otherwise nobody — the thread is left for a human, exactly as
--        it behaves today for accounts with no agents at all.
--   `is_fallback` is unique per account (partial index below): two
--   defaults would make step 2 a coin flip.
--
-- agent_runs
--   One row per inbound an agent considered — including the ones it
--   declined. "Why did nothing happen?" is the single most common
--   question about an autonomous responder, and a table that only
--   records successes cannot answer it. That is also why the row is
--   INSERTed as `running` before the provider call and UPDATEd after,
--   rather than written once at the end: a run that never finishes
--   (timeout, crashed worker) stays visible as `running` instead of
--   vanishing.
--
--   `agent_id` is ON DELETE SET NULL — deleting an agent must not
--   erase the history of what it did. `agent_name_snapshot` keeps the
--   feed readable after that happens.
--
-- RLS
--   Reads: any member (viewer+) — the live feed is for the whole team.
--   Agent writes: admin+, like every other settings-class table.
--   Run writes: service role only. Runs are recorded by the inbound
--   webhook, which has no `auth.uid()`; nothing in the dashboard
--   should be able to forge or edit them.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS agents (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by                      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name                            text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  -- Free text, not an enum: every business slices its departments
  -- differently and a CHECK constraint here would mean a migration
  -- every time someone adds "Pós-venda". The UI offers presets.
  department                      text NOT NULL DEFAULT 'geral',
  -- The persona. Layered under the same safety scaffold the single-
  -- agent assistant already uses (see lib/ai/defaults.ts), so an agent
  -- prompt customises tone and scope, it does not replace the guard
  -- rails.
  system_prompt                   text NOT NULL,
  -- NULL → inherit `ai_configs.model`. A cheap model for the FAQ agent
  -- and a stronger one for the sales agent is a real need, but most
  -- accounts never touch this.
  model                           text,
  keywords                        text[] NOT NULL DEFAULT '{}',
  priority                        integer NOT NULL DEFAULT 0,
  is_fallback                     boolean NOT NULL DEFAULT false,
  is_active                       boolean NOT NULL DEFAULT false,
  max_replies_per_conversation    integer NOT NULL DEFAULT 3
                                    CHECK (max_replies_per_conversation BETWEEN 1 AND 20),
  -- Where this agent sends a thread it can't handle. NULL → leave it
  -- unassigned in the shared queue.
  handoff_agent_id                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

-- Routing reads this on every inbound message, filtered to the
-- account's active agents and ordered by priority.
CREATE INDEX IF NOT EXISTS agents_account_active_idx
  ON agents (account_id, is_active, priority DESC);

-- At most one default per account. Partial, so the many agents with
-- is_fallback = false don't collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS agents_one_fallback_per_account
  ON agents (account_id) WHERE is_fallback;

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agents_select ON agents;
CREATE POLICY agents_select ON agents FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS agents_insert ON agents;
CREATE POLICY agents_insert ON agents FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS agents_update ON agents;
CREATE POLICY agents_update ON agents FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS agents_delete ON agents;
CREATE POLICY agents_delete ON agents FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON agents;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- agent_runs — the activity log the live monitor reads.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_runs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  agent_id             uuid REFERENCES agents(id) ON DELETE SET NULL,
  -- Survives the agent being deleted or renamed, so a six-month-old
  -- run still says who handled it.
  agent_name_snapshot  text NOT NULL,
  conversation_id      uuid REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id           uuid REFERENCES contacts(id) ON DELETE SET NULL,
  status               text NOT NULL DEFAULT 'running'
                         CHECK (status IN ('running', 'replied', 'handoff', 'skipped', 'failed')),
  -- What set it off. Only inbound messages today; kept open for the
  -- scheduled / manual triggers that will want the same feed.
  trigger              text NOT NULL DEFAULT 'inbound_message',
  -- Why this agent and not another one — shown in the feed so routing
  -- is debuggable without reading logs.
  matched_keyword      text,
  -- Truncated at write time (see lib/agents/runtime.ts). The feed is a
  -- monitor, not a second copy of the inbox.
  inbound_preview      text,
  output_preview       text,
  -- Set on 'skipped' / 'failed': the gate that stopped it.
  reason               text,
  prompt_tokens        integer,
  completion_tokens    integer,
  total_tokens         integer,
  duration_ms          integer,
  started_at           timestamptz NOT NULL DEFAULT now(),
  finished_at          timestamptz
);

-- The feed's only query: this account's runs, newest first.
CREATE INDEX IF NOT EXISTS agent_runs_account_started_idx
  ON agent_runs (account_id, started_at DESC);

-- Per-agent stats on the team screen (handled count, last run).
CREATE INDEX IF NOT EXISTS agent_runs_agent_started_idx
  ON agent_runs (agent_id, started_at DESC);

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;

-- Read-only to the dashboard. No INSERT/UPDATE/DELETE policy exists on
-- purpose: with RLS enabled and no policy, every write from a user
-- session is denied, leaving the service-role webhook as the only
-- writer. That is the property we want — the activity log is evidence.
DROP POLICY IF EXISTS agent_runs_select ON agent_runs;
CREATE POLICY agent_runs_select ON agent_runs FOR SELECT
  USING (is_account_member(account_id));

-- ============================================================
-- Which agent currently owns a thread.
--
-- Lets the inbox label a conversation with the agent answering it, and
-- keeps a thread with one agent across turns instead of re-routing on
-- every message (a customer who says "quero comprar" and then "quanto
-- custa?" should stay with the same agent).
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES agents(id) ON DELETE SET NULL;

-- ============================================================
-- Realtime — the live monitor subscribes to agent_runs.
--
-- Guarded: adding a table already in the publication raises, and this
-- migration must stay re-runnable. `supabase_realtime` is created by
-- Supabase itself; on a bare Postgres it may not exist, in which case
-- there is nothing to subscribe to and we skip quietly.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'agent_runs'
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE agent_runs;
  END IF;
END
$$;
