-- ============================================================
-- 076_distribuicao_atendimento.sql — who answers each conversation:
-- a fair rotation, transfers with a note, and their history.
--
-- See docs/plano-distribuicao-atendimento.md (§5, Fase 1). Pieces:
--
--   1. conversation_transfers — every change of a conversation's
--      owner (assigned_agent_id): from whom, to whom, who did it, from
--      where ("source") and an optional note. Written ONLY by a
--      trigger on conversations, so no screen, route or job can change
--      the owner without leaving a row (the 058 idea: the database
--      keeps the fact, not each code path).
--   2. conversations.assigned_at — when the current owner got it.
--   3. account_members.receives_conversations — "Recebe conversas".
--      Off takes the person out of every rotation (an owner who does
--      not answer chats, holidays). set_receives_conversations()
--      changes it: yourself, or anyone when you are admin+.
--   4. pick_next_attendant() — the rotation. Candidates come from
--      account_members only (never viewers, never agency staff who are
--      merely "inside" the CRM: entering a client CRM rewrites
--      profiles.account_id, which is why the old engine code that read
--      profiles could pick them). Online first; then whoever received a
--      conversation longest ago. Serialised per CRM with an advisory
--      lock, so two arrivals in the same second do not skip a turn.
--   5. transfer_conversation() — the one way the app assigns: to a
--      person, to the rotation, or to nobody; with a source and a note;
--      optionally only while still unassigned ("Pegar"); optionally
--      marking the conversation as waiting for a person.
--   6. notify_conversation_assigned() (027) rewritten in Portuguese:
--      who passed it, from where, and the note. Nobody is notified of
--      a conversation they took themselves — by app or by API.
--
-- The source and the note reach the triggers through transaction-local
-- settings (harpium.transfer_*) that transfer_conversation() sets right
-- before its UPDATE and clears right after.
--
-- Idempotent — safe to run more than once.
-- ============================================================


-- ------------------------------------------------------------
-- 1. History
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_transfers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  from_user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  to_user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Who did it. NULL: the AI, an automation, a flow or a job.
  actor_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source          TEXT NOT NULL DEFAULT 'outro'
                  CHECK (source IN ('manual', 'ia', 'rodizio', 'fluxo', 'automacao',
                                    'harpi', 'api', 'prazo', 'retorno', 'chegada', 'outro')),
  note            TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE conversation_transfers IS
  'Every change of a conversation''s owner. Written only by the record_conversation_transfer trigger (076).';

CREATE INDEX IF NOT EXISTS idx_conversation_transfers_conversation
  ON conversation_transfers (conversation_id, created_at);
-- "Who received a conversation longest ago" — the rotation's order.
CREATE INDEX IF NOT EXISTS idx_conversation_transfers_received
  ON conversation_transfers (account_id, to_user_id, created_at DESC);

ALTER TABLE conversation_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_transfers_select ON conversation_transfers;
CREATE POLICY conversation_transfers_select ON conversation_transfers FOR SELECT
  USING (is_account_member(account_id));

-- Read-only for everyone but the trigger (SECURITY DEFINER).
REVOKE INSERT, UPDATE, DELETE ON conversation_transfers FROM anon, authenticated;


-- ------------------------------------------------------------
-- 2. When the current owner got it
-- ------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

COMMENT ON COLUMN conversations.assigned_at IS
  'When the current owner (assigned_agent_id) got this conversation. NULL when nobody owns it.';

-- Best guess for conversations already owned before this migration.
UPDATE conversations
   SET assigned_at = COALESCE(updated_at, created_at)
 WHERE assigned_agent_id IS NOT NULL
   AND assigned_at IS NULL;

CREATE OR REPLACE FUNCTION public.conversations_stamp_assigned_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NOT NULL THEN
      NEW.assigned_at := COALESCE(NEW.assigned_at, now());
    END IF;
  ELSIF NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
    NEW.assigned_at := CASE WHEN NEW.assigned_agent_id IS NULL THEN NULL ELSE now() END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_assigned_at ON conversations;
CREATE TRIGGER stamp_assigned_at
  BEFORE INSERT OR UPDATE OF assigned_agent_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION conversations_stamp_assigned_at();


-- ------------------------------------------------------------
-- 3. "Recebe conversas"
-- ------------------------------------------------------------
ALTER TABLE account_members
  ADD COLUMN IF NOT EXISTS receives_conversations BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN account_members.receives_conversations IS
  'Off: never picked by a rotation (076). Viewers are never picked whatever this says.';

