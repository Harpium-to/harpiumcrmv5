-- ============================================================
-- 074_assistente.sql — Harpi, o assistente do CRM
--
-- See docs/plano-assistente-crm.md. One migration for the four phases,
-- so production gets it in one paste:
--
--   1. assistant_conversations / assistant_messages — the chat with
--      the bot. Private to the person: nobody else in the CRM (owner
--      included) reads someone's conversations.
--   2. assistant_actions — every change the bot proposed. The row holds
--      the EXACT input that the confirmation card was built from; the
--      server executes that input, once (executed_at latch), and only
--      after a person clicked. Readable by the person and by the CRM's
--      admins (history); written only by the server (service role).
--   3. assistant_routines / assistant_routine_runs — jobs the bot does
--      on a schedule (weekday + time + zone), run by the automations
--      cron. A routine reads and reports; anything it wants to change
--      becomes an action waiting for its owner's OK.
--   4. assistant_memory — facts the team taught the bot about the CRM.
--
-- Plus: ai_configs gains the assistant switches, ai_usage_log a mode
-- 'assistant', notifications a type 'assistente'.
--
-- Idempotent — safe to run more than once.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Conversations and messages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assistant_conversations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT,
  -- 'chat': the person talking in the panel. 'routine': written by a
  -- routine run (the person still owns it and reads it in the panel).
  origin      TEXT NOT NULL DEFAULT 'chat' CHECK (origin IN ('chat', 'routine')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistant_conversations_owner
  ON assistant_conversations(account_id, user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_conversations_updated
  ON assistant_conversations(updated_at);

ALTER TABLE assistant_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assistant_conversations_select ON assistant_conversations;
CREATE POLICY assistant_conversations_select ON assistant_conversations FOR SELECT
  USING (user_id = auth.uid() AND is_account_member(account_id));

DROP POLICY IF EXISTS assistant_conversations_insert ON assistant_conversations;
CREATE POLICY assistant_conversations_insert ON assistant_conversations FOR INSERT
  WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));

DROP POLICY IF EXISTS assistant_conversations_update ON assistant_conversations;
CREATE POLICY assistant_conversations_update ON assistant_conversations FOR UPDATE
  USING (user_id = auth.uid() AND is_account_member(account_id))
  WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));

DROP POLICY IF EXISTS assistant_conversations_delete ON assistant_conversations;
CREATE POLICY assistant_conversations_delete ON assistant_conversations FOR DELETE
  USING (user_id = auth.uid() AND is_account_member(account_id));

CREATE TABLE IF NOT EXISTS assistant_messages (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Insertion order. Several rows land in the same transaction and
  -- millisecond (a tool call and its result), so the timestamp alone
  -- cannot order them.
  seq               BIGINT GENERATED ALWAYS AS IDENTITY,
  conversation_id   UUID NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- user: what the person typed. assistant: the model's text and tool
  -- calls. tool: the results of those calls. event: something the
  -- system tells the model (a card confirmed, cancelled, expired).
  role              TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'event')),
  content           JSONB NOT NULL DEFAULT '{}'::jsonb,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistant_messages_conversation
  ON assistant_messages(conversation_id, seq);

ALTER TABLE assistant_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assistant_messages_select ON assistant_messages;
CREATE POLICY assistant_messages_select ON assistant_messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM assistant_conversations c
    WHERE c.id = assistant_messages.conversation_id
      AND c.user_id = auth.uid()
      AND is_account_member(c.account_id)
  ));

DROP POLICY IF EXISTS assistant_messages_insert ON assistant_messages;
CREATE POLICY assistant_messages_insert ON assistant_messages FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM assistant_conversations c
    WHERE c.id = assistant_messages.conversation_id
      AND c.account_id = assistant_messages.account_id
      AND c.user_id = auth.uid()
      AND is_account_member(c.account_id)
  ));

