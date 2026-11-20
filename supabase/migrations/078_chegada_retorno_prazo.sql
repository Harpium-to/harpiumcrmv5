-- ============================================================
-- 078_chegada_retorno_prazo.sql — what happens when a customer
-- writes and nobody is answering, when a customer comes back, and when
-- a conversation sits past its setor's deadline.
--
-- See docs/plano-distribuicao-atendimento.md (§5.5–5.7, Fase 4). Pieces:
--
--   1. inbox_settings — one row per CRM (absent = the defaults):
--        arrival_mode   who gets a new message nobody (no AI, no flow)
--                       is answering: 'fila_geral' (as before), the
--                       CRM-wide 'rodizio', the 'setor_entrada', or
--                       'por_canal' (arrival_by_channel: channel → a
--                       setor id, 'rodizio' or 'fila').
--        return_mode    a customer writing to a closed conversation:
--                       'mesma_pessoa' (the person they talked to in
--                       the last return_days days, if available),
--                       'ia' (start over with the AI) or 'distribuir'.
--   2. conversations.reopened_pending — set when an inbound message
--      (the service role, never a person in the app) reopens a closed
--      conversation; claimed once by claim_reopened() so two messages
--      arriving together apply the return rule once.
--   3. conversations.sla_alerted_at + atendimento_tick() — run by the
--      scheduler (/api/automations/cron): conversations waiting longer
--      than their setor's deadline either warn the CRM's admins (once
--      per owner) or move to the next person of the setor; conversations
--      waiting in a setor's queue go to whoever of it came online.
--      Returns what it moved, so the app fires the "Conversa atribuída"
--      automations and webhook for those too.
--   4. Notification types 'conversation_overdue' and 'conversation_returned'.
--   5. Niche templates (053/067) may bring setores ("teams": name,
--      description, mode, color, is_entry — never people), and the
--      built-in clinic template suggests four.
--
-- Idempotent — safe to run more than once.
-- ============================================================


-- ------------------------------------------------------------
-- 1. The CRM's rules
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inbox_settings (
  account_id         UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  arrival_mode       TEXT NOT NULL DEFAULT 'fila_geral'
                     CHECK (arrival_mode IN ('fila_geral', 'rodizio', 'setor_entrada', 'por_canal')),
  arrival_by_channel JSONB NOT NULL DEFAULT '{}'::jsonb
                     CHECK (jsonb_typeof(arrival_by_channel) = 'object'),
  return_mode        TEXT NOT NULL DEFAULT 'mesma_pessoa'
                     CHECK (return_mode IN ('mesma_pessoa', 'ia', 'distribuir')),
  return_days        INT NOT NULL DEFAULT 7 CHECK (return_days BETWEEN 1 AND 365),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at ON inbox_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON inbox_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE inbox_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inbox_settings_select ON inbox_settings;
CREATE POLICY inbox_settings_select ON inbox_settings FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS inbox_settings_insert ON inbox_settings;
CREATE POLICY inbox_settings_insert ON inbox_settings FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS inbox_settings_update ON inbox_settings;
CREATE POLICY inbox_settings_update ON inbox_settings FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));


-- ------------------------------------------------------------
-- 2. A customer reopening a closed conversation
-- ------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS reopened_pending BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sla_alerted_at TIMESTAMPTZ;

COMMENT ON COLUMN conversations.reopened_pending IS
  'An inbound message reopened this closed conversation and the return rule (078) has not run yet.';
COMMENT ON COLUMN conversations.sla_alerted_at IS
  'When the setor deadline (078) last warned about this conversation; compared with assigned_at.';

CREATE OR REPLACE FUNCTION public.conversations_mark_reopened()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only an inbound message (the service role) counts: a person
  -- reopening it in the inbox is already there.
  IF OLD.status = 'closed' AND NEW.status <> 'closed' AND auth.uid() IS NULL THEN
    NEW.reopened_pending := true;
  ELSIF NEW.status = 'closed' THEN
    NEW.reopened_pending := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mark_reopened ON conversations;
