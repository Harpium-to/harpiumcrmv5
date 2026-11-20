-- ============================================================
-- 077_setores.sql — setores: groups of people who handle a subject
-- (Recepção, Financeiro, Dra. Ana), each with its own rule to pick
-- who answers, and the AI choosing the setor when it hands off.
--
-- See docs/plano-distribuicao-atendimento.md (§5, Fases 2 e 3). Pieces:
--
--   1. teams — the setores: name, a short `code` (what the AI writes in
--      [[HANDOFF codigo]]), a `description` of what it handles (what
--      the AI reads), colour, and its rule: `mode` (rodizio,
--      menos_ocupado or fila), `online_only`, `max_open_per_person`,
--      the reply deadline (`sla_minutes`, `sla_action`, used by 078)
--      and `is_entry` (one per CRM: where what nobody could classify
--      goes).
--   2. team_members — who is in each setor. Composite foreign keys
--      keep both sides in the same CRM, and leaving the CRM leaves
--      every setor (ON DELETE CASCADE from account_members).
--   3. conversations.team_id — the setor a conversation is in; the
--      history (076) gains from_team_id / to_team_id.
--   4. ai_configs / agents .handoff_mode + .handoff_team_id — "Quando
--      passar para uma pessoa": ia_escolhe, setor, pessoa or fila (the
--      person stays in handoff_agent_id, 033/044).
--   5. pick_next_attendant() learns setores; transfer_conversation()
--      gains the 'setor' mode (and so a new signature: the 076 one is
--      dropped). A setor in "fila" mode, or with nobody available,
--      keeps the conversation in its queue and tells the setor.
--   6. The AI taking a conversation back ("Retomar IA") takes it out of
--      any setor, so it never shows in a human queue while the bot
--      answers.
--   7. Notification type 'team_queue'.
--
-- Idempotent — safe to run more than once.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Setores
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name                TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  code                TEXT NOT NULL CHECK (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(code) <= 40),
  description         TEXT CHECK (description IS NULL OR char_length(description) <= 500),
  color               TEXT NOT NULL DEFAULT '#6366f1' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  mode                TEXT NOT NULL DEFAULT 'rodizio'
                      CHECK (mode IN ('rodizio', 'menos_ocupado', 'fila')),
  online_only         BOOLEAN NOT NULL DEFAULT true,
  max_open_per_person INT CHECK (max_open_per_person IS NULL OR max_open_per_person BETWEEN 1 AND 500),
  sla_minutes         INT CHECK (sla_minutes IS NULL OR sla_minutes BETWEEN 1 AND 1440),
  sla_action          TEXT NOT NULL DEFAULT 'avisar' CHECK (sla_action IN ('avisar', 'proximo')),
  is_entry            BOOLEAN NOT NULL DEFAULT false,
  active              BOOLEAN NOT NULL DEFAULT true,
  position            INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, account_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_account_code ON teams (account_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_one_entry ON teams (account_id) WHERE is_entry;
CREATE INDEX IF NOT EXISTS idx_teams_account_position ON teams (account_id, position);

DROP TRIGGER IF EXISTS set_updated_at ON teams;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

-- Every member sees the setores (to transfer to one); admins manage them.
DROP POLICY IF EXISTS teams_select ON teams;
CREATE POLICY teams_select ON teams FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS teams_insert ON teams;
CREATE POLICY teams_insert ON teams FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS teams_update ON teams;
CREATE POLICY teams_update ON teams FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS teams_delete ON teams;
CREATE POLICY teams_delete ON teams FOR DELETE
  USING (is_account_member(account_id, 'admin'));


-- ------------------------------------------------------------
-- 2. Who is in each setor
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_members (
  team_id    UUID NOT NULL,
  account_id UUID NOT NULL,
  user_id    UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id),
  FOREIGN KEY (team_id, account_id) REFERENCES teams (id, account_id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, user_id) REFERENCES account_members (account_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members (user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_account ON team_members (account_id);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_members_select ON team_members;
CREATE POLICY team_members_select ON team_members FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS team_members_insert ON team_members;
CREATE POLICY team_members_insert ON team_members FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS team_members_delete ON team_members;
CREATE POLICY team_members_delete ON team_members FOR DELETE
  USING (is_account_member(account_id, 'admin'));


-- ------------------------------------------------------------
-- 3. The setor a conversation is in
-- ------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_team
  ON conversations (account_id, team_id)
  WHERE team_id IS NOT NULL;

ALTER TABLE conversation_transfers
  ADD COLUMN IF NOT EXISTS from_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS to_team_id   UUID REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_transfers_team
  ON conversation_transfers (account_id, to_team_id, created_at DESC)
  WHERE to_team_id IS NOT NULL;


-- ------------------------------------------------------------
-- 4. "Quando passar para uma pessoa"
-- ------------------------------------------------------------
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS handoff_mode TEXT
    CHECK (handoff_mode IS NULL OR handoff_mode IN ('ia_escolhe', 'setor', 'pessoa', 'fila')),
  ADD COLUMN IF NOT EXISTS handoff_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS handoff_mode TEXT
    CHECK (handoff_mode IS NULL OR handoff_mode IN ('ia_escolhe', 'setor', 'pessoa', 'fila')),
  ADD COLUMN IF NOT EXISTS handoff_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;


-- ------------------------------------------------------------
-- 5a. The rotation, now per setor
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pick_next_attendant(
  p_account UUID,
  p_team UUID DEFAULT NULL,
  p_exclude UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team teams%ROWTYPE;
  v_pick UUID;
BEGIN
  IF p_team IS NOT NULL THEN
    SELECT * INTO v_team FROM teams WHERE id = p_team AND account_id = p_account;
    IF NOT FOUND OR NOT v_team.active THEN
      RETURN NULL;
    END IF;
  END IF;

  -- One rotation at a time per setor (or per CRM without one).
  PERFORM pg_advisory_xact_lock(
    hashtextextended('rodizio:' || COALESCE(p_team, p_account)::text, 0)
  );

  SELECT c.user_id INTO v_pick
  FROM (
    SELECT m.user_id,
           m.created_at AS joined_at,
           COALESCE(
             mp.status = 'online'
               AND mp.last_seen_at > now() - INTERVAL '75 seconds'
               AND mp.account_id = p_account,
             false) AS online,
           (SELECT count(*)
              FROM conversations oc
             WHERE oc.account_id = p_account
               AND oc.assigned_agent_id = m.user_id
               AND oc.status <> 'closed') AS open_count,
           (SELECT max(t.created_at)
              FROM conversation_transfers t
             WHERE t.account_id = p_account
               AND t.to_user_id = m.user_id
               AND (p_team IS NULL OR t.to_team_id = p_team)) AS last_received
    FROM account_members m
    LEFT JOIN member_presence mp ON mp.user_id = m.user_id
    WHERE m.account_id = p_account
      AND m.role IN ('owner', 'admin', 'agent')
      AND m.receives_conversations
      AND (p_exclude IS NULL OR m.user_id <> p_exclude)
      AND (p_team IS NULL OR EXISTS (
            SELECT 1 FROM team_members tm
             WHERE tm.team_id = p_team AND tm.user_id = m.user_id))
  ) c
  WHERE (p_team IS NULL OR NOT v_team.online_only OR c.online)
    AND (p_team IS NULL OR v_team.max_open_per_person IS NULL
         OR c.open_count < v_team.max_open_per_person)
  ORDER BY c.online DESC,
           CASE WHEN p_team IS NOT NULL AND v_team.mode = 'menos_ocupado' THEN c.open_count END ASC NULLS LAST,
           c.last_received ASC NULLS FIRST,
           c.joined_at ASC,
           c.user_id
  LIMIT 1;

  RETURN v_pick;
END;
$$;

ALTER FUNCTION public.pick_next_attendant(UUID, UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pick_next_attendant(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pick_next_attendant(UUID, UUID, UUID) TO service_role;


-- ------------------------------------------------------------
-- 5b. transfer_conversation() with setores (new signature)
--
--   p_mode 'setor': the conversation goes to setor p_team_id. In
--   'fila' mode — or when nobody in it is available — it waits in the
--   setor's queue (no owner) and the setor is told; otherwise its rule
--   picks the person. A transfer to a person who is not in the
--   conversation's setor takes it out of the setor.
--
--   p_mode 'ninguem' with p_leave_team: out of the setor as well — what
--   "Retomar IA" wants (the bot owns it, no human queue does).
--
--   Answers reason 'queued' when it ended in a setor's queue.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.transfer_conversation(UUID, TEXT, UUID, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN);

CREATE OR REPLACE FUNCTION public.transfer_conversation(
  p_conversation_id UUID,
  p_mode TEXT,
  p_to_user_id UUID DEFAULT NULL,
  p_source TEXT DEFAULT 'manual',
  p_note TEXT DEFAULT NULL,
  p_actor_user_id UUID DEFAULT NULL,
  p_only_if_unassigned BOOLEAN DEFAULT false,
  p_waiting BOOLEAN DEFAULT false,
  p_team_id UUID DEFAULT NULL,
  p_leave_team BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv   conversations%ROWTYPE;
  v_team   teams%ROWTYPE;
  v_actor  UUID;
  v_source TEXT := COALESCE(NULLIF(btrim(p_source), ''), 'manual');
  v_note   TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_target UUID;
  v_new_team UUID;
  v_queued BOOLEAN := false;
  v_contact TEXT;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('pessoa', 'rodizio', 'setor', 'ninguem') THEN
    RAISE EXCEPTION 'Modo de transferência inválido: %', p_mode USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    v_note := left(v_note, 500);
  END IF;

  SELECT * INTO v_conv FROM conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'changed', false, 'reason', 'not_found');
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT is_account_member(v_conv.account_id, 'agent') THEN
      RAISE EXCEPTION 'Sem permissão para transferir esta conversa' USING ERRCODE = '42501';
    END IF;
    v_actor := auth.uid();
    IF v_source NOT IN ('manual', 'harpi') THEN
      v_source := 'manual';
    END IF;
  ELSE
    v_actor := p_actor_user_id;
  END IF;

  IF p_only_if_unassigned AND v_conv.assigned_agent_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'changed', false, 'reason', 'already_assigned',
      'from_user_id', v_conv.assigned_agent_id, 'to_user_id', v_conv.assigned_agent_id,
      'team_id', v_conv.team_id,
      'account_id', v_conv.account_id, 'contact_id', v_conv.contact_id
    );
  END IF;

  v_new_team := v_conv.team_id;

  IF p_mode = 'pessoa' THEN
    IF p_to_user_id IS NULL THEN
      RAISE EXCEPTION 'Informe para quem passar' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM account_members
       WHERE account_id = v_conv.account_id
         AND user_id = p_to_user_id
         AND role <> 'viewer'
    ) THEN
      RAISE EXCEPTION 'Essa pessoa não atende neste CRM' USING ERRCODE = '22023';
    END IF;
    v_target := p_to_user_id;

  ELSIF p_mode = 'rodizio' THEN
    v_target := pick_next_attendant(v_conv.account_id, NULL, NULL);
    IF v_target IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false, 'changed', false, 'reason', 'nobody_available',
        'from_user_id', v_conv.assigned_agent_id, 'to_user_id', v_conv.assigned_agent_id,
        'team_id', v_conv.team_id,
        'account_id', v_conv.account_id, 'contact_id', v_conv.contact_id
      );
    END IF;

  ELSIF p_mode = 'setor' THEN
    SELECT * INTO v_team FROM teams
     WHERE id = p_team_id AND account_id = v_conv.account_id AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Esse setor não existe neste CRM' USING ERRCODE = '22023';
    END IF;
    v_new_team := v_team.id;
    IF v_team.mode = 'fila' THEN
      v_target := NULL;
    ELSE
      v_target := pick_next_attendant(v_conv.account_id, v_team.id, NULL);
    END IF;
    v_queued := v_target IS NULL;

  ELSE -- ninguem: back to the queue of its setor, or the shared one;
       -- out of the setor too when the AI takes it back (p_leave_team).
    v_target := NULL;
    IF p_leave_team THEN
      v_new_team := NULL;
    END IF;
  END IF;

  -- A person outside the conversation's setor takes it out of the setor.
  IF p_mode <> 'setor' AND v_target IS NOT NULL AND v_new_team IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM team_members
                      WHERE team_id = v_new_team AND user_id = v_target) THEN
    v_new_team := NULL;
  END IF;

  PERFORM set_config('harpium.transfer_source', v_source, true);
  PERFORM set_config('harpium.transfer_note', COALESCE(v_note, ''), true);
  PERFORM set_config('harpium.transfer_actor', COALESCE(v_actor::text, ''), true);

  UPDATE conversations
     SET assigned_agent_id = v_target,
         team_id = v_new_team,
         ai_autoreply_disabled = CASE WHEN p_waiting THEN true ELSE ai_autoreply_disabled END,
         needs_human_since = CASE
           WHEN p_waiting AND status <> 'closed' THEN COALESCE(needs_human_since, now())
           ELSE needs_human_since
         END,
         updated_at = now()
   WHERE id = p_conversation_id;

  PERFORM set_config('harpium.transfer_source', '', true);
  PERFORM set_config('harpium.transfer_note', '', true);
  PERFORM set_config('harpium.transfer_actor', '', true);

  -- In the setor's queue: tell its people, once per queue (only when it
  -- was empty) so a busy morning is not a bell per conversation. A
  -- setor without people tells the CRM's admins.
  IF v_queued AND NOT EXISTS (
    SELECT 1 FROM conversations q
     WHERE q.account_id = v_conv.account_id
       AND q.team_id = v_team.id
       AND q.assigned_agent_id IS NULL
       AND q.status <> 'closed'
       AND q.id <> p_conversation_id
  ) THEN
    SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact FROM contacts WHERE id = v_conv.contact_id;
    INSERT INTO notifications (account_id, user_id, type, conversation_id, contact_id, actor_user_id, title, body)
    SELECT v_conv.account_id, r.user_id, 'team_queue', v_conv.id, v_conv.contact_id, v_actor,
           'Conversa na fila de ' || v_team.name,
           CASE WHEN v_team.mode = 'fila'
                THEN 'A conversa com ' || COALESCE(v_contact, 'um contato') || ' espera alguém do setor pegar'
                ELSE 'Ninguém do setor está disponível: a conversa com ' || COALESCE(v_contact, 'um contato') || ' espera na fila'
           END || COALESCE(' · ' || v_note, '')
      FROM (
        SELECT tm.user_id FROM team_members tm
          JOIN account_members am ON am.account_id = tm.account_id AND am.user_id = tm.user_id
         WHERE tm.team_id = v_team.id AND am.role <> 'viewer'
        UNION
        SELECT am.user_id FROM account_members am
         WHERE am.account_id = v_conv.account_id
           AND am.role IN ('owner', 'admin')
           AND NOT EXISTS (SELECT 1 FROM team_members tm2 WHERE tm2.team_id = v_team.id)
      ) r
     WHERE v_actor IS NULL OR r.user_id <> v_actor;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'changed', v_target IS DISTINCT FROM v_conv.assigned_agent_id
               OR v_new_team IS DISTINCT FROM v_conv.team_id,
    'reason', CASE WHEN v_queued THEN 'queued' END,
    'from_user_id', v_conv.assigned_agent_id,
    'to_user_id', v_target,
    'team_id', v_new_team,
    'account_id', v_conv.account_id,
    'contact_id', v_conv.contact_id
  );