-- ------------------------------------------------------------
-- 3 (before 2, which points at it). Routines
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assistant_routines (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Whose routine: it runs with this person's role, and its report and
  -- proposals go to them.
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  instruction     TEXT NOT NULL CHECK (char_length(instruction) BETWEEN 1 AND 2000),
  -- ISO weekdays, 1 = Monday … 7 = Sunday.
  weekdays        SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}',
  run_time        TEXT NOT NULL CHECK (run_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone        TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  next_run_at     TIMESTAMPTZ,
  last_run_at     TIMESTAMPTZ,
  -- Where its reports are written (one conversation per routine).
  conversation_id UUID REFERENCES assistant_conversations(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistant_routines_due
  ON assistant_routines(next_run_at) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_assistant_routines_account
  ON assistant_routines(account_id, user_id);

ALTER TABLE assistant_routines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assistant_routines_select ON assistant_routines;
CREATE POLICY assistant_routines_select ON assistant_routines FOR SELECT
  USING (
    (user_id = auth.uid() AND is_account_member(account_id))
    OR is_account_member(account_id, 'admin')
  );

CREATE TABLE IF NOT EXISTS assistant_routine_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  routine_id      UUID NOT NULL REFERENCES assistant_routines(id) ON DELETE CASCADE,
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES assistant_conversations(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  steps           INTEGER NOT NULL DEFAULT 0,
  summary         TEXT,
  error           TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_assistant_routine_runs_routine
  ON assistant_routine_runs(routine_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_routine_runs_running
  ON assistant_routine_runs(started_at) WHERE status = 'running';

ALTER TABLE assistant_routine_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assistant_routine_runs_select ON assistant_routine_runs;
CREATE POLICY assistant_routine_runs_select ON assistant_routine_runs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM assistant_routines r
    WHERE r.id = assistant_routine_runs.routine_id
      AND (
        (r.user_id = auth.uid() AND is_account_member(r.account_id))
        OR is_account_member(r.account_id, 'admin')
      )
  ));

-- ------------------------------------------------------------
-- 2. Actions: what the bot proposed, and what became of it
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assistant_actions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id  UUID REFERENCES assistant_conversations(id) ON DELETE SET NULL,
  -- The person the card is for (and who decides it).
  user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  routine_id       UUID REFERENCES assistant_routines(id) ON DELETE SET NULL,
  tool             TEXT NOT NULL,
  tool_call_id     TEXT,
  -- The exact input executed on confirm.
  input            JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The card, as the server built it from `input` (title, lines, warnings).
  preview          JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk             TEXT NOT NULL CHECK (risk IN ('pequena', 'maior', 'cliente')),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled', 'expired', 'undone')),
  result           JSONB,
  -- How to put it back, when it can be put back.
  undo             JSONB,
  error            TEXT,
  -- Ran without a card because the CRM allows small changes unasked.
  auto             BOOLEAN NOT NULL DEFAULT FALSE,
  via_agency       BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at       TIMESTAMPTZ,
  decided_at       TIMESTAMPTZ,
  executed_at      TIMESTAMPTZ,
  undone_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistant_actions_conversation
  ON assistant_actions(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_assistant_actions_account
  ON assistant_actions(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_actions_pending
  ON assistant_actions(account_id, user_id) WHERE status = 'pending';

ALTER TABLE assistant_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assistant_actions_select ON assistant_actions;
CREATE POLICY assistant_actions_select ON assistant_actions FOR SELECT
  USING (
    (user_id = auth.uid() AND is_account_member(account_id))
    OR is_account_member(account_id, 'admin')
  );

-- ------------------------------------------------------------
-- 4. Memory: what the team taught the bot about this CRM
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assistant_memory (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  content     TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistant_memory_account
  ON assistant_memory(account_id, created_at);

ALTER TABLE assistant_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assistant_memory_select ON assistant_memory;
CREATE POLICY assistant_memory_select ON assistant_memory FOR SELECT
  USING (is_account_member(account_id));

-- ------------------------------------------------------------
-- The CRM's switches for the assistant
-- ------------------------------------------------------------
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS assistant_enabled BOOLEAN NOT NULL DEFAULT TRUE;
-- NULL → a stronger model of the same provider than auto-reply's
-- (src/lib/assistente/model.ts).
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS assistant_model TEXT;
-- Small, reversible changes (a note, a tag on one contact) run without
-- a card, with Undo. Off by default.
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS assistant_small_changes BOOLEAN NOT NULL DEFAULT FALSE;

-- ------------------------------------------------------------
-- ai_usage_log.mode gains 'assistant' (keeping whatever is there)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_name  TEXT;
  v_def   TEXT;
  v_modes TEXT[] := ARRAY[]::TEXT[];
BEGIN
  FOR v_name, v_def IN
    SELECT conname, pg_get_constraintdef(oid)
    FROM pg_constraint
    WHERE conrelid = 'public.ai_usage_log'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%auto_reply%'
  LOOP
    v_modes := v_modes || ARRAY(
      SELECT m[1] FROM regexp_matches(v_def, '''([a-z_]+)''', 'g') AS m
    );
    EXECUTE format('ALTER TABLE public.ai_usage_log DROP CONSTRAINT %I', v_name);
  END LOOP;

  v_modes := v_modes || ARRAY['auto_reply', 'draft', 'assistant'];

  EXECUTE format(
    'ALTER TABLE public.ai_usage_log ADD CONSTRAINT ai_usage_log_mode_check CHECK (mode IN (%s))',
    (SELECT string_agg(quote_literal(t), ', ' ORDER BY t)
     FROM (SELECT DISTINCT unnest(v_modes) AS t) AS distinct_modes)
  );
END $$;

-- ------------------------------------------------------------
-- notifications.type gains 'assistente' (a routine's report or a
-- change waiting for an OK), keeping every existing type.
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

  v_types := v_types || ARRAY['conversation_assigned', 'assistente'];

  EXECUTE format(
    'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (%s))',
    (SELECT string_agg(quote_literal(t), ', ' ORDER BY t)
     FROM (SELECT DISTINCT unnest(v_types) AS t) AS distinct_types)
  );
END $$;
