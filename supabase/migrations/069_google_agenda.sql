-- ============================================================
-- 069_google_agenda.sql — an agenda of the CRM writes its
-- appointments into a Google Agenda (Fase G1 of
-- docs/plano-google-agenda.md)
--
-- A professional connects their Google account once; each agenda of
-- the CRM can then be pointed at one of that account's calendars.
-- From then on every appointment and block booked on the agenda — by
-- the screen, an AI agent, the public link or an approval — is
-- created, moved and deleted in Google too. Reading what is busy in
-- Google back into the CRM is Fase G2, not this migration (the column
-- that will say which Google calendars count as busy is created here
-- so the agenda form has one place to keep it).
--
--   google_connections         one Google account connected to a CRM:
--                              who it is (e-mail), what it allowed,
--                              whether it still works. The whole team
--                              sees it; only the server writes it.
--   google_connection_secrets  that account's refresh token (and the
--                              last access token), encrypted by the app
--                              with ENCRYPTION_KEY. Server only: no
--                              policy, no grant.
--   google_oauth_requests      a "Conectar com o Google" in flight: a
--                              single-use code, good for 15 minutes,
--                              that ties Google's answer to the CRM,
--                              agenda and person that asked. Server only.
--   google_event_deletions     events the CRM must remove from Google
--                              because their row is gone (deleted, or
--                              its agenda was). Server only.
--   calendars.google_*         which connection and which Google
--                              calendar an agenda writes to.
--   calendar_events.google_*   where the event is in Google and how its
--                              last send went.
--   claim_google_event_sync()  hands the sender the events to (re)send,
--                              each to one run at a time.
--   finish_google_event_sync() writes the result back without undoing
--                              an edit made while the send was running.
--   google_mark_for_sync()     queues an agenda's (or a connection's)
--                              events again: on connecting, reconnecting
--                              or pointing an agenda somewhere else.
--
-- Why a trigger marks events, instead of the app: the screen writes
-- calendar_events straight through RLS, the AI agents and the public
-- link through the service role, approvals through the operator's
-- session. Marking in the database is the only place none of them can
-- skip. The send itself runs in the app (it needs the Google token):
-- right after a booking, and from /api/automations/cron as the safety
-- net — the same split as the agenda's WhatsApp messages (067).
--
-- Safe to apply before or after the code: before, the app does not
-- offer the Google card and nothing is marked; after, until it runs,
-- the Agenda keeps working exactly as with 067.
--
-- Idempotent — safe to run multiple times.
-- ============================================================


-- ============================================================
-- GOOGLE_CONNECTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS google_connections (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Google's stable id for the account ("sub"); the e-mail can change.
  google_sub    TEXT NOT NULL,
  email         TEXT NOT NULL,
  -- What the person actually allowed: Google lets them untick a box.
  scopes        TEXT[] NOT NULL DEFAULT '{}',
  -- 'needs_reconnect': Google refused the refresh token (password
  -- changed, access removed). Nothing is sent until they reconnect.
  status        TEXT NOT NULL DEFAULT 'connected'
                CHECK (status IN ('connected', 'needs_reconnect')),
  last_error    TEXT CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  connected_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Connecting the same Google account again refreshes this row.
  UNIQUE (account_id, google_sub)
);

CREATE INDEX IF NOT EXISTS idx_google_connections_account ON google_connections (account_id);

ALTER TABLE google_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS google_connections_select ON google_connections;
-- Read-only for the team; the server (service role) does every write,
-- after checking the person is an admin of the CRM.
CREATE POLICY google_connections_select ON google_connections FOR SELECT
  USING (is_account_member(account_id));


