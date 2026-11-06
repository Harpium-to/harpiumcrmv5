-- ============================================================
-- 055_modo_suporte.sql — the agency working inside a client CRM (Fase 6)
--
-- See docs/plano-plataforma-agencia.md §4 ("Total": operate the CRM
-- with a visible "support mode"). Entering already exists
-- (set_active_account, 049/050, audited as 'enter_account'). This adds:
--
--   1. leave_agency_session() — back to the operator's own CRM (or to
--      none), audited as 'leave_account'.
--   2. Every write the agency makes inside a client CRM is recorded in
--      agencia_auditoria as '<table>_<insert|update|delete>', so the
--      owner reads it in Settings › Acesso da agência. A trigger, not
--      app code: no screen can forget to log.
--
--   Tables covered: contacts, deals, conversations (create/delete —
--   updates are read receipts and assignments, too noisy), messages
--   (sent), automations, flows, broadcasts, pipelines, tags,
--   custom_fields, quick_replies.
--   Not covered: writes made by server routes through the service role
--   (no auth.uid() there) — e.g. sending through the WhatsApp gateway
--   is recorded by the message row, which the app inserts.
--
-- Members' own writes cost one primary-key lookup more per row
-- (is this caller a member?) and are never logged.
--
-- Idempotent — safe to run multiple times.
-- ============================================================


-- ============================================================
-- 1. LEAVE
-- ============================================================
CREATE OR REPLACE FUNCTION public.leave_agency_session()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current UUID;
  v_next UUID;
  v_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_current FROM profiles WHERE user_id = auth.uid();

  -- Not in someone else's CRM through the agency: nothing to leave.
  IF v_current IS NULL OR member_role_in(v_current) IS NOT NULL THEN
    RETURN v_current;
  END IF;

  SELECT n.account_id, n.role INTO v_next, v_role
  FROM next_active_membership(auth.uid(), v_current) n;

  UPDATE profiles
  SET account_id = v_next, account_role = v_role
  WHERE user_id = auth.uid();

  IF EXISTS (SELECT 1 FROM agencia_membros WHERE user_id = auth.uid()) THEN
    INSERT INTO agencia_auditoria (actor_user_id, account_id, action)
    VALUES (auth.uid(), v_current, 'leave_account');
  END IF;

  RETURN v_next;
END;
$$;

ALTER FUNCTION public.leave_agency_session() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.leave_agency_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_agency_session() TO authenticated;


-- ============================================================
-- 2. AUDIT AGENCY WRITES
-- ============================================================
CREATE OR REPLACE FUNCTION public.audit_agency_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row JSONB;
  v_account UUID;
BEGIN
  -- Server routes (service role) and triggers without a session.
  IF v_uid IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_row := to_jsonb(COALESCE(NEW, OLD));
  IF TG_TABLE_NAME = 'messages' THEN
    SELECT account_id INTO v_account FROM conversations
    WHERE id = (v_row->>'conversation_id')::uuid;
  ELSE
    v_account := (v_row->>'account_id')::uuid;
  END IF;

  IF v_account IS NULL OR member_role_in(v_account) IS NOT NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF EXISTS (SELECT 1 FROM agencia_membros WHERE user_id = v_uid) THEN
    INSERT INTO agencia_auditoria (actor_user_id, account_id, action)
    VALUES (v_uid, v_account, TG_TABLE_NAME || '_' || lower(TG_OP));
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

ALTER FUNCTION public.audit_agency_write() OWNER TO postgres;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contacts', 'deals', 'automations', 'flows', 'broadcasts',
    'pipelines', 'tags', 'custom_fields', 'quick_replies'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_agency_write ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER audit_agency_write AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.audit_agency_write()', t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS audit_agency_write ON conversations;
CREATE TRIGGER audit_agency_write
  AFTER INSERT OR DELETE ON conversations
  FOR EACH ROW EXECUTE FUNCTION public.audit_agency_write();

DROP TRIGGER IF EXISTS audit_agency_write ON messages;
CREATE TRIGGER audit_agency_write
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.audit_agency_write();
