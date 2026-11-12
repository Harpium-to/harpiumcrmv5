-- ============================================================
-- 067_agenda.sql — the CRM's own agenda (Fases 1 to 4: used by
-- people, from the Agenda screen, a contact's record and the inbox;
-- by the AI agents that answer customers; and by the customers
-- themselves, through a public booking link)
--
-- Until now "marcar um horário" lived outside the CRM: a task with a
-- date (060) reminds one person, but nothing answers "is Dr. João free
-- on Thursday at 14h?". This adds that — and tells the customer.
--
--   calendars                 one agenda per professional / room /
--                             resource of a CRM: name, colour, how
--                             long a slot is, which time zone its
--                             opening hours are written in
--   calendar_hours            when that agenda attends: weekday +
--                             from/until. Several rows per weekday,
--                             so a lunch break is two rows
--   calendar_events           what sits on the agenda: an appointment
--                             (usually with a contact) or a block
--                             (férias, almoço, feriado)
--   set_calendar_hours()      replaces an agenda's opening hours in
--                             one transaction
--   claim_calendar_notifications()
--                             hands the scheduler the confirmations
--                             and reminders that are due, each exactly
--                             once (Fase 2)
--
-- Messages to the customer are per agenda and off until an admin turns
-- them on: a confirmation when an appointment is booked or moved, and
-- a reminder some hours before it. Each is a text, or — on the
-- official API, where a text only goes inside the 24-hour window — an
-- approved template. They go out by the scheduler that already runs
-- the automations (/api/automations/cron), so they follow whoever
-- books: the screen today, the AI agents next.
--
-- Two bookings can never share a slot: the database refuses it
-- (exclusion constraint, SQLSTATE 23P01), so the rule holds for the
-- screen, the API and whatever books next (Fase 3: the AI agents).
-- A cancelled event frees its slot. A block occupies it like an
-- appointment does, so nobody books over someone's vacation.
--
-- An AI agent books through the same table (Fase 3). One that is not
-- allowed to book on its own (see lib/agents/autonomy.ts) writes the
-- appointment as 'pending': the slot is held, nobody is messaged, and
-- a person approves it (-> 'scheduled') or refuses it (-> 'cancelled')
-- from the agenda or from the agents' approvals queue — the two stay
-- in step through a trigger. An appointment a person approved is
-- always confirmed to the customer, whatever the agenda's switch says:
-- the agent told them the team would get back.
--
-- Fase 4 opens two doors per agenda, both shut until an admin opens
-- them, each behind its own unguessable token:
--   public link   /marcar/<public_token> — a customer picks a free slot
--                 and leaves a name and a WhatsApp number. Booked at
--                 once, or held as 'pending' if the agenda asks for a
--                 person's OK (public_auto_confirm = false).
--   feed          /api/agenda/feed/<feed_token> — the agenda as an
--                 iCalendar feed, to follow from Google, Apple or
--                 Outlook. Read-only.
-- A booking from the public link puts a notification in the bell of
-- everyone who can act on it (agents and above): one held for
-- approval would otherwise wait unseen on a day nobody has open.
-- The niche templates (053) can also carry agendas, created with the
-- rest of a template's content; the clinic one now does.
--
-- Opening hours are NOT enforced here. They drive "horários livres";
-- booking outside them stays possible on purpose (um encaixe).
--
-- The whole team sees the agenda; agents and above book; admins and
-- above create agendas and set their hours — the same split as
-- contacts (operational) versus settings (account-wide).
--
-- Safe to apply before or after the code: before, nothing uses it;
-- after, until it runs, the Agenda screen says it is unavailable.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- The exclusion constraint compares a UUID with `=` inside a GiST
-- index, which needs this extension. Shipped with Supabase.
CREATE EXTENSION IF NOT EXISTS btree_gist;


