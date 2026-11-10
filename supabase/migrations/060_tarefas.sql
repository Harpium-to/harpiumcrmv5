-- ============================================================
-- 060_tarefas.sql — tasks and reminders for people, and the extension
-- taking over a conversation (Fase 3B of docs/plano-extensao-chrome.md)
--
-- Until now the only "tasks" in the CRM were the AI agents' own work
-- queue (agent_tasks, 045). A person had nowhere to write "ligar na
-- quinta" next to a contact, and nothing reminded them.
--
--   contact_tasks            a to-do about a contact: title, optional
--                            due date, done or not, who it is for
--   notifications.type       gains 'task_due'
--   emit_task_reminders()    turns tasks that just came due into a
--                            notification for whoever they are for —
--                            once per task (and again if rescheduled).
--                            Called by the scheduler that already runs
--                            the automations (/api/automations/cron).
--   extension_key_scopes()   gains tasks:read, tasks:write,
--                            conversations:read and conversations:write;
--                            active extension keys gain them too
--
-- Everyone on the team sees a contact's tasks; agents and above write
-- them — the same rule as contact notes (017).
--
-- Safe to apply before or after the code: before, nothing uses it;
-- after, until it runs, the tasks screens say they are unavailable.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_tasks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  title       TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  -- When it should be done. NULL: no date, so no reminder either.
  due_at      TIMESTAMPTZ,
  -- NULL while open.
  done_at     TIMESTAMPTZ,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Who it is for: the person reminded when it comes due.
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- When the reminder went out; NULL means "not yet".
  reminded_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_tasks_contact
  ON contact_tasks (account_id, contact_id);

-- "My open tasks", soonest first.
CREATE INDEX IF NOT EXISTS idx_contact_tasks_assignee_open
  ON contact_tasks (assigned_to, due_at)
  WHERE done_at IS NULL;

-- What emit_task_reminders() scans.
CREATE INDEX IF NOT EXISTS idx_contact_tasks_reminder_due
  ON contact_tasks (due_at)
  WHERE done_at IS NULL AND reminded_at IS NULL AND due_at IS NOT NULL;

ALTER TABLE contact_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_tasks_select ON contact_tasks;
DROP POLICY IF EXISTS contact_tasks_insert ON contact_tasks;
DROP POLICY IF EXISTS contact_tasks_update ON contact_tasks;
DROP POLICY IF EXISTS contact_tasks_delete ON contact_tasks;

CREATE POLICY contact_tasks_select ON contact_tasks FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY contact_tasks_insert ON contact_tasks FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY contact_tasks_update ON contact_tasks FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY contact_tasks_delete ON contact_tasks FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- A task moved to another date is a new appointment: it reminds again.
-- Kept in the database so every way of editing a task gets it right.
CREATE OR REPLACE FUNCTION public.contact_tasks_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  IF NEW.due_at IS DISTINCT FROM OLD.due_at THEN
    NEW.reminded_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contact_tasks_touch ON contact_tasks;
CREATE TRIGGER contact_tasks_touch
  BEFORE UPDATE ON contact_tasks
  FOR EACH ROW EXECUTE FUNCTION public.contact_tasks_touch();

-- ------------------------------------------------------------
-- notifications.type gains 'task_due'
--
-- The allowed list is rebuilt from whatever the constraint holds today
-- plus the new value, instead of being written out again here: another
-- migration may have added a type since 051, and restating the list
-- would silently drop it.
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

  v_types := v_types || ARRAY['conversation_assigned', 'task_due'];

  EXECUTE format(
    'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (%s))',
    (SELECT string_agg(quote_literal(t), ', ' ORDER BY t)
     FROM (SELECT DISTINCT unnest(v_types) AS t) AS distinct_types)
  );
END $$;

-- ------------------------------------------------------------
-- Reminders
-- ------------------------------------------------------------

-- One notification per task that has come due, to the person it is for
-- — if they are still on that CRM's team. The task is stamped in the
-- same statement that picks it, so two overlapping scheduler runs
-- cannot remind twice. Returns how many notifications were written.
CREATE OR REPLACE FUNCTION public.emit_task_reminders(p_limit INT DEFAULT 200)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  WITH due AS (
    SELECT t.id
    FROM contact_tasks t
    WHERE t.done_at IS NULL
      AND t.reminded_at IS NULL
      AND t.due_at IS NOT NULL
      AND t.due_at <= NOW()
    ORDER BY t.due_at
    LIMIT GREATEST(COALESCE(p_limit, 200), 1)
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE contact_tasks t
    SET reminded_at = NOW()
    FROM due
    WHERE t.id = due.id
    RETURNING t.account_id, t.contact_id, t.assigned_to, t.title
  ),
  sent AS (
    INSERT INTO notifications (account_id, user_id, type, contact_id, title, body)
    SELECT
      c.account_id,
      c.assigned_to,
      'task_due',
      c.contact_id,
      'Tarefa: ' || c.title,
      (SELECT COALESCE(NULLIF(ct.name, ''), ct.phone) FROM contacts ct WHERE ct.id = c.contact_id)
    FROM claimed c
    WHERE c.assigned_to IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM account_members m
        WHERE m.account_id = c.account_id AND m.user_id = c.assigned_to
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM sent;
  RETURN v_count;
END;
$$;

ALTER FUNCTION public.emit_task_reminders(INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.emit_task_reminders(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emit_task_reminders(INT) TO service_role;

-- ------------------------------------------------------------
-- The extension's keys
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.extension_key_scopes()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'contacts:read', 'contacts:write',
    'deals:read', 'deals:write',
    'quick_replies:read',
    'tasks:read', 'tasks:write',
    'conversations:read', 'conversations:write'
  ]::text[];
$$;

-- Keys minted before this migration get what they are missing, after
-- what they already have. Only the personal extension keys: an
-- account-level API key keeps exactly the scopes its admin chose.
UPDATE api_keys k
SET scopes = k.scopes || ARRAY(
  SELECT s.scope
  FROM unnest(extension_key_scopes()) WITH ORDINALITY AS s(scope, position)
  WHERE NOT (s.scope = ANY (k.scopes))
  ORDER BY s.position
)
WHERE k.kind = 'extension'
  AND k.revoked_at IS NULL
  AND NOT (k.scopes @> extension_key_scopes());