CREATE TRIGGER mark_reopened
  BEFORE UPDATE OF status ON conversations
  FOR EACH ROW EXECUTE FUNCTION conversations_mark_reopened();

-- Claim the pending return once. Returns what the rule needs, or no
-- row when there is nothing to do (or another message got it first).
CREATE OR REPLACE FUNCTION public.claim_reopened(p_conversation_id UUID)
RETURNS TABLE (
  account_id UUID,
  contact_id UUID,
  assigned_agent_id UUID,
  team_id UUID,
  channel TEXT,
  last_human_at TIMESTAMPTZ,
  owner_available BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    UPDATE conversations c
       SET reopened_pending = false
     WHERE c.id = p_conversation_id
       AND c.reopened_pending
    RETURNING c.*
  )
  SELECT cl.account_id,
         cl.contact_id,
         cl.assigned_agent_id,
         cl.team_id,
         COALESCE(to_jsonb(cl) ->> 'channel', 'whatsapp'),
         (SELECT max(m.created_at) FROM messages m
           WHERE m.conversation_id = cl.id
             AND m.sender_type = 'agent'
             AND COALESCE(m.ai_generated, false) = false),
         CASE WHEN cl.assigned_agent_id IS NULL THEN false ELSE EXISTS (
           SELECT 1
             FROM account_members am
             LEFT JOIN member_presence mp ON mp.user_id = am.user_id
            WHERE am.account_id = cl.account_id
              AND am.user_id = cl.assigned_agent_id
              AND am.role <> 'viewer'
              AND am.receives_conversations
              AND mp.status = 'online'
              AND mp.last_seen_at > now() - INTERVAL '75 seconds'
              AND mp.account_id = cl.account_id
         ) END
    FROM claimed cl;
END;
$$;