END;
$$;

ALTER FUNCTION public.transfer_conversation(UUID, TEXT, UUID, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, UUID, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transfer_conversation(UUID, TEXT, UUID, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_conversation(UUID, TEXT, UUID, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, UUID, BOOLEAN) TO authenticated, service_role;


-- ------------------------------------------------------------
-- History, now with the setor (replaces 076's function)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conversations_record_transfer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source TEXT := NULLIF(current_setting('harpium.transfer_source', true), '');
  v_note   TEXT := NULLIF(current_setting('harpium.transfer_note', true), '');
  v_actor  UUID := COALESCE(auth.uid(), NULLIF(current_setting('harpium.transfer_actor', true), '')::uuid);
  v_from      UUID;
  v_from_team UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL AND NEW.team_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id
       AND NEW.team_id IS NOT DISTINCT FROM OLD.team_id THEN
      RETURN NEW;
    END IF;
    v_from := OLD.assigned_agent_id;
    v_from_team := OLD.team_id;
  END IF;

  INSERT INTO conversation_transfers (
    account_id, conversation_id, from_user_id, to_user_id, from_team_id, to_team_id,
    actor_user_id, source, note
  ) VALUES (
    NEW.account_id, NEW.id, v_from, NEW.assigned_agent_id, v_from_team, NEW.team_id,
    v_actor,
    COALESCE(v_source, CASE WHEN auth.uid() IS NOT NULL THEN 'manual' ELSE 'outro' END),
    v_note
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to record transfer for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_conversation_transfer ON conversations;
CREATE TRIGGER record_conversation_transfer
  AFTER INSERT OR UPDATE OF assigned_agent_id, team_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION conversations_record_transfer();


-- ------------------------------------------------------------
-- The notification names the setor (replaces 076's function)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_conversation_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor        UUID := COALESCE(auth.uid(), NULLIF(current_setting('harpium.transfer_actor', true), '')::uuid);
  v_source       TEXT := COALESCE(
                           NULLIF(current_setting('harpium.transfer_source', true), ''),
                           CASE WHEN auth.uid() IS NOT NULL THEN 'manual' ELSE 'outro' END);
  v_note         TEXT := NULLIF(current_setting('harpium.transfer_note', true), '');
  v_contact_name TEXT;
  v_actor_name   TEXT;
  v_team_name    TEXT;
  v_body         TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_agent_id IS NULL
       OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_actor IS NOT NULL AND v_actor = NEW.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;
  v_contact_name := COALESCE(v_contact_name, 'um contato');

  IF v_actor IS NOT NULL THEN
    SELECT NULLIF(full_name, '') INTO v_actor_name FROM profiles WHERE user_id = v_actor;
  END IF;
  IF NEW.team_id IS NOT NULL THEN
    SELECT name INTO v_team_name FROM teams WHERE id = NEW.team_id;
  END IF;

  v_body := CASE v_source
    WHEN 'ia'        THEN 'A IA passou para você a conversa com ' || v_contact_name
    WHEN 'rodizio'   THEN 'Pelo rodízio, a conversa com ' || v_contact_name || ' ficou com você'
    WHEN 'chegada'   THEN 'A conversa nova de ' || v_contact_name || ' ficou com você'
    WHEN 'fluxo'     THEN 'Um fluxo passou para você a conversa com ' || v_contact_name
    WHEN 'automacao' THEN 'Uma automação passou para você a conversa com ' || v_contact_name
    WHEN 'prazo'     THEN 'A conversa com ' || v_contact_name || ' passou do prazo e veio para você'
    WHEN 'retorno'   THEN v_contact_name || ' voltou a falar e a conversa ficou com você'
    WHEN 'api'       THEN COALESCE(v_actor_name, 'Uma integração') || ' passou para você a conversa com ' || v_contact_name
    ELSE COALESCE(v_actor_name, 'Alguém da equipe') || ' passou para você a conversa com ' || v_contact_name
  END;
  IF v_team_name IS NOT NULL THEN
    v_body := v_body || ' · ' || v_team_name;
  END IF;
  IF v_note IS NOT NULL THEN
    v_body := v_body || ' · ' || v_note;
  END IF;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id, actor_user_id, title, body
  ) VALUES (
    NEW.account_id, NEW.assigned_agent_id, 'conversation_assigned', NEW.id, NEW.contact_id,
    v_actor, 'Conversa para você', v_body
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create assignment notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_conversation_assigned() OWNER TO postgres;


-- ------------------------------------------------------------
-- 6. The AI taking a conversation back leaves any setor
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conversations_leave_team_on_resume()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(OLD.ai_autoreply_disabled, false) = true
     AND COALESCE(NEW.ai_autoreply_disabled, false) = false
     AND NEW.assigned_agent_id IS NULL THEN
    NEW.team_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leave_team_on_resume ON conversations;
CREATE TRIGGER leave_team_on_resume
  BEFORE UPDATE OF ai_autoreply_disabled ON conversations
  FOR EACH ROW EXECUTE FUNCTION conversations_leave_team_on_resume();


-- ------------------------------------------------------------
-- 7. Notification type
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

  v_types := v_types || ARRAY['conversation_assigned', 'team_queue'];

  EXECUTE format(
    'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (%s))',
    (SELECT string_agg(quote_literal(t), ', ' ORDER BY t)
     FROM (SELECT DISTINCT unnest(v_types) AS t) AS distinct_types)
  );
END $$;