-- ============================================================
-- CALENDARS
-- ============================================================
CREATE TABLE IF NOT EXISTS calendars (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Whose agenda it is: "Dr. João", "Sala 2", "Avaliações".
  name         TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  color        TEXT NOT NULL DEFAULT '#3b82f6' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  -- Default length of an appointment, and the step of "horários livres".
  slot_minutes INT  NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 480),
  -- IANA zone the opening hours are written in.
  timezone     TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  -- An archived agenda keeps its history but takes no new bookings.
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,

  -- Messages to the customer, both off until an admin turns them on.
  -- *_text NULL means the app's default wording. *_template names an
  -- approved WhatsApp template (official API only); its body takes, in
  -- order: contact's first name, date, time, agenda name.
  confirm_enabled            BOOLEAN NOT NULL DEFAULT FALSE,
  confirm_text               TEXT CHECK (confirm_text IS NULL OR char_length(confirm_text) <= 1000),
  confirm_template           TEXT,
  confirm_template_language  TEXT,
  reminder_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  -- How long before the appointment the reminder goes.
  reminder_hours             INT NOT NULL DEFAULT 24 CHECK (reminder_hours BETWEEN 1 AND 168),
  reminder_text              TEXT CHECK (reminder_text IS NULL OR char_length(reminder_text) <= 1000),
  reminder_template          TEXT,
  reminder_template_language TEXT,

  -- The public booking link and the iCalendar feed. Tokens exist from
  -- the start (two random UUIDs, 244 bits) so turning a door on never
  -- needs a second write; the switch is what opens it.
  public_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  -- False: a booking from the link waits, as 'pending', for a person.
  public_auto_confirm BOOLEAN NOT NULL DEFAULT TRUE,
  public_token        TEXT NOT NULL UNIQUE
                      DEFAULT replace(uuid_generate_v4()::text || uuid_generate_v4()::text, '-', ''),
  feed_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  feed_token          TEXT NOT NULL UNIQUE
                      DEFAULT replace(uuid_generate_v4()::text || uuid_generate_v4()::text, '-', ''),

  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Target of the composite foreign keys below: an hour or an event
  -- can only point at an agenda of its own CRM.
  UNIQUE (id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_calendars_account ON calendars (account_id);

ALTER TABLE calendars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendars_select ON calendars;
DROP POLICY IF EXISTS calendars_insert ON calendars;
DROP POLICY IF EXISTS calendars_update ON calendars;
DROP POLICY IF EXISTS calendars_delete ON calendars;

CREATE POLICY calendars_select ON calendars FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY calendars_insert ON calendars FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY calendars_update ON calendars FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY calendars_delete ON calendars FOR DELETE
  USING (is_account_member(account_id, 'admin'));


-- ============================================================
-- CALENDAR_HOURS — opening hours
-- ============================================================
CREATE TABLE IF NOT EXISTS calendar_hours (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL,
  calendar_id UUID NOT NULL,
  -- ISO weekday, 1 = Monday … 7 = Sunday — same as agents.work_days.
  weekday     SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  -- Wall-clock times in the agenda's own time zone.
  starts      TIME NOT NULL,
  ends        TIME NOT NULL,
  CHECK (ends > starts),
  FOREIGN KEY (calendar_id, account_id)
    REFERENCES calendars (id, account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_calendar_hours_calendar
  ON calendar_hours (calendar_id, weekday);

ALTER TABLE calendar_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_hours_select ON calendar_hours;
DROP POLICY IF EXISTS calendar_hours_insert ON calendar_hours;
DROP POLICY IF EXISTS calendar_hours_update ON calendar_hours;
DROP POLICY IF EXISTS calendar_hours_delete ON calendar_hours;

CREATE POLICY calendar_hours_select ON calendar_hours FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY calendar_hours_insert ON calendar_hours FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY calendar_hours_update ON calendar_hours FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY calendar_hours_delete ON calendar_hours FOR DELETE
  USING (is_account_member(account_id, 'admin'));


-- ============================================================
-- CALENDAR_EVENTS — appointments and blocks
-- ============================================================
CREATE TABLE IF NOT EXISTS calendar_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL,
  calendar_id UUID NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'appointment'
              CHECK (kind IN ('appointment', 'block')),
  -- Who the appointment is with. Kept (as NULL) if the contact is
  -- deleted: the slot was still taken, and the title still says why.
  contact_id  UUID REFERENCES contacts(id) ON DELETE SET NULL,
  -- "Consulta", "Retorno"; for a block, the reason ("Férias").
  title       TEXT CHECK (title IS NULL OR char_length(title) <= 200),
  notes       TEXT CHECK (notes IS NULL OR char_length(notes) <= 2000),
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  -- 'pending': reserved by an AI agent, waiting for a person's OK.
  status      TEXT NOT NULL DEFAULT 'scheduled'
              CHECK (status IN ('pending', 'scheduled', 'confirmed', 'done', 'no_show', 'cancelled')),
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Who booked it: someone on the team, an AI agent, or the customer
  -- through the public link.
  source      TEXT NOT NULL DEFAULT 'team' CHECK (source IN ('team', 'ai', 'public')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Whether this appointment's customer is told about it. Unticked by
  -- whoever books when the person asked not to be messaged.
  notify              BOOLEAN NOT NULL DEFAULT TRUE,
  -- When the appointment got the time it has now: its creation, or the
  -- last time it was moved or un-cancelled. Maintained by the trigger.
  time_set_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- When the confirmation / reminder was handed to the sender (NULL:
  -- not yet), and why it did not go, if it did not.
  confirmation_at     TIMESTAMPTZ,
  confirmation_error  TEXT,
  reminder_at         TIMESTAMPTZ,
  reminder_error      TEXT,
  -- When a person approved what an AI agent reserved. Cleared if the
  -- appointment is later moved. Maintained by the trigger.
  approved_at         TIMESTAMPTZ,

  CHECK (ends_at > starts_at),
  -- A block is about the agenda, not about a person.
  CHECK (kind = 'appointment' OR contact_id IS NULL),
  FOREIGN KEY (calendar_id, account_id)
    REFERENCES calendars (id, account_id) ON DELETE CASCADE
);

-- One agenda, one thing at a time. [start, end) — an appointment that
-- ends at 10:00 does not collide with one that starts at 10:00.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'calendar_events_no_overlap'
      AND conrelid = 'public.calendar_events'::regclass
  ) THEN
    ALTER TABLE public.calendar_events
      ADD CONSTRAINT calendar_events_no_overlap
      EXCLUDE USING gist (
        calendar_id WITH =,
        tstzrange(starts_at, ends_at) WITH &&
      ) WHERE (status <> 'cancelled');
  END IF;
END $$;

-- What a day or week view reads.
CREATE INDEX IF NOT EXISTS idx_calendar_events_account_start
  ON calendar_events (account_id, starts_at);
-- A contact's appointments (their record, Fase 2).
CREATE INDEX IF NOT EXISTS idx_calendar_events_contact
  ON calendar_events (contact_id, starts_at)
  WHERE contact_id IS NOT NULL;

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_events_select ON calendar_events;
DROP POLICY IF EXISTS calendar_events_insert ON calendar_events;
DROP POLICY IF EXISTS calendar_events_update ON calendar_events;
DROP POLICY IF EXISTS calendar_events_delete ON calendar_events;

CREATE POLICY calendar_events_select ON calendar_events FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY calendar_events_insert ON calendar_events FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY calendar_events_update ON calendar_events FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY calendar_events_delete ON calendar_events FOR DELETE
  USING (is_account_member(account_id, 'agent'));


-- ============================================================
-- Triggers
-- ============================================================
CREATE OR REPLACE FUNCTION public.calendars_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calendars_touch ON calendars;
CREATE TRIGGER calendars_touch
  BEFORE UPDATE ON calendars
  FOR EACH ROW EXECUTE FUNCTION public.calendars_touch();

-- The composite foreign key keeps an event inside its agenda's CRM;
-- contacts has no (id, account_id) key to do the same, so the contact
-- is checked here. Runs for every writer, the service role included.
-- Also where a moved appointment becomes "new" again for its messages.
CREATE OR REPLACE FUNCTION public.calendar_events_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := NOW();
    -- Moved to another time, or brought back from cancelled: to the
    -- customer that is a new appointment, so it is confirmed and
    -- reminded again. Kept here so every way of editing gets it right.
    IF NEW.starts_at IS DISTINCT FROM OLD.starts_at
       OR (OLD.status = 'cancelled' AND NEW.status <> 'cancelled')
       OR (OLD.status = 'pending' AND NEW.status NOT IN ('pending', 'cancelled'))
    THEN
      NEW.time_set_at        := NOW();
      NEW.confirmation_at    := NULL;
      NEW.confirmation_error := NULL;
      NEW.reminder_at        := NULL;
      NEW.reminder_error     := NULL;
      -- Approved just now, or approved once and since moved.
      NEW.approved_at := CASE
        WHEN OLD.status = 'pending' AND NEW.status NOT IN ('pending', 'cancelled') THEN NOW()
        ELSE NULL
      END;
    END IF;
  END IF;
  IF NEW.contact_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.contact_id IS DISTINCT FROM OLD.contact_id)
     AND NOT EXISTS (
       SELECT 1 FROM contacts c
       WHERE c.id = NEW.contact_id AND c.account_id = NEW.account_id
     )
  THEN
    RAISE EXCEPTION 'Contato não pertence a este CRM' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calendar_events_guard ON calendar_events;
CREATE TRIGGER calendar_events_guard
  BEFORE INSERT OR UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.calendar_events_guard();


-- A reserved appointment that stops being 'pending' has been decided,
-- wherever the person did it. Its request in the agents' approvals
-- queue (045; `payload.event_id` points here) is answered to match, so
-- the queue never shows something the agenda already settled.
-- Deciding from the queue goes the other way: the app flips the
-- appointment, and by then the request is no longer pending, so this
-- finds nothing to do.
CREATE OR REPLACE FUNCTION public.calendar_events_settle_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE agent_approvals a
  SET status      = CASE WHEN NEW.status = 'cancelled' THEN 'rejected' ELSE 'approved' END,
      decided_by  = auth.uid(),
      decided_at  = NOW(),
      executed_at = NOW()
  WHERE a.account_id = NEW.account_id
    AND a.kind = 'schedule_meeting'
    AND a.status = 'pending'
    AND a.payload ->> 'event_id' = NEW.id::TEXT;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.calendar_events_settle_approval() OWNER TO postgres;

DROP TRIGGER IF EXISTS calendar_events_settle_approval ON calendar_events;
CREATE TRIGGER calendar_events_settle_approval
  AFTER UPDATE OF status ON calendar_events
  FOR EACH ROW
  WHEN (OLD.status = 'pending' AND NEW.status <> 'pending')
  EXECUTE FUNCTION public.calendar_events_settle_approval();


-- ============================================================
-- set_calendar_hours() — replace an agenda's opening hours
--
-- The screen edits the week as a whole, so it is saved as a whole:
-- delete + insert in one transaction, never half a week. Runs as the
-- caller, so the calendar_hours policies decide who may (admins and
-- above); anyone else gets 42501.
--
-- p_hours: [{ "weekday": 1, "starts": "08:00", "ends": "12:00" }, …]
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_calendar_hours(
  p_calendar_id UUID,
  p_hours       JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_account UUID;
BEGIN
  -- Under RLS this only finds an agenda of the caller's active CRM.
  SELECT account_id INTO v_account FROM calendars WHERE id = p_calendar_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Agenda não encontrada' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_hours, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Horários inválidos' USING ERRCODE = '22023';
  END IF;

  DELETE FROM calendar_hours WHERE calendar_id = p_calendar_id;

  INSERT INTO calendar_hours (account_id, calendar_id, weekday, starts, ends)
  SELECT
    v_account,
    p_calendar_id,
    (h ->> 'weekday')::SMALLINT,
    (h ->> 'starts')::TIME,
    (h ->> 'ends')::TIME
  FROM jsonb_array_elements(COALESCE(p_hours, '[]'::jsonb)) AS h;
END;
$$;

ALTER FUNCTION public.set_calendar_hours(UUID, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_calendar_hours(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_calendar_hours(UUID, JSONB) TO authenticated, service_role;


-- ============================================================
-- claim_calendar_notifications() — what to tell customers now
--
-- Returns the confirmations and reminders that are due and stamps
-- them in the same statement that picks them, so two overlapping
-- scheduler runs never send one twice. The sender writes *_error back
-- if a message does not go.
--
-- Both only for an appointment with a contact, still on (not
-- cancelled, realised or missed), in the future, whose `notify` is
-- ticked, on an agenda with that message turned on.
--
--   confirmation  the agenda confirms, or a person just approved what
--                 an AI agent had reserved (then it always goes); and
--                 the time was set in the last 30 minutes. The limit
--                 is what keeps turning the option on from messaging
--                 everyone already on the agenda, and a scheduler that
--                 was down from confirming yesterday's bookings today.
--   reminder      `reminder_hours` or less to go — and the time was
--                 set before that window opened. Booked inside it, the
--                 confirmation just said the same thing.
--
-- p_event_id narrows the claim to one appointment: the screen asks for
-- its confirmation right after saving instead of waiting for the next
-- scheduler run.
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_calendar_notifications(
  p_limit    INT  DEFAULT 50,
  p_event_id UUID DEFAULT NULL
)
RETURNS TABLE (
  event_id          UUID,
  notification      TEXT,
  account_id        UUID,
  contact_id        UUID,
  starts_at         TIMESTAMPTZ,
  calendar_name     TEXT,
  timezone          TEXT,
  message_text      TEXT,
  template_name     TEXT,
  template_language TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT e.id
    FROM calendar_events e
    JOIN calendars c ON c.id = e.calendar_id
    WHERE (c.confirm_enabled OR e.approved_at IS NOT NULL)
      AND e.confirmation_at IS NULL
      AND e.kind = 'appointment'
      AND e.contact_id IS NOT NULL
      AND e.notify
      AND e.status IN ('scheduled', 'confirmed')
      AND e.starts_at > NOW()
      AND e.time_set_at > NOW() - INTERVAL '30 minutes'
      AND (p_event_id IS NULL OR e.id = p_event_id)
    ORDER BY e.time_set_at
    LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    FOR UPDATE OF e SKIP LOCKED
  ),
  claimed AS (
    UPDATE calendar_events e
    SET confirmation_at = NOW(), confirmation_error = NULL
    FROM due
    WHERE e.id = due.id
    RETURNING e.id, e.account_id, e.contact_id, e.calendar_id, e.starts_at
  )
  SELECT
    k.id, 'confirmation'::TEXT, k.account_id, k.contact_id, k.starts_at,
    c.name, c.timezone, c.confirm_text, c.confirm_template, c.confirm_template_language
  FROM claimed k
  JOIN calendars c ON c.id = k.calendar_id;

  RETURN QUERY
  WITH due AS (
    SELECT e.id
    FROM calendar_events e
    JOIN calendars c ON c.id = e.calendar_id
    WHERE c.reminder_enabled
      AND e.reminder_at IS NULL
      AND e.kind = 'appointment'
      AND e.contact_id IS NOT NULL
      AND e.notify
      AND e.status IN ('scheduled', 'confirmed')
      AND e.starts_at > NOW()
      AND e.starts_at - make_interval(hours => c.reminder_hours) <= NOW()
      AND e.time_set_at <= e.starts_at - make_interval(hours => c.reminder_hours)
      AND (p_event_id IS NULL OR e.id = p_event_id)
    ORDER BY e.starts_at
    LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    FOR UPDATE OF e SKIP LOCKED
  ),
  claimed AS (
    UPDATE calendar_events e
    SET reminder_at = NOW(), reminder_error = NULL
    FROM due
    WHERE e.id = due.id
    RETURNING e.id, e.account_id, e.contact_id, e.calendar_id, e.starts_at
  )
  SELECT
    k.id, 'reminder'::TEXT, k.account_id, k.contact_id, k.starts_at,
    c.name, c.timezone, c.reminder_text, c.reminder_template, c.reminder_template_language
  FROM claimed k
  JOIN calendars c ON c.id = k.calendar_id;
END;
$$;

ALTER FUNCTION public.claim_calendar_notifications(INT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_calendar_notifications(INT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_calendar_notifications(INT, UUID) TO service_role;


-- ============================================================
-- Agendas in the niche templates (053)
--
-- A template's content may carry "calendars": agendas created along
-- with its funnels and quick replies, e.g.
--   { "name": "Consultas", "color": "#3b82f6", "slot_minutes": 30,
--     "hours": [{ "weekday": 1, "starts": "08:00", "ends": "12:00" }] }
-- Like everything else a template brings, an agenda whose name the CRM
-- already has is left as it is, and it never talks to customers on its
-- own: messages, the public link and the feed all start off.
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_crm_template_calendars(
  p_account_id UUID,
  p_content    JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item        JSONB;
  v_calendar_id UUID;
  v_created     INT := 0;
  v_skipped     INT := 0;
BEGIN
  FOR v_item IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_content -> 'calendars', '[]'::jsonb))
  LOOP
    IF EXISTS (
      SELECT 1 FROM calendars
      WHERE account_id = p_account_id AND lower(name) = lower(v_item ->> 'name')
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO calendars (account_id, name, color, slot_minutes)
    VALUES (
      p_account_id,
      v_item ->> 'name',
      COALESCE(v_item ->> 'color', '#3b82f6'),
      COALESCE((v_item ->> 'slot_minutes')::INT, 30)
    )
    RETURNING id INTO v_calendar_id;

    INSERT INTO calendar_hours (account_id, calendar_id, weekday, starts, ends)
    SELECT
      p_account_id,
      v_calendar_id,
      (h ->> 'weekday')::SMALLINT,
      (h ->> 'starts')::TIME,
      (h ->> 'ends')::TIME
    FROM jsonb_array_elements(COALESCE(v_item -> 'hours', '[]'::jsonb)) AS h;

    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object('calendars', v_created, 'skipped', v_skipped);
END;
$$;

ALTER FUNCTION public.apply_crm_template_calendars(UUID, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_crm_template_calendars(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- agencia_apply_template (053), unchanged except that it also creates
-- the template's agendas and counts them in the summary.
CREATE OR REPLACE FUNCTION public.agencia_apply_template(
  p_account_id UUID,
  p_template_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := require_agencia_operator(p_account_id);
  v_status TEXT;
  v_tpl crm_templates%ROWTYPE;
  v_summary JSONB;
  v_calendars JSONB;
BEGIN
  SELECT status INTO v_status FROM accounts WHERE id = p_account_id;
  IF v_status IS NULL OR v_status = 'archived' THEN
    RAISE EXCEPTION 'CRM não encontrado' USING ERRCODE = '22023';
  END IF;

  -- Writing into a client's CRM is operating it: only while the agency
  -- is still setting it up, or with the owner's full consent.
  IF v_status <> 'onboarding' AND agency_access_level(p_account_id) <> 'full' THEN
    RAISE EXCEPTION 'Aplicar um modelo altera o CRM do cliente: só em implantação ou com acesso Total liberado pelo dono'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_tpl FROM crm_templates WHERE id = p_template_id;
  IF NOT FOUND OR NOT v_tpl.active THEN
    RAISE EXCEPTION 'Modelo não encontrado' USING ERRCODE = '22023';
  END IF;

  v_summary := apply_crm_template_content(p_account_id, v_tpl.content);
  v_calendars := apply_crm_template_calendars(p_account_id, v_tpl.content);
  v_summary := v_summary || jsonb_build_object(
    'calendars', (v_calendars ->> 'calendars')::INT,
    'skipped', (v_summary ->> 'skipped')::INT + (v_calendars ->> 'skipped')::INT
  );

  INSERT INTO crm_template_applications (account_id, template_id, template_name, applied_by, summary)
  VALUES (p_account_id, v_tpl.id, v_tpl.name, auth.uid(), v_summary);

  INSERT INTO agencia_auditoria (actor_user_id, account_id, action)
  VALUES (auth.uid(), p_account_id, 'apply_template');

  RETURN v_summary;
END;
$$;

ALTER FUNCTION public.agencia_apply_template(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.agencia_apply_template(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agencia_apply_template(UUID, UUID) TO authenticated;

-- The built-in clinic template gains an agenda — unless someone has
-- already given it agendas of their own.
UPDATE crm_templates
SET content = content || $json${
  "calendars": [
    { "name": "Consultas", "color": "#3b82f6", "slot_minutes": 30,
      "hours": [
        { "weekday": 1, "starts": "08:00", "ends": "12:00" },
        { "weekday": 1, "starts": "14:00", "ends": "18:00" },
        { "weekday": 2, "starts": "08:00", "ends": "12:00" },
        { "weekday": 2, "starts": "14:00", "ends": "18:00" },
        { "weekday": 3, "starts": "08:00", "ends": "12:00" },
        { "weekday": 3, "starts": "14:00", "ends": "18:00" },
        { "weekday": 4, "starts": "08:00", "ends": "12:00" },
        { "weekday": 4, "starts": "14:00", "ends": "18:00" },
        { "weekday": 5, "starts": "08:00", "ends": "12:00" },
        { "weekday": 5, "starts": "14:00", "ends": "18:00" }
      ] }
  ]
}$json$::jsonb
WHERE slug = 'clinica-medica'
  AND NOT (content ? 'calendars');


-- ============================================================
-- The team hears about bookings from the public link
--
-- notifications.type gains 'agenda_booking'. The allowed list is
-- rebuilt from whatever the constraint holds today plus the new value
-- (as in 060), so a type another migration added is never dropped.
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

  v_types := v_types || ARRAY['conversation_assigned', 'agenda_booking'];

  EXECUTE format(
    'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (%s))',
    (SELECT string_agg(quote_literal(t), ', ' ORDER BY t)
     FROM (SELECT DISTINCT unnest(v_types) AS t) AS distinct_types)
  );
END $$;

-- One notification per member who can act on the booking. Held for
-- approval, it says so in the title. Never blocks the booking: a
-- problem here (an agenda with a time zone Postgres does not know,
-- say) costs the bell, not the customer's appointment.
CREATE OR REPLACE FUNCTION public.calendar_events_notify_public()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO notifications (account_id, user_id, type, contact_id, title, body)
    SELECT
      NEW.account_id,
      m.user_id,
      'agenda_booking',
      NEW.contact_id,
      CASE
        WHEN NEW.status = 'pending' THEN 'Pedido de horário pelo link: aprove ou recuse'
        ELSE 'Novo agendamento pelo link'
      END,
      concat_ws(
        ' · ',
        (SELECT COALESCE(NULLIF(btrim(ct.name), ''), ct.phone) FROM contacts ct WHERE ct.id = NEW.contact_id),
        c.name,
        to_char(NEW.starts_at AT TIME ZONE c.timezone, 'DD/MM "às" HH24:MI')
      )
    FROM calendars c
    JOIN account_members m ON m.account_id = NEW.account_id
    WHERE c.id = NEW.calendar_id
      AND m.role IN ('owner', 'admin', 'agent');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'calendar_events_notify_public: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.calendar_events_notify_public() OWNER TO postgres;

DROP TRIGGER IF EXISTS calendar_events_notify_public ON calendar_events;
CREATE TRIGGER calendar_events_notify_public
  AFTER INSERT ON calendar_events
  FOR EACH ROW
  WHEN (NEW.source = 'public' AND NEW.kind = 'appointment')
  EXECUTE FUNCTION public.calendar_events_notify_public();
