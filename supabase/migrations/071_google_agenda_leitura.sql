-- ============================================================
-- 071_google_agenda_leitura.sql — what is in the professional's Google
-- Agenda shows in the CRM and blocks those times (Fase G2), plus the
-- finishing touches of Fase G3 (docs/plano-google-agenda.md).
--
-- G2 — Google → CRM
--   calendars.google_show_busy   "Mostrar os compromissos do Google
--                                nesta agenda": on, the Google
--                                calendars the agenda reads
--                                (google_busy_calendar_ids, 069) show as
--                                "Ocupado (Google)" and are never
--                                offered by the AI agents or the public
--                                link. On by default.
--   google_busy                  the busy times read from Google: start
--                                and end only — never the title,
--                                description, place or guests (decision
--                                3 of the plan). The whole team reads
--                                them; only the server writes.
--   google_calendar_reads        when each Google calendar was last read
--                                (server only), so the reads are spaced.
--   calendar_google_busy         the busy times per agenda of the CRM, as
--                                the screen and the server ask for them
--                                (a security_invoker view: the caller's
--                                own RLS applies).
--   replace_google_busy()        swaps a calendar's busy times for a
--                                fresh read, in one transaction.
--   note_google_remote_changes() an appointment the CRM put in Google and
--                                someone moved or deleted there: the CRM
--                                says so on the appointment and in the
--                                bell, and changes nothing on its own
--                                (decision 4).
--
-- G3
--   google_connection_dropped()  Google refused the stored access: the
--                                connection is marked and the CRM's
--                                admins hear about it in the bell.
--   google_connect_links         a link an admin sends to a professional
--                                who is not on the CRM: opened, it goes
--                                straight to Google and connects that
--                                agenda. Seven days, server only.
--   notifications.type           gains 'agenda_google'.
--
-- Safe to apply before or after the code: before, the CRM keeps the
-- 069 behaviour (CRM → Google only); after, until it runs, the screen
-- simply shows no Google busy times.
--
-- Idempotent — safe to run multiple times.
-- ============================================================


-- ============================================================
-- CALENDARS — show (and block) what is in Google
-- ============================================================
ALTER TABLE calendars
  ADD COLUMN IF NOT EXISTS google_show_busy BOOLEAN NOT NULL DEFAULT TRUE;


-- ============================================================
-- CALENDAR_EVENTS — "someone changed this in Google"
-- ============================================================
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS google_remote_notice TEXT
    CHECK (google_remote_notice IS NULL OR char_length(google_remote_notice) <= 300),
  ADD COLUMN IF NOT EXISTS google_remote_notice_at TIMESTAMPTZ;

-- 069's marker, unchanged except that an edit made in the CRM also
-- clears the notice: it is about to overwrite what Google has.
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

  IF COALESCE(v_linked, FALSE) OR NEW.google_event_id IS NOT NULL THEN
    NEW.google_sync_state       := 'pending';
    NEW.google_sync_error       := NULL;
    NEW.google_sync_attempts    := 0;
    NEW.google_sync_next_at     := NULL;
    NEW.google_remote_notice    := NULL;
    NEW.google_remote_notice_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;


-- ============================================================
-- GOOGLE_BUSY — busy times read from Google
-- ============================================================
CREATE TABLE IF NOT EXISTS google_busy (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id         UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id      UUID NOT NULL REFERENCES google_connections(id) ON DELETE CASCADE,
  google_calendar_id TEXT NOT NULL,
  google_event_id    TEXT NOT NULL,
  starts_at          TIMESTAMPTZ NOT NULL,
  ends_at            TIMESTAMPTZ NOT NULL,
  all_day            BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (ends_at > starts_at),
  UNIQUE (connection_id, google_calendar_id, google_event_id)
);