ALTER FUNCTION public.claim_reopened(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_reopened(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reopened(UUID) TO service_role;


-- ------------------------------------------------------------
-- 3. Deadlines and the setor queues
-- ------------------------------------------------------------
-- needs_human_since comes from 058, which some databases got last.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'conversations'
       AND column_name = 'needs_human_since'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_conversations_waiting_owned
      ON conversations (account_id, needs_human_since)
      WHERE needs_human_since IS NOT NULL AND assigned_agent_id IS NOT NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.atendimento_tick(p_limit INT DEFAULT 200)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        RECORD;
  v_next   UUID;
  v_moved  JSONB := '[]'::jsonb;
  v_alerts INT := 0;
  v_contact TEXT;
BEGIN
  -- a) Past the deadline: waiting for a person, owned, in a setor with
  --    a deadline, not yet warned about since the current owner got it.
  FOR r IN
    SELECT c.id, c.account_id, c.contact_id, c.assigned_agent_id, c.team_id,
           t.name AS team_name, t.sla_minutes, t.sla_action
      FROM conversations c
      JOIN teams t ON t.id = c.team_id
     WHERE c.status <> 'closed'
       AND c.assigned_agent_id IS NOT NULL
       AND c.needs_human_since IS NOT NULL
       AND t.active
       AND t.sla_minutes IS NOT NULL
       AND GREATEST(c.needs_human_since, COALESCE(c.assigned_at, c.needs_human_since))
           < now() - make_interval(mins => t.sla_minutes)
       AND (c.sla_alerted_at IS NULL OR c.sla_alerted_at < COALESCE(c.assigned_at, c.needs_human_since))
     ORDER BY c.needs_human_since
     LIMIT p_limit
     FOR UPDATE OF c SKIP LOCKED
  LOOP
    v_next := NULL;
    IF r.sla_action = 'proximo' THEN
      v_next := pick_next_attendant(r.account_id, r.team_id, r.assigned_agent_id);
    END IF;

    IF v_next IS NOT NULL THEN
      PERFORM set_config('harpium.transfer_source', 'prazo', true);
      PERFORM set_config('harpium.transfer_note',
        'Sem resposta em ' || r.sla_minutes || ' min', true);
      PERFORM set_config('harpium.transfer_actor', '', true);
      -- assigned_at restarts with the new owner (076), so the new
      -- owner gets a deadline of their own.
      UPDATE conversations
         SET assigned_agent_id = v_next,
             updated_at = now()
       WHERE id = r.id;
      PERFORM set_config('harpium.transfer_source', '', true);
      PERFORM set_config('harpium.transfer_note', '', true);
      v_moved := v_moved || jsonb_build_array(jsonb_build_object(
        'conversation_id', r.id, 'account_id', r.account_id, 'contact_id', r.contact_id,
        'from_user_id', r.assigned_agent_id, 'to_user_id', v_next, 'team_id', r.team_id,
        'source', 'prazo'));
    ELSE
      SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact FROM contacts WHERE id = r.contact_id;
      INSERT INTO notifications (account_id, user_id, type, conversation_id, contact_id, title, body)
      SELECT r.account_id, am.user_id, 'conversation_overdue', r.id, r.contact_id,
             'Conversa passou do prazo',
             'A conversa com ' || COALESCE(v_contact, 'um contato') || ' está sem resposta há mais de '
               || r.sla_minutes || ' min · ' || r.team_name
        FROM account_members am
       WHERE am.account_id = r.account_id
         AND (am.role IN ('owner', 'admin') OR am.user_id = r.assigned_agent_id);
      UPDATE conversations SET sla_alerted_at = now() WHERE id = r.id;
      v_alerts := v_alerts + 1;
    END IF;
  END LOOP;

  -- b) Setor queues: conversations waiting without an owner in a setor
  --    that picks people, now that someone of it may be available.
  FOR r IN
    SELECT c.id, c.account_id, c.contact_id, c.team_id
      FROM conversations c
      JOIN teams t ON t.id = c.team_id
     WHERE c.status <> 'closed'
       AND c.assigned_agent_id IS NULL
       AND t.active
       AND t.mode <> 'fila'
     ORDER BY COALESCE(c.needs_human_since, c.updated_at)
     LIMIT p_limit
     FOR UPDATE OF c SKIP LOCKED
  LOOP
    v_next := pick_next_attendant(r.account_id, r.team_id, NULL);
    CONTINUE WHEN v_next IS NULL;
    PERFORM set_config('harpium.transfer_source', 'rodizio', true);
    PERFORM set_config('harpium.transfer_note', '', true);
    PERFORM set_config('harpium.transfer_actor', '', true);
    UPDATE conversations SET assigned_agent_id = v_next, updated_at = now() WHERE id = r.id;
    PERFORM set_config('harpium.transfer_source', '', true);
    v_moved := v_moved || jsonb_build_array(jsonb_build_object(
      'conversation_id', r.id, 'account_id', r.account_id, 'contact_id', r.contact_id,
      'from_user_id', NULL, 'to_user_id', v_next, 'team_id', r.team_id,
      'source', 'rodizio'));
  END LOOP;

  RETURN jsonb_build_object('alerted', v_alerts, 'moved', v_moved);
END;
$$;

