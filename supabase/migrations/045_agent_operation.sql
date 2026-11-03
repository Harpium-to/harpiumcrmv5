-- ============================================================
-- 045_agent_operation.sql — agents become workers, not responders
--
-- Migration 044 gave an account a team of agents that *answer* when a
-- customer writes. That is a responder. This migration makes them
-- workers: they hold a job title, carry an objective and a quota, run
-- on a schedule, pick tasks off a queue, delegate to each other, and
-- stop to ask a human before anything the account said needs asking.
--
-- The four new tables map one-to-one onto the four things a worker
-- needs that a responder doesn't:
--
--   agent_tasks       — a unit of work that outlives the request that
--                       created it. An inbound message is answered in
--                       one shot; "prospect 20 furniture companies in
--                       Palmas" is not. Tasks are queued, retried,
--                       chained and audited.
--   agent_task_steps  — the visible inside of a run. The monitor shows
--                       "Etapa 3: construindo abordagem" because the
--                       runner writes a step row before doing it, not
--                       because the UI animates a guess.
--   agent_approvals   — the brake. An agent at autonomy 1 or 2 parks
--                       the action here and waits; a human approves,
--                       edits or rejects it.
--   agent_memory      — what the agent learned, separate from the CRM
--                       record. Objections, preferences, outcomes —
--                       the things a good rep remembers and a database
--                       row does not hold.
--
-- WHY A TABLE AND NOT A JOB RUNNER
--   The queue is Postgres rows claimed with FOR UPDATE SKIP LOCKED
--   (see `claim_agent_task`). It buys exactly-once claiming across
--   however many workers the deployment happens to have — a cron hit,
--   a webhook `after()` block, a future dedicated worker — with no
--   broker to operate. For a self-hostable product, a dependency the
--   forker has to run is a dependency most forkers won't.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. The agent grows a job description.
-- ============================================================

-- The job title. Drives the preset library, the default toolset, and
-- who the orchestrator hands work to. Free text (same reasoning as
-- `department` in 044) with a documented vocabulary:
--   prospector | researcher | sdr | followup | executive | closer
--   | success | manager | custom
ALTER TABLE agents ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'custom';

ALTER TABLE agents ADD COLUMN IF NOT EXISTS avatar_url text;

-- One sentence: what this agent is for. Shown on the card, and fed to
-- the model ahead of the long instructions so the objective survives a
-- prompt the operator later pads out.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS objective text;

-- How far it may go on its own.
--   1 assisted      — proposes, a human approves everything
--   2 semi          — routine work runs; strategic actions need approval
--   3 autonomous    — acts within the configured limits
--   4 orchestrating — plans its own queue and delegates to other agents
-- Deliberately a smallint with a CHECK rather than a set of booleans:
-- the levels are ordered, and every permission question in the app is
-- "is this agent at least level N".
ALTER TABLE agents ADD COLUMN IF NOT EXISTS autonomy smallint NOT NULL DEFAULT 1
  CHECK (autonomy BETWEEN 1 AND 4);

-- Capability allow-list. An agent can only call a tool named here, so
-- a researcher cannot send a WhatsApp message however the model is
-- prompted. See lib/agents/tools.ts for the vocabulary.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS tools text[] NOT NULL DEFAULT '{}';

-- Per-agent approval overrides. An action named here always stops for
-- a human, whatever the autonomy level allows. This is the "limites
-- por agente e tipo de ação" knob: autonomy sets the general ceiling,
-- this pins individual actions below it — a level-3 closer that may
-- message freely but must never send a proposal unreviewed.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS require_approval_for text[] NOT NULL DEFAULT '{}';

-- Channels this agent may speak on: whatsapp | instagram | email.
-- Empty means it does not talk to customers at all (a researcher).
ALTER TABLE agents ADD COLUMN IF NOT EXISTS channels text[] NOT NULL DEFAULT '{}';

-- Working hours. A sales agent that messages a stranger at 3am burns
-- the lead and, in several jurisdictions, breaks the rules on
-- unsolicited commercial contact. ISO weekdays: 1 = Monday … 7 = Sunday.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS work_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS work_start time NOT NULL DEFAULT '09:00';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS work_end   time NOT NULL DEFAULT '18:00';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS timezone   text NOT NULL DEFAULT 'America/Sao_Paulo';

-- Quotas, as {metric: target}: {"leads_per_day": 20, "meetings_per_week": 5}.
-- jsonb because the metrics that matter differ per role and the set
-- will keep moving; a column per metric would be a migration per idea.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS goals jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Live operational state, written by the runner. Distinct from
-- `is_active`, which is the operator's switch: an agent can be active
-- and idle, or active and stuck on an approval.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'idle'
  CHECK (status IN (
    'idle', 'working', 'researching', 'talking', 'analyzing',
    'waiting_reply', 'waiting_approval', 'paused', 'error'
  ));