CREATE INDEX IF NOT EXISTS idx_google_busy_calendar
  ON google_busy (connection_id, google_calendar_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_google_busy_account
  ON google_busy (account_id, starts_at);

ALTER TABLE google_busy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS google_busy_select ON google_busy;
CREATE POLICY google_busy_select ON google_busy FOR SELECT
  USING (is_account_member(account_id));


-- ============================================================
-- GOOGLE_CALENDAR_READS — server only
-- ============================================================
CREATE TABLE IF NOT EXISTS google_calendar_reads (
  connection_id      UUID NOT NULL REFERENCES google_connections(id) ON DELETE CASCADE,
  google_calendar_id TEXT NOT NULL,
  read_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error         TEXT,
  PRIMARY KEY (connection_id, google_calendar_id)
);

ALTER TABLE google_calendar_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON google_calendar_reads FROM anon, authenticated;


-- ============================================================
-- calendar_google_busy — busy times per agenda of the CRM
--
-- security_invoker: whoever reads it reads google_busy and calendars
-- under their own RLS — the team sees its own CRM, nobody else's.
-- An agenda reads the calendars it chose (google_busy_calendar_ids),
-- or the one it writes to when none was chosen.
-- ============================================================
CREATE OR REPLACE VIEW public.calendar_google_busy
WITH (security_invoker = true) AS
SELECT
  c.id         AS calendar_id,
  c.account_id AS account_id,
  b.starts_at,
  b.ends_at,
  b.all_day
FROM calendars c
JOIN google_busy b
  ON b.connection_id = c.google_connection_id
 AND b.google_calendar_id = ANY (
       CASE
         WHEN cardinality(c.google_busy_calendar_ids) > 0 THEN c.google_busy_calendar_ids
         ELSE ARRAY[c.google_calendar_id]
       END
     )
WHERE c.google_show_busy;

GRANT SELECT ON public.calendar_google_busy TO authenticated, service_role;


-- ============================================================
-- replace_google_busy() — a calendar's busy times, freshly read
--
-- p_rows: [{ "google_event_id": "…", "starts_at": "…", "ends_at": "…",
--            "all_day": false }, …]
-- ============================================================
CREATE OR REPLACE FUNCTION public.replace_google_busy(
  p_account_id    UUID,
  p_connection_id UUID,
  p_calendar_id   TEXT,
  p_rows          JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  -- The connection must be this CRM's.
  IF NOT EXISTS (
    SELECT 1 FROM google_connections g
    WHERE g.id = p_connection_id AND g.account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Conta Google não pertence a este CRM' USING ERRCODE = '23503';
  END IF;

  DELETE FROM google_busy
  WHERE connection_id = p_connection_id AND google_calendar_id = p_calendar_id;

  INSERT INTO google_busy (account_id, connection_id, google_calendar_id, google_event_id, starts_at, ends_at, all_day)
  SELECT DISTINCT ON (r.google_event_id)
    p_account_id, p_connection_id, p_calendar_id, r.google_event_id, r.starts_at, r.ends_at,
    COALESCE(r.all_day, FALSE)
  FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb))
       AS r(google_event_id TEXT, starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, all_day BOOLEAN)
  WHERE r.google_event_id IS NOT NULL AND r.ends_at > r.starts_at;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO google_calendar_reads (connection_id, google_calendar_id, read_at, last_error)
  VALUES (p_connection_id, p_calendar_id, NOW(), NULL)
  ON CONFLICT (connection_id, google_calendar_id)
  DO UPDATE SET read_at = NOW(), last_error = NULL;

  RETURN v_count;
END;
$$;

ALTER FUNCTION public.replace_google_busy(UUID, UUID, TEXT, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.replace_google_busy(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_google_busy(UUID, UUID, TEXT, JSONB) TO service_role;


-- ============================================================
-- notifications.type gains 'agenda_google' (rebuilt as in 067, so a
-- type another migration added is never dropped).
-- ============================================================
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

  v_types := v_types || ARRAY['conversation_assigned', 'agenda_google'];

  EXECUTE format(
    'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (%s))',
    (SELECT string_agg(quote_literal(t), ', ' ORDER BY t)
     FROM (SELECT DISTINCT unnest(v_types) AS t) AS distinct_types)
  );
END $$;


-- ============================================================
-- note_google_remote_changes() — appointments changed in Google
--
-- After a complete read of a Google calendar, the server hands over
-- the CRM's own events found there (p_own: [{ "google_event_id",
-- "starts_at", "ends_at" }]) and the window it read. Each CRM
-- appointment that the CRM put in that calendar, inside the window, is
-- compared:
--   gone from Google            → "Apagado no Google Agenda."
--   at another time in Google   → "Movido no Google Agenda para 14/11 às 15:00."
--   as the CRM has it           → the notice is cleared.
-- A new notice also reaches the bell of everyone who can book. The
-- appointment itself is never changed here (decision 4): a person
-- decides, and an edit in the CRM overwrites Google again.
-- ============================================================
CREATE OR REPLACE FUNCTION public.note_google_remote_changes(
  p_connection_id UUID,
  p_calendar_id   TEXT,
  p_own           JSONB,
  p_from          TIMESTAMPTZ,
  p_to            TIMESTAMPTZ
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event  RECORD;
  v_start  TIMESTAMPTZ;
  v_end    TIMESTAMPTZ;
  v_notice TEXT;
  v_new    INT := 0;
BEGIN
  FOR v_event IN
    SELECT e.id, e.account_id, e.contact_id, e.starts_at, e.ends_at, e.google_event_id,
           e.google_remote_notice, c.name AS calendar_name, c.timezone
    FROM calendar_events e
    JOIN calendars c ON c.id = e.calendar_id
    WHERE e.google_connection_id = p_connection_id
      AND e.google_calendar_id = p_calendar_id
      AND e.google_sync_state = 'synced'
      AND e.status <> 'cancelled'
      AND e.starts_at >= p_from
      AND e.starts_at < p_to
  LOOP
    SELECT (o ->> 'starts_at')::TIMESTAMPTZ, (o ->> 'ends_at')::TIMESTAMPTZ
    INTO v_start, v_end
    FROM jsonb_array_elements(COALESCE(p_own, '[]'::jsonb)) AS o
    WHERE o ->> 'google_event_id' = v_event.google_event_id
    LIMIT 1;

    IF NOT FOUND THEN
      v_notice := 'Apagado no Google Agenda.';
    ELSIF abs(extract(epoch FROM (v_start - v_event.starts_at))) > 60
       OR abs(extract(epoch FROM (v_end - v_event.ends_at))) > 60 THEN
      BEGIN
        v_notice := 'Movido no Google Agenda para '
          || to_char(v_start AT TIME ZONE v_event.timezone, 'DD/MM "às" HH24:MI') || '.';
      EXCEPTION WHEN OTHERS THEN
        v_notice := 'Movido no Google Agenda para outro horário.';
      END;
    ELSE
      v_notice := NULL;
    END IF;

    IF v_notice IS DISTINCT FROM v_event.google_remote_notice THEN
      UPDATE calendar_events
      SET google_remote_notice    = v_notice,
          google_remote_notice_at = CASE WHEN v_notice IS NULL THEN NULL ELSE NOW() END
      WHERE id = v_event.id;

      IF v_notice IS NOT NULL THEN
        v_new := v_new + 1;
        BEGIN
          INSERT INTO notifications (account_id, user_id, type, contact_id, title, body)
          SELECT
            v_event.account_id,
            m.user_id,
            'agenda_google',
            v_event.contact_id,
            'Agendamento mexido direto no Google Agenda',
            concat_ws(
              ' · ',
              (SELECT COALESCE(NULLIF(btrim(ct.name), ''), ct.phone) FROM contacts ct WHERE ct.id = v_event.contact_id),
              v_event.calendar_name,
              v_notice || ' Confira e ajuste no CRM.'
            )
          FROM account_members m
          WHERE m.account_id = v_event.account_id
            AND m.role IN ('owner', 'admin', 'agent');
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'note_google_remote_changes: %', SQLERRM;
        END;
      END IF;
    END IF;
  END LOOP;
  RETURN v_new;
END;
$$;

ALTER FUNCTION public.note_google_remote_changes(UUID, TEXT, JSONB, TIMESTAMPTZ, TIMESTAMPTZ) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.note_google_remote_changes(UUID, TEXT, JSONB, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.note_google_remote_changes(UUID, TEXT, JSONB, TIMESTAMPTZ, TIMESTAMPTZ)
  TO service_role;


-- ============================================================
-- google_connection_dropped() — Google refused the stored access
--
-- Marks the connection (once) and tells the CRM's owner and admins in
-- the bell. Returns whether it was news.
-- ============================================================
CREATE OR REPLACE FUNCTION public.google_connection_dropped(
  p_connection_id UUID,
  p_reason        TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_email   TEXT;
BEGIN
  UPDATE google_connections
  SET status = 'needs_reconnect', last_error = left(p_reason, 500), updated_at = NOW()
  WHERE id = p_connection_id AND status = 'connected'
  RETURNING account_id, email INTO v_account, v_email;

  IF v_account IS NULL THEN
    -- Already marked: keep the newest reason, no second notification.
    UPDATE google_connections
    SET last_error = left(p_reason, 500), updated_at = NOW()
    WHERE id = p_connection_id;
    RETURN FALSE;
  END IF;

  BEGIN
    INSERT INTO notifications (account_id, user_id, type, title, body)
    SELECT v_account, m.user_id, 'agenda_google',
           'Reconecte o Google Agenda',
           v_email || ': ' || left(p_reason, 300) || ' Edite a agenda na engrenagem e clique em Conectar de novo.'
    FROM account_members m
    WHERE m.account_id = v_account
      AND m.role IN ('owner', 'admin');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'google_connection_dropped: %', SQLERRM;
  END;
  RETURN TRUE;
END;
$$;

ALTER FUNCTION public.google_connection_dropped(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.google_connection_dropped(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_connection_dropped(UUID, TEXT) TO service_role;


-- ============================================================
-- GOOGLE_CONNECT_LINKS — "Enviar link para o profissional" (G3)
--
-- The professional need not be on the CRM: whoever opens the link
-- (while it is valid) connects their Google account to that agenda.
-- Treated like the agenda's other secret links: unguessable, and it
-- stops working once used, after 7 days, or with the agenda.
-- ============================================================
CREATE TABLE IF NOT EXISTS google_connect_links (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token        TEXT NOT NULL UNIQUE CHECK (char_length(token) >= 32),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  calendar_id  UUID NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  used_at      TIMESTAMPTZ
);

ALTER TABLE google_connect_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON google_connect_links FROM anon, authenticated;

-- A sign-in started from such a link remembers it, so a successful
-- connection uses the link up.
ALTER TABLE google_oauth_requests
  ADD COLUMN IF NOT EXISTS link_id UUID REFERENCES google_connect_links(id) ON DELETE SET NULL;
