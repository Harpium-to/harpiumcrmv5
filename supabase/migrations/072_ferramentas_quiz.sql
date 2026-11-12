-- ============================================================
-- 072_ferramentas_quiz.sql — Ferramentas › Quiz e formulários
-- (docs/plano-ferramentas-quiz.md)
--
--   quizzes              one quiz or form per row. `draft` is what the
--                        builder edits; `published` is the copy the
--                        public link serves, replaced only on Publicar.
--                        `slug` is the public address (/q/<slug>) and is
--                        unique across every CRM.
--   quiz_sessions        one row per visitor, rewritten at every screen:
--                        the screens seen, the answers so far and, at
--                        the end, the result and the lead it became.
--                        This is what the report reads — including the
--                        people who stopped halfway, and where.
--   quiz_session_totals  visits, starts, completions and leads per quiz
--                        (a security_invoker view: the caller's own RLS
--                        applies), for the list of quizzes.
--   quiz_secrets         the Conversions API token of a quiz, encrypted
--                        by the app. Server only.
--   quiz_templates       the agency's own quiz models, offered to every
--                        CRM next to the built-in ones.
--
-- Members read their CRM's quizzes and sessions; every write goes
-- through the service role in the API routes, after an admin check
-- (same model as lead_ingest_tokens in 068). The public page never
-- touches these tables directly: /api/public/quiz/<slug> does, with the
-- service role, after validating what the browser sent.
--
-- Safe to apply before or after the code: while these tables are
-- absent the screens say the migration is pending and nothing breaks.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- QUIZZES
-- ============================================================
CREATE TABLE IF NOT EXISTS quizzes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  -- The public address: lowercase letters, digits and hyphens.
  slug         TEXT NOT NULL UNIQUE
               CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'published', 'paused')),
  -- The definition being edited (src/lib/quiz/types.ts).
  draft        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The definition the public link serves. NULL until first published.
  published    JSONB,
  published_at TIMESTAMPTZ,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quizzes_account
  ON quizzes (account_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON quizzes;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON quizzes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quizzes_select ON quizzes;
CREATE POLICY quizzes_select ON quizzes FOR SELECT
  USING (is_account_member(account_id));

-- ============================================================
-- QUIZ_SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  quiz_id         UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  -- The browser's own id for this visit (sessionStorage).
  sid             TEXT NOT NULL CHECK (char_length(sid) BETWEEN 8 AND 64),
  -- The browser numbers its updates; an older one arriving late is ignored.
  seq             INTEGER NOT NULL DEFAULT 0,
  -- Screens seen, by id ('intro', the step ids, 'result'). Never shrinks.
  steps           TEXT[] NOT NULL DEFAULT '{}',
  last_step       TEXT,
  -- { <step or field id>: "<option id>" | ["<option id>", …] | "<text>" }
  answers         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- name, phone, email, company, city, instagram — read from the answers
  -- by the server, so the list of people survives a later edit of the quiz.
  contact         JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_id       TEXT,
  route           TEXT CHECK (route IN ('A', 'B', 'C')),
  tags            TEXT[] NOT NULL DEFAULT '{}',
  utms            JSONB NOT NULL DEFAULT '{}'::jsonb,
  device          TEXT CHECK (device IN ('mobile', 'desktop')),
  -- The Pixel's event id, repeated to the Conversions API and the CRM.
  event_id        TEXT,
  -- Browser details the Conversions API asks for (fbp, fbc, user agent).
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  -- Clicks on the result screen's button.
  cta_clicks      INTEGER NOT NULL DEFAULT 0,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  -- 'ok' | 'parcial' | 'sem_contato' | 'erro'
  lead_status     TEXT,
  -- When a visit that stopped halfway was sent as a partial lead.
  partial_sent_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (quiz_id, sid)
);

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_quiz
  ON quiz_sessions (quiz_id, created_at DESC);

-- The partial-lead sweep: visits that stopped and were not sent yet.
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_open
  ON quiz_sessions (updated_at)
  WHERE completed_at IS NULL AND partial_sent_at IS NULL;

ALTER TABLE quiz_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quiz_sessions_select ON quiz_sessions;
CREATE POLICY quiz_sessions_select ON quiz_sessions FOR SELECT
  USING (is_account_member(account_id));

-- ============================================================
-- QUIZ_SESSION_TOTALS — the numbers on the list of quizzes
-- ============================================================
CREATE OR REPLACE VIEW quiz_session_totals
WITH (security_invoker = true) AS
SELECT
  quiz_id,
  account_id,
  COUNT(*)::INTEGER             AS visits,
  COUNT(started_at)::INTEGER    AS started,
  COUNT(completed_at)::INTEGER  AS completed,
  COUNT(lead_id)::INTEGER       AS leads
FROM quiz_sessions
GROUP BY quiz_id, account_id;

-- ============================================================
-- QUIZ_SECRETS — server only
-- ============================================================
CREATE TABLE IF NOT EXISTS quiz_secrets (
  quiz_id    UUID PRIMARY KEY REFERENCES quizzes(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Meta Conversions API access token, encrypted by the app.
  capi_token TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE quiz_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON quiz_secrets FROM anon, authenticated;

-- ============================================================
-- QUIZ_TEMPLATES — the agency's quiz models
-- ============================================================
CREATE TABLE IF NOT EXISTS quiz_templates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description TEXT,
  definition  JSONB NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at ON quiz_templates;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON quiz_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE quiz_templates ENABLE ROW LEVEL SECURITY;

-- The agency reads them here; a CRM gets the active ones through the
-- API (service role), since a model carries no one's data.
DROP POLICY IF EXISTS quiz_templates_select ON quiz_templates;
CREATE POLICY quiz_templates_select ON quiz_templates FOR SELECT
  USING (is_agencia());