CREATE OR REPLACE FUNCTION public.set_receives_conversations(
  p_user_id UUID,
  p_on BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'Informe ligado ou desligado' USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account FROM profiles WHERE user_id = auth.uid();
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Nenhum CRM aberto' USING ERRCODE = '22023';
  END IF;

  IF p_user_id IS DISTINCT FROM auth.uid()
     AND NOT is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'Só admin muda o recebimento de outra pessoa' USING ERRCODE = '42501';
  END IF;

  UPDATE account_members
     SET receives_conversations = p_on
   WHERE account_id = v_account
     AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Essa pessoa não é da equipe deste CRM' USING ERRCODE = '22023';
  END IF;
END;
$$;

ALTER FUNCTION public.set_receives_conversations(UUID, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_receives_conversations(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_receives_conversations(UUID, BOOLEAN) TO authenticated, service_role;


-- ------------------------------------------------------------
-- 4. The rotation
--
-- p_team is accepted (and ignored) here so 077 can teach it about
-- teams with CREATE OR REPLACE, keeping one signature.
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
  v_pick UUID;
BEGIN
  -- One rotation at a time per CRM: the second arrival waits for the
  -- first to commit and then sees its history row.
  PERFORM pg_advisory_xact_lock(hashtextextended('rodizio:' || p_account::text, 0));

  SELECT c.user_id INTO v_pick
  FROM (
    SELECT m.user_id,
           m.created_at AS joined_at,
           -- The green dot: 'online' and a heartbeat in the last 75 s
           -- (src/lib/presence.ts, OFFLINE_AFTER_MS), in this CRM.
           (mp.status = 'online'
              AND mp.last_seen_at > now() - INTERVAL '75 seconds'
              AND mp.account_id = p_account) AS online,
           (SELECT max(t.created_at)
              FROM conversation_transfers t
             WHERE t.account_id = p_account
               AND t.to_user_id = m.user_id) AS last_received
    FROM account_members m
    LEFT JOIN member_presence mp ON mp.user_id = m.user_id
    WHERE m.account_id = p_account
      AND m.role IN ('owner', 'admin', 'agent')
      AND m.receives_conversations
      AND (p_exclude IS NULL OR m.user_id <> p_exclude)
  ) c
  ORDER BY c.online DESC NULLS LAST,
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
-- 5. The one way to assign
--
--   p_mode   'pessoa'   to p_to_user_id (a member, not a viewer)
--            'rodizio'  to pick_next_attendant()
--            'ninguem'  back to the shared queue
--   p_source who/what is doing it (see the CHECK above). A signed-in
--            person can only be 'manual' or 'harpi'; the AI, flows,
--            automations and jobs come through the service role.
--   p_only_if_unassigned  "Pegar": nothing happens if someone already
--            owns it (the second of two simultaneous clicks loses).
--   p_waiting  also mark it as waiting for a person: pause the AI on
--            it and start needs_human_since (058) in the same write.
--
-- Returns {ok, changed, reason?, from_user_id, to_user_id, account_id,
-- contact_id}. Never raises for "nobody available" or "already taken":
-- those are answers, not errors.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_conversation(
  p_conversation_id UUID,
  p_mode TEXT,
  p_to_user_id UUID DEFAULT NULL,
  p_source TEXT DEFAULT 'manual',
  p_note TEXT DEFAULT NULL,
  p_actor_user_id UUID DEFAULT NULL,
  p_only_if_unassigned BOOLEAN DEFAULT false,
  p_waiting BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv   conversations%ROWTYPE;
  v_actor  UUID;
  v_source TEXT := COALESCE(NULLIF(btrim(p_source), ''), 'manual');
  v_note   TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_target UUID;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('pessoa', 'rodizio', 'ninguem') THEN
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
    -- A person in the app: must be able to work this CRM's inbox, and
    -- speaks for themselves only.
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
      'account_id', v_conv.account_id, 'contact_id', v_conv.contact_id
    );
  END IF;

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
        'account_id', v_conv.account_id, 'contact_id', v_conv.contact_id
      );
    END IF;
  ELSE
    v_target := NULL;
  END IF;

  PERFORM set_config('harpium.transfer_source', v_source, true);
  PERFORM set_config('harpium.transfer_note', COALESCE(v_note, ''), true);
  PERFORM set_config('harpium.transfer_actor', COALESCE(v_actor::text, ''), true);

  UPDATE conversations
     SET assigned_agent_id = v_target,
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

  RETURN jsonb_build_object(
    'ok', true,
    'changed', v_target IS DISTINCT FROM v_conv.assigned_agent_id,
    'from_user_id', v_conv.assigned_agent_id,
    'to_user_id', v_target,
    'account_id', v_conv.account_id,
    'contact_id', v_conv.contact_id
  );
END;
$$;

ALTER FUNCTION public.transfer_conversation(UUID, TEXT, UUID, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transfer_conversation(UUID, TEXT, UUID, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_conversation(UUID, TEXT, UUID, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN) TO authenticated, service_role;


-- ------------------------------------------------------------
-- History trigger: every owner change becomes a row, whatever wrote it.
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
  v_from   UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
    v_from := NULL;
  ELSE
    IF NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
    v_from := OLD.assigned_agent_id;
  END IF;

  INSERT INTO conversation_transfers (
    account_id, conversation_id, from_user_id, to_user_id, actor_user_id, source, note
  ) VALUES (
    NEW.account_id, NEW.id, v_from, NEW.assigned_agent_id, v_actor,
    COALESCE(v_source, CASE WHEN auth.uid() IS NOT NULL THEN 'manual' ELSE 'outro' END),
    v_note
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let the history block the assignment itself.
  RAISE WARNING 'Failed to record transfer for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.conversations_record_transfer() OWNER TO postgres;

DROP TRIGGER IF EXISTS record_conversation_transfer ON conversations;
CREATE TRIGGER record_conversation_transfer
  AFTER INSERT OR UPDATE OF assigned_agent_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION conversations_record_transfer();


-- ------------------------------------------------------------
-- 6. The notification, in Portuguese (replaces 027's body)
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

  -- Nobody is told about a conversation they took themselves.
  IF v_actor IS NOT NULL AND v_actor = NEW.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;
  v_contact_name := COALESCE(v_contact_name, 'um contato');

  IF v_actor IS NOT NULL THEN
    SELECT NULLIF(full_name, '') INTO v_actor_name
    FROM profiles WHERE user_id = v_actor;
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
  IF v_note IS NOT NULL THEN
    v_body := v_body || ' · ' || v_note;
  END IF;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    actor_user_id, title, body
  ) VALUES (
    NEW.account_id,
    NEW.assigned_agent_id,
    'conversation_assigned',
    NEW.id,
    NEW.contact_id,
    v_actor,
    'Conversa para você',
    v_body
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block the assignment itself.
  RAISE WARNING 'Failed to create assignment notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_conversation_assigned() OWNER TO postgres;