-- ============================================================
-- GOOGLE_CONNECTION_SECRETS — server only
-- ============================================================
CREATE TABLE IF NOT EXISTS google_connection_secrets (
  connection_id           UUID PRIMARY KEY REFERENCES google_connections(id) ON DELETE CASCADE,
  -- Both encrypted by the app (AES-256-GCM, ENCRYPTION_KEY).
  refresh_token           TEXT NOT NULL,
  access_token            TEXT,
  access_token_expires_at TIMESTAMPTZ,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE google_connection_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON google_connection_secrets FROM anon, authenticated;


-- ============================================================
-- GOOGLE_OAUTH_REQUESTS — server only
-- ============================================================
CREATE TABLE IF NOT EXISTS google_oauth_requests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Sent to Google as `state` and checked on the way back.
  state        TEXT NOT NULL UNIQUE CHECK (char_length(state) >= 32),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The agenda to point at the account; NULL just connects it.
  calendar_id  UUID REFERENCES calendars(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
  used_at      TIMESTAMPTZ
);

ALTER TABLE google_oauth_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON google_oauth_requests FROM anon, authenticated;


-- ============================================================
-- CALENDARS — where an agenda writes in Google
-- ============================================================
ALTER TABLE calendars
  ADD COLUMN IF NOT EXISTS google_connection_id UUID
    REFERENCES google_connections(id) ON DELETE SET NULL,
  -- 'primary' or a calendar id from the account's calendar list.
  ADD COLUMN IF NOT EXISTS google_calendar_id TEXT
    CHECK (google_calendar_id IS NULL OR char_length(google_calendar_id) <= 1024),
  -- Shown on the agenda form; refreshed whenever it is picked.
  ADD COLUMN IF NOT EXISTS google_calendar_name TEXT
    CHECK (google_calendar_name IS NULL OR char_length(google_calendar_name) <= 200),
  -- Fase G2: the Google calendars whose busy times block this agenda.
  ADD COLUMN IF NOT EXISTS google_busy_calendar_ids TEXT[] NOT NULL DEFAULT '{}';

-- A connection belongs to one CRM; an agenda may only use its own
-- CRM's. Checked here because an admin can update calendars through
-- RLS. Also keeps the pair consistent: no connection, no calendar.
CREATE OR REPLACE FUNCTION public.calendars_google_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.google_connection_id IS NULL THEN
    NEW.google_calendar_id   := NULL;
    NEW.google_calendar_name := NULL;
    NEW.google_busy_calendar_ids := '{}';
  ELSIF NOT EXISTS (
    SELECT 1 FROM google_connections g
    WHERE g.id = NEW.google_connection_id AND g.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'Conta Google não pertence a este CRM' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calendars_google_guard ON calendars;
CREATE TRIGGER calendars_google_guard
  BEFORE INSERT OR UPDATE OF google_connection_id, google_calendar_id ON calendars
  FOR EACH ROW EXECUTE FUNCTION public.calendars_google_guard();


-- ============================================================
-- CALENDAR_EVENTS — where the event is in Google
-- ============================================================
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS google_event_id TEXT,
  -- Where google_event_id lives (calendar + the connection that wrote
  -- it): moving the event to another agenda deletes it there first.
  ADD COLUMN IF NOT EXISTS google_calendar_id TEXT,
  ADD COLUMN IF NOT EXISTS google_connection_id UUID
    REFERENCES google_connections(id) ON DELETE SET NULL,
  -- NULL: its agenda does not write to Google.
  ADD COLUMN IF NOT EXISTS google_sync_state TEXT
    CHECK (google_sync_state IS NULL OR google_sync_state IN ('pending', 'syncing', 'synced', 'error')),
  ADD COLUMN IF NOT EXISTS google_sync_error TEXT
    CHECK (google_sync_error IS NULL OR char_length(google_sync_error) <= 500),
  ADD COLUMN IF NOT EXISTS google_sync_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS google_sync_next_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS google_sync_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS google_synced_at TIMESTAMPTZ;

-- What the sender looks for.
CREATE INDEX IF NOT EXISTS idx_calendar_events_google_sync
  ON calendar_events (google_sync_state, google_sync_next_at)
  WHERE google_sync_state IN ('pending', 'syncing', 'error');

-- Something Google shows changed: queue the event. Bookkeeping writes
-- (the sender's own, the WhatsApp messages' stamps) change none of
-- these columns and are left alone. Runs for every writer.
CREATE OR REPLACE FUNCTION public.calendar_events_google_mark()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_linked BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (
       NEW.starts_at   IS DISTINCT FROM OLD.starts_at
    OR NEW.ends_at     IS DISTINCT FROM OLD.ends_at
    OR NEW.status      IS DISTINCT FROM OLD.status
    OR NEW.title       IS DISTINCT FROM OLD.title
    OR NEW.notes       IS DISTINCT FROM OLD.notes
    OR NEW.contact_id  IS DISTINCT FROM OLD.contact_id
    OR NEW.calendar_id IS DISTINCT FROM OLD.calendar_id
    OR NEW.kind        IS DISTINCT FROM OLD.kind
  ) THEN
    RETURN NEW;
  END IF;

  SELECT (c.google_connection_id IS NOT NULL AND c.google_calendar_id IS NOT NULL)
  INTO v_linked
  FROM calendars c
  WHERE c.id = NEW.calendar_id;

  -- Its agenda writes to Google, or it is still in Google from before
  -- (then it has to be moved or removed there).
  IF COALESCE(v_linked, FALSE) OR NEW.google_event_id IS NOT NULL THEN
    NEW.google_sync_state    := 'pending';
    NEW.google_sync_error    := NULL;
    NEW.google_sync_attempts := 0;
    NEW.google_sync_next_at  := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calendar_events_google_mark ON calendar_events;
CREATE TRIGGER calendar_events_google_mark
  BEFORE INSERT OR UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.calendar_events_google_mark();


-- ============================================================
-- GOOGLE_EVENT_DELETIONS — server only
--
-- A deleted row cannot be "marked": what Google must forget is copied
-- here instead, and the sender removes it. Never blocks the delete.
-- ============================================================
CREATE TABLE IF NOT EXISTS google_event_deletions (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id         UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id      UUID NOT NULL REFERENCES google_connections(id) ON DELETE CASCADE,
  google_calendar_id TEXT NOT NULL,
  google_event_id    TEXT NOT NULL,
  attempts           INT NOT NULL DEFAULT 0,
  last_error         TEXT,
  next_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_google_event_deletions_next ON google_event_deletions (next_at);

ALTER TABLE google_event_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON google_event_deletions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.calendar_events_google_forget()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO google_event_deletions (account_id, connection_id, google_calendar_id, google_event_id)
    SELECT OLD.account_id, OLD.google_connection_id, OLD.google_calendar_id, OLD.google_event_id
    WHERE EXISTS (SELECT 1 FROM google_connections g WHERE g.id = OLD.google_connection_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'calendar_events_google_forget: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.calendar_events_google_forget() OWNER TO postgres;

DROP TRIGGER IF EXISTS calendar_events_google_forget ON calendar_events;
CREATE TRIGGER calendar_events_google_forget
  AFTER DELETE ON calendar_events
  FOR EACH ROW
  WHEN (OLD.google_event_id IS NOT NULL
        AND OLD.google_connection_id IS NOT NULL
        AND OLD.google_calendar_id IS NOT NULL)
  EXECUTE FUNCTION public.calendar_events_google_forget();


-- ============================================================
-- google_mark_for_sync() — queue an agenda's events again
--
-- Upcoming events only: the past stays as it is in Google. Also the
-- ones still in Google from before, so a cancelled one or one whose
-- agenda stopped writing there is removed.
-- ============================================================
CREATE OR REPLACE FUNCTION public.google_mark_for_sync(
  p_calendar_id   UUID DEFAULT NULL,
  p_connection_id UUID DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  IF p_calendar_id IS NULL AND p_connection_id IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE calendar_events e
  SET google_sync_state    = 'pending',
      google_sync_error    = NULL,
      google_sync_attempts = 0,
      google_sync_next_at  = NULL
  FROM calendars c
  WHERE c.id = e.calendar_id
    AND (p_calendar_id IS NULL OR c.id = p_calendar_id)
    AND (p_connection_id IS NULL OR c.google_connection_id = p_connection_id
         OR e.google_connection_id = p_connection_id)
    AND e.ends_at > NOW()
    AND (e.status <> 'cancelled' OR e.google_event_id IS NOT NULL);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

ALTER FUNCTION public.google_mark_for_sync(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.google_mark_for_sync(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_mark_for_sync(UUID, UUID) TO service_role;

-- An agenda pointed at another Google calendar (or at none, or whose
-- connection was removed): its upcoming events follow.
CREATE OR REPLACE FUNCTION public.calendars_google_follow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM google_mark_for_sync(NEW.id, NULL);
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.calendars_google_follow() OWNER TO postgres;

DROP TRIGGER IF EXISTS calendars_google_follow ON calendars;
CREATE TRIGGER calendars_google_follow
  AFTER UPDATE OF google_connection_id, google_calendar_id ON calendars
  FOR EACH ROW
  WHEN (NEW.google_connection_id IS DISTINCT FROM OLD.google_connection_id
        OR NEW.google_calendar_id IS DISTINCT FROM OLD.google_calendar_id)
  EXECUTE FUNCTION public.calendars_google_follow();


-- ============================================================
-- claim_google_event_sync() — what to send to Google now
--
-- Picks the events waiting to be sent and stamps them 'syncing' in the
-- same statement, so two overlapping runs never send one twice. One
-- whose run died (still 'syncing' after 10 minutes) is picked again;
-- one that failed is retried after a pause, up to 5 times.
--
-- Comes with everything the sender needs: the event, its contact, and
-- where its agenda writes now (target_*) next to where the event is
-- in Google now (google_*).
--
-- p_event_id narrows the claim to one event: the screen, the AI agents
-- and the public link ask for theirs right after booking.
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_google_event_sync(
  p_limit    INT  DEFAULT 50,
  p_event_id UUID DEFAULT NULL
)
RETURNS TABLE (
  event_id                 UUID,
  claimed_at               TIMESTAMPTZ,
  account_id               UUID,
  calendar_id              UUID,
  kind                     TEXT,
  status                   TEXT,
  title                    TEXT,
  notes                    TEXT,
  starts_at                TIMESTAMPTZ,
  ends_at                  TIMESTAMPTZ,
  contact_id               UUID,
  contact_name             TEXT,
  contact_phone            TEXT,
  google_event_id          TEXT,
  google_calendar_id       TEXT,
  google_connection_id     UUID,
  google_sync_attempts     INT,
  calendar_name            TEXT,
  timezone                 TEXT,
  target_connection_id     UUID,
  target_calendar_id       TEXT,
  target_connection_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT e.id
    FROM calendar_events e
    WHERE (p_event_id IS NULL OR e.id = p_event_id)
      AND (
        e.google_sync_state = 'pending'
        OR (e.google_sync_state = 'syncing' AND e.google_sync_claimed_at < v_now - INTERVAL '10 minutes')
        OR (e.google_sync_state = 'error' AND e.google_sync_attempts < 5
            AND COALESCE(e.google_sync_next_at, v_now) <= v_now)
      )
    ORDER BY e.starts_at
    LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    FOR UPDATE OF e SKIP LOCKED
  ),
  claimed AS (
    UPDATE calendar_events e
    SET google_sync_state = 'syncing', google_sync_claimed_at = v_now
    FROM due
    WHERE e.id = due.id
    RETURNING e.id AS c_id, e.account_id AS c_account_id, e.calendar_id AS c_calendar_id,
              e.kind AS c_kind, e.status AS c_status, e.title AS c_title, e.notes AS c_notes,
              e.starts_at AS c_starts_at, e.ends_at AS c_ends_at, e.contact_id AS c_contact_id,
              e.google_event_id AS c_google_event_id, e.google_calendar_id AS c_google_calendar_id,
              e.google_connection_id AS c_google_connection_id,
              e.google_sync_attempts AS c_attempts
  )
  SELECT
    k.c_id, v_now, k.c_account_id, k.c_calendar_id, k.c_kind, k.c_status, k.c_title, k.c_notes,
    k.c_starts_at, k.c_ends_at, k.c_contact_id, ct.name, ct.phone,
    k.c_google_event_id, k.c_google_calendar_id, k.c_google_connection_id, k.c_attempts,
    c.name, c.timezone,
    c.google_connection_id, c.google_calendar_id, g.status
  FROM claimed k
  JOIN calendars c ON c.id = k.c_calendar_id
  LEFT JOIN contacts ct ON ct.id = k.c_contact_id
  LEFT JOIN google_connections g ON g.id = c.google_connection_id;
END;
$$;

ALTER FUNCTION public.claim_google_event_sync(INT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_google_event_sync(INT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_google_event_sync(INT, UUID) TO service_role;


-- ============================================================
-- finish_google_event_sync() — write a send's result back
--
-- Where the event now is in Google is always recorded (a created event
-- must never be forgotten, or the next run would create it twice). The
-- outcome only lands if the event was not edited during the send: an
-- edit marked it 'pending' again, and that has to stay so the new
-- version is sent too.
--
-- p_retry: the failure may pass (Google busy, network) — try again
-- after 2, 4, 8… minutes. False: do not retry on its own (no access,
-- Google refused the data); it waits for a reconnect or an edit.
-- ============================================================
CREATE OR REPLACE FUNCTION public.finish_google_event_sync(
  p_event_id           UUID,
  p_claimed_at         TIMESTAMPTZ,
  p_google_event_id    TEXT,
  p_google_calendar_id TEXT,
  p_connection_id      UUID,
  p_error              TEXT DEFAULT NULL,
  p_retry              BOOLEAN DEFAULT TRUE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_still_mine BOOLEAN;
  v_attempts   INT;
BEGIN
  SELECT (e.google_sync_state = 'syncing' AND e.google_sync_claimed_at = p_claimed_at),
         e.google_sync_attempts
  INTO v_still_mine, v_attempts
  FROM calendar_events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE calendar_events e
  SET google_event_id      = p_google_event_id,
      google_calendar_id   = CASE WHEN p_google_event_id IS NULL THEN NULL ELSE p_google_calendar_id END,
      google_connection_id = CASE WHEN p_google_event_id IS NULL THEN NULL ELSE p_connection_id END
  WHERE e.id = p_event_id;

  IF NOT COALESCE(v_still_mine, FALSE) THEN
    RETURN;
  END IF;

  IF p_error IS NULL THEN
    UPDATE calendar_events e
    SET google_sync_state    = CASE WHEN p_google_event_id IS NULL THEN NULL ELSE 'synced' END,
        google_sync_error    = NULL,
        google_sync_attempts = 0,
        google_sync_next_at  = NULL,
        google_synced_at     = NOW()
    WHERE e.id = p_event_id;
  ELSE
    UPDATE calendar_events e
    SET google_sync_state    = 'error',
        google_sync_error    = left(p_error, 500),
        google_sync_attempts = CASE WHEN p_retry THEN v_attempts + 1 ELSE 99 END,
        google_sync_next_at  = CASE
          WHEN p_retry THEN NOW() + make_interval(mins => (2 ^ LEAST(v_attempts + 1, 6))::INT)
          ELSE NULL
        END
    WHERE e.id = p_event_id;
  END IF;
END;
$$;

ALTER FUNCTION public.finish_google_event_sync(UUID, TIMESTAMPTZ, TEXT, TEXT, UUID, TEXT, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finish_google_event_sync(UUID, TIMESTAMPTZ, TEXT, TEXT, UUID, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_google_event_sync(UUID, TIMESTAMPTZ, TEXT, TEXT, UUID, TEXT, BOOLEAN)
  TO service_role;