ALTER TABLE agents ADD COLUMN IF NOT EXISTS status_detail text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NOT NULL DEFAULT now();

-- Lifetime spend on this agent, in USD. Accumulated by the runner from
-- provider usage so "which agent is costing us money" is a column
-- read, not a scan over every run.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS cost_usd numeric(12,6) NOT NULL DEFAULT 0;

-- ============================================================
-- 2. agent_tasks — the work queue.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_tasks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Who does it. NULL means unassigned — the orchestrator will route it
  -- to an agent of the right role when it runs.
  agent_id           uuid REFERENCES agents(id) ON DELETE SET NULL,
  -- Role to route to when `agent_id` is null. This is what makes
  -- "hand off to the SDR" expressible without knowing which SDR.
  target_role        text,
  -- Which agent delegated it. Null for human- or trigger-created work.
  created_by_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  kind               text NOT NULL,
  title              text NOT NULL,
  -- Parameters in, result out. The result is what the next task in the
  -- chain reads, so a handoff carries the briefing, not just a pointer.
  input              jsonb NOT NULL DEFAULT '{}'::jsonb,
  output             jsonb,

  contact_id         uuid REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id            uuid REFERENCES deals(id) ON DELETE SET NULL,
  conversation_id    uuid REFERENCES conversations(id) ON DELETE SET NULL,

  status             text NOT NULL DEFAULT 'queued'
                       CHECK (status IN (
                         'queued', 'blocked', 'running', 'waiting_approval',
                         'done', 'failed', 'cancelled'
                       )),
  -- Higher runs first. Same tiebreak discipline as agent routing.
  priority           integer NOT NULL DEFAULT 0,
  -- Not before this time. Drives follow-ups ("retomar em 48h") and
  -- working-hours deferral without a separate scheduler table.
  scheduled_for      timestamptz NOT NULL DEFAULT now(),

  -- A task blocked on another one. The runner releases it when the
  -- blocker reaches `done`.
  depends_on_task_id uuid REFERENCES agent_tasks(id) ON DELETE SET NULL,

  attempts           integer NOT NULL DEFAULT 0,
  max_attempts       integer NOT NULL DEFAULT 3,
  last_error         text,

  -- Duplicate suppression. "Prospect this company" fired twice by two
  -- triggers must enqueue once; callers pass a stable key and the
  -- unique index below does the rest.
  dedupe_key         text,

  total_tokens       integer NOT NULL DEFAULT 0,
  cost_usd           numeric(12,6) NOT NULL DEFAULT 0,

  created_at         timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  finished_at        timestamptz
);

-- The claim query's index: pending work for an account, best first.
CREATE INDEX IF NOT EXISTS agent_tasks_claim_idx
  ON agent_tasks (account_id, status, scheduled_for, priority DESC);