ALTER FUNCTION public.atendimento_tick(INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.atendimento_tick(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atendimento_tick(INT) TO service_role;


-- ------------------------------------------------------------
-- 4. Notification types
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

  v_types := v_types || ARRAY['conversation_assigned', 'conversation_overdue', 'conversation_returned'];

  EXECUTE format(
    'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (%s))',
    (SELECT string_agg(quote_literal(t), ', ' ORDER BY t)
     FROM (SELECT DISTINCT unnest(v_types) AS t) AS distinct_types)
  );
END $$;


-- ------------------------------------------------------------
-- 5. Setores in niche templates
--
-- A template's content may carry "teams":
--   { "name": "Financeiro", "description": "boletos, parcelamento",
--     "mode": "rodizio", "color": "#10b981", "is_entry": false }
-- Like everything a template brings, a setor whose name the CRM already
-- has is left as it is. People are never part of a template: the
-- agency puts them in after applying it.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_crm_template_teams(
  p_account_id UUID,
  p_content    JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item     JSONB;
  v_name     TEXT;
  v_code     TEXT;
  v_n        INT;
  v_created  INT := 0;
  v_skipped  INT := 0;
  v_position INT;
BEGIN
  SELECT COALESCE(max(position) + 1, 0) INTO v_position FROM teams WHERE account_id = p_account_id;

  FOR v_item IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_content -> 'teams', '[]'::jsonb))
  LOOP
    v_name := btrim(COALESCE(v_item ->> 'name', ''));
    IF v_name = '' OR EXISTS (
      SELECT 1 FROM teams WHERE account_id = p_account_id AND lower(name) = lower(v_name)
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- The same code the app makes from a name (slugifyTeamCode), unique in the CRM.
    v_code := left(btrim(regexp_replace(
      lower(translate(v_name,
        'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
        'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')),
      '[^a-z0-9]+', '-', 'g'), '-'), 40);
    IF v_code = '' THEN v_code := 'setor'; END IF;
    v_n := 1;
    WHILE EXISTS (SELECT 1 FROM teams WHERE account_id = p_account_id AND code = v_code) LOOP
      v_n := v_n + 1;
      v_code := left(regexp_replace(v_code, '-[0-9]+$', ''), 36) || '-' || v_n;
    END LOOP;

    INSERT INTO teams (account_id, name, code, description, color, mode, is_entry, position)
    VALUES (
      p_account_id,
      left(v_name, 60),
      v_code,
      NULLIF(left(btrim(COALESCE(v_item ->> 'description', '')), 500), ''),
      CASE WHEN COALESCE(v_item ->> 'color', '') ~ '^#[0-9a-fA-F]{6}$' THEN v_item ->> 'color' ELSE '#6366f1' END,
      CASE WHEN v_item ->> 'mode' IN ('rodizio', 'menos_ocupado', 'fila') THEN v_item ->> 'mode' ELSE 'rodizio' END,
      -- One entry setor per CRM: only when the CRM has none yet.
      COALESCE((v_item ->> 'is_entry')::BOOLEAN, false)
        AND NOT EXISTS (SELECT 1 FROM teams WHERE account_id = p_account_id AND is_entry),
      v_position
    );
    v_position := v_position + 1;
    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object('teams', v_created, 'skipped', v_skipped);
END;
$$;

ALTER FUNCTION public.apply_crm_template_teams(UUID, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_crm_template_teams(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- agencia_apply_template (053, 067), unchanged except that it also
-- creates the template's setores and counts them in the summary.
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
  v_teams JSONB;
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
  v_teams := apply_crm_template_teams(p_account_id, v_tpl.content);
  v_summary := v_summary || jsonb_build_object(
    'calendars', (v_calendars ->> 'calendars')::INT,
    'teams', (v_teams ->> 'teams')::INT,
    'skipped', (v_summary ->> 'skipped')::INT
               + (v_calendars ->> 'skipped')::INT
               + (v_teams ->> 'skipped')::INT
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

-- The built-in clinic template suggests setores — unless someone has
-- already given it setores of their own.
UPDATE crm_templates
SET content = content || $json${
  "teams": [
    { "name": "Recepção", "color": "#6366f1", "mode": "rodizio", "is_entry": true,
      "description": "dúvidas gerais, horário, endereço, convênios aceitos, primeira consulta" },
    { "name": "Agendamento", "color": "#0ea5e9", "mode": "rodizio",
      "description": "marcar, remarcar ou cancelar consulta, encaixe, confirmação de horário" },
    { "name": "Financeiro", "color": "#10b981", "mode": "rodizio",
      "description": "boletos, pagamentos, parcelamento, nota fiscal, reembolso, valores em aberto" },
    { "name": "Orçamentos", "color": "#f59e0b", "mode": "menos_ocupado",
      "description": "preço de tratamentos e procedimentos, orçamento, condições de pagamento antes de fechar" }
  ]
}$json$::jsonb
WHERE slug = 'clinica-medica'
  AND NOT (content ? 'teams');