CREATE INDEX IF NOT EXISTS agent_tasks_agent_idx
  ON agent_tasks (agent_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_tasks_contact_idx
  ON agent_tasks (contact_id, created_at DESC);

-- Partial: most tasks carry no dedupe key, and those must not collide.
CREATE UNIQUE INDEX IF NOT EXISTS agent_tasks_dedupe_idx
  ON agent_tasks (account_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

ALTER TABLE agent_tasks ENABLE ROW LEVEL SECURITY;

-- Members read the queue. Writes go through the service role (the
-- runner) or through the API routes, which check the role first —
-- except for the human affordances the dashboard owns directly:
-- enqueueing work and cancelling it.
DROP POLICY IF EXISTS agent_tasks_select ON agent_tasks;
CREATE POLICY agent_tasks_select ON agent_tasks FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS agent_tasks_insert ON agent_tasks;
CREATE POLICY agent_tasks_insert ON agent_tasks FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS agent_tasks_update ON agent_tasks;
CREATE POLICY agent_tasks_update ON agent_tasks FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- 3. agent_task_steps — the inside of a run.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_task_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  task_id     uuid NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  seq         integer NOT NULL,
  label       text NOT NULL,
  status      text NOT NULL DEFAULT 'running'
                CHECK (status IN ('running', 'done', 'failed', 'skipped')),
  detail      text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS agent_task_steps_task_idx
  ON agent_task_steps (task_id, seq);

ALTER TABLE agent_task_steps ENABLE ROW LEVEL SECURITY;

-- Read-only to the dashboard; the runner writes under the service
-- role. Same reasoning as `agent_runs` in 044: the trace is evidence.
DROP POLICY IF EXISTS agent_task_steps_select ON agent_task_steps;
CREATE POLICY agent_task_steps_select ON agent_task_steps FOR SELECT
  USING (is_account_member(account_id));

-- ============================================================
-- 4. agent_approvals — the brake.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_approvals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  agent_id       uuid REFERENCES agents(id) ON DELETE SET NULL,
  agent_name_snapshot text NOT NULL,
  task_id        uuid REFERENCES agent_tasks(id) ON DELETE CASCADE,
  contact_id     uuid REFERENCES contacts(id) ON DELETE SET NULL,

  -- What is being asked for: send_message | discount | proposal
  -- | contract | delete | custom.
  kind           text NOT NULL,
  -- One line a human can decide on without opening anything else.
  summary        text NOT NULL,
  -- The exact action, so approving executes precisely what was shown.
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Set when the human edited before approving. The runner prefers
  -- this over `payload`, which keeps the original visible for audit.
  edited_payload jsonb,

  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  decided_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at     timestamptz,
  decision_note  text,
  -- Past this, the action is stale: a reply approved tomorrow is worse
  -- than no reply. The runner expires rather than sends.
  expires_at     timestamptz,
  -- Single-use latch. The runner claims an approved action with
  -- `UPDATE … SET executed_at = now() WHERE executed_at IS NULL`, so a
  -- task that is retried after a partial failure cannot send the same
  -- approved message a second time. Without it, "approve" would mean
  -- "approve at least once".
  executed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_approvals_pending_idx
  ON agent_approvals (account_id, status, created_at DESC);

ALTER TABLE agent_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_approvals_select ON agent_approvals;
CREATE POLICY agent_approvals_select ON agent_approvals FOR SELECT
  USING (is_account_member(account_id));

-- Deciding is an operator action, so it happens under the user's own
-- session — `decided_by` is then genuinely who clicked, not a service
-- role standing in for them. Agent-level members and up may decide.
DROP POLICY IF EXISTS agent_approvals_update ON agent_approvals;
CREATE POLICY agent_approvals_update ON agent_approvals FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- 5. agent_memory — what the agent learned.
-- ============================================================

-- pgvector is already installed by migration 030; re-declaring it
-- keeps this file runnable on its own.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS agent_memory (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- NULL agent_id + scope 'team' = shared memory every agent reads.
  agent_id   uuid REFERENCES agents(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  scope      text NOT NULL DEFAULT 'agent'
               CHECK (scope IN ('agent', 'team', 'contact')),
  -- fact | objection | preference | outcome | instruction
  kind       text NOT NULL DEFAULT 'fact',
  content    text NOT NULL,
  -- Mirrors ai_knowledge_chunks: lexical always, semantic when the
  -- account has an embeddings key. Same 1536 dims (text-embedding-3-small).
  fts        tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  embedding  vector(1536),
  -- Memories decay: a note about a budget from 2024 should not outrank
  -- one from last week. The retrieval functions order on this.
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_memory_account_idx
  ON agent_memory (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_memory_contact_idx
  ON agent_memory (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_memory_fts_idx
  ON agent_memory USING gin (fts);

ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_memory_select ON agent_memory;
CREATE POLICY agent_memory_select ON agent_memory FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS agent_memory_delete ON agent_memory;
CREATE POLICY agent_memory_delete ON agent_memory FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- 6. claim_agent_task — exactly-once task claiming.
--
-- The whole point of the queue. `FOR UPDATE SKIP LOCKED` lets several
-- workers hit this concurrently: each takes a different row, nobody
-- blocks, and no task is ever claimed twice. Doing the same thing from
-- the app ("select pending, then update") lets two workers read the
-- same row before either writes, which is how an agent messages the
-- same lead twice.
--
-- Also releases blocked tasks whose dependency has finished, so the
-- caller never has to reason about the chain.
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_agent_task(
  p_account_id uuid
)
RETURNS SETOF agent_tasks AS $$
BEGIN
  -- Promote anything whose blocker is done. Cheap: the index covers
  -- the status filter and the set is small.
  UPDATE agent_tasks t
  SET status = 'queued'
  WHERE t.account_id = p_account_id
    AND t.status = 'blocked'
    AND t.depends_on_task_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM agent_tasks d
      WHERE d.id = t.depends_on_task_id AND d.status = 'done'
    );

  RETURN QUERY
  WITH next_task AS (
    SELECT t.id
    FROM agent_tasks t
    WHERE t.account_id = p_account_id
      AND t.status = 'queued'
      AND t.scheduled_for <= now()
      AND t.attempts < t.max_attempts
    ORDER BY t.priority DESC, t.scheduled_for ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE agent_tasks t
  SET status = 'running',
      attempts = t.attempts + 1,
      started_at = COALESCE(t.started_at, now())
  FROM next_task
  WHERE t.id = next_task.id
  RETURNING t.*;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- The runner claims under the service role (cron and webhooks have no
-- auth.uid()). SECURITY DEFINER sets what it runs *with*, not who may
-- call it — mirrors the grant in 029/031.
GRANT EXECUTE ON FUNCTION public.claim_agent_task(uuid) TO service_role;

-- ============================================================
-- 7. Memory retrieval, mirroring match_ai_knowledge_*.
--
-- `p_agent_id` widens rather than narrows: an agent sees its own
-- memories plus the team's. Shared learning is the point — an
-- objection the SDR heard should reach the closer.
-- ============================================================
CREATE OR REPLACE FUNCTION public.match_agent_memory_fts(
  p_account_id uuid,
  p_agent_id   uuid,
  p_contact_id uuid,
  p_query      text,
  p_limit      integer DEFAULT 6
)
RETURNS TABLE (id uuid, content text, kind text, scope text, rank real) AS $$
  SELECT m.id, m.content, m.kind, m.scope,
         ts_rank(m.fts, plainto_tsquery('simple', p_query)) AS rank
  FROM agent_memory m
  WHERE m.account_id = p_account_id
    AND (
      m.scope = 'team'
      OR (m.scope = 'agent'   AND m.agent_id   = p_agent_id)
      OR (m.scope = 'contact' AND m.contact_id = p_contact_id)
    )
    AND m.fts @@ plainto_tsquery('simple', p_query)
  ORDER BY rank DESC, m.created_at DESC
  LIMIT GREATEST(p_limit, 1);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

-- The embedding arrives as a TEXT literal ('[0.1,0.2,…]') and is cast
-- inside, exactly as `match_ai_knowledge_semantic` does in migration
-- 030. This is not stylistic: PostgREST serialises RPC arguments as
-- JSON, and a JSON array does not coerce to `vector` across that
-- boundary — a `vector(1536)` parameter fails at call time. The cast
-- has to happen in SQL, so the wire type is text.
CREATE OR REPLACE FUNCTION public.match_agent_memory_semantic(
  p_account_id uuid,
  p_agent_id   uuid,
  p_contact_id uuid,
  p_embedding  text,
  p_limit      integer DEFAULT 6
)
RETURNS TABLE (id uuid, content text, kind text, scope text, similarity real) AS $$
  SELECT m.id, m.content, m.kind, m.scope,
         (1 - (m.embedding <=> p_embedding::vector(1536)))::real AS similarity
  FROM agent_memory m
  WHERE m.account_id = p_account_id
    AND m.embedding IS NOT NULL
    AND (
      m.scope = 'team'
      OR (m.scope = 'agent'   AND m.agent_id   = p_agent_id)
      OR (m.scope = 'contact' AND m.contact_id = p_contact_id)
    )
  ORDER BY m.embedding <=> p_embedding::vector(1536)
  LIMIT GREATEST(p_limit, 1);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

-- SECURITY INVOKER, so RLS on `agent_memory` still applies to a
-- dashboard caller; the runner reaches them through the service role,
-- which bypasses RLS as it does everywhere else. Mirrors 030/032.
GRANT EXECUTE ON FUNCTION public.match_agent_memory_fts(uuid, uuid, uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_agent_memory_semantic(uuid, uuid, uuid, text, integer) TO authenticated, service_role;

-- ============================================================
-- 8. Lead qualification fields the commercial operation needs.
--
-- The spec's lead card asks for things `contacts` has no column for.
-- Added here rather than as custom fields because agents route and
-- prioritise on them — a custom field is a string in a jsonb blob, and
-- "ordene por temperatura" has to be an index.
-- ============================================================
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS instagram   text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS website     text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS city        text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS segment     text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS job_title   text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source      text;
-- cold | warm | hot — the one an agent sorts a day's work by.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS temperature text NOT NULL DEFAULT 'cold'
  CHECK (temperature IN ('cold', 'warm', 'hot'));
-- 0–100, set by the qualifier agent.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS potential   smallint
  CHECK (potential IS NULL OR potential BETWEEN 0 AND 100);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS owner_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS contacts_temperature_idx
  ON contacts (account_id, temperature, potential DESC NULLS LAST);

-- ============================================================
-- 9. Realtime — the operation screens subscribe to these.
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['agent_tasks', 'agent_task_steps', 'agent_approvals', 'agents']
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END
$$;
