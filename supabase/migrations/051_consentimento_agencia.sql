-- ============================================================
-- 051_consentimento_agencia.sql — the client's side of consent (Fase 3)
--
-- See docs/plano-plataforma-agencia.md §4. 049 created the consent
-- level and set_agency_access(); this adds what makes it a real,
-- accountable choice for the CRM owner:
--
--   1. account_agency_access_log — every change of level, by whom and
--      when (also the record that consent was given, for LGPD).
--      Written by a trigger, so no path can change consent unlogged.
--   2. account_agency_access_requests — the agency asks for a level
--      (permanent or for N hours) with a reason; the owner approves or
--      denies. One open request per CRM.
--   3. notifications gets the 'agency_access_request' type, so the
--      owner hears about a request without opening settings.
--   4. RPCs:
--        agencia_request_access          agency → owner
--        decide_agency_access_request    owner approves / denies
--        my_crm_agency_activity          owner/admin read what the
--                                        agency did in their CRM
--
-- Idempotent — safe to run multiple times.
-- ============================================================


-- ============================================================
-- 1. CONSENT HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS account_agency_access_log (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  level         TEXT NOT NULL,
  temp_level    TEXT,
  temp_until    TIMESTAMPTZ,
  terms_version TEXT,
  changed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agency_access_log_account
  ON account_agency_access_log(account_id, created_at DESC);

ALTER TABLE account_agency_access_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_agency_access_log_select ON account_agency_access_log;
CREATE POLICY account_agency_access_log_select ON account_agency_access_log FOR SELECT
  USING (is_account_member(account_id, 'admin') OR is_agencia());

CREATE OR REPLACE FUNCTION public.log_agency_access_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.level IS NOT DISTINCT FROM OLD.level
     AND NEW.temp_level IS NOT DISTINCT FROM OLD.temp_level
     AND NEW.temp_until IS NOT DISTINCT FROM OLD.temp_until THEN
    RETURN NEW;
  END IF;

  INSERT INTO account_agency_access_log (
    account_id, level, temp_level, temp_until, terms_version, changed_by
  ) VALUES (
    NEW.account_id, NEW.level, NEW.temp_level, NEW.temp_until,
    NEW.terms_version, NEW.updated_by
  );
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.log_agency_access_change() OWNER TO postgres;

DROP TRIGGER IF EXISTS log_agency_access_change ON account_agency_access;
CREATE TRIGGER log_agency_access_change
  AFTER INSERT OR UPDATE ON account_agency_access
  FOR EACH ROW EXECUTE FUNCTION public.log_agency_access_change();

-- The levels set before this migration (049 backfill, 050 creations)
-- get their starting entry, dated when they were set.
INSERT INTO account_agency_access_log (
  account_id, level, temp_level, temp_until, terms_version, changed_by, created_at
)
SELECT x.account_id, x.level, x.temp_level, x.temp_until, x.terms_version,
       x.updated_by, x.updated_at
FROM account_agency_access x
WHERE NOT EXISTS (
  SELECT 1 FROM account_agency_access_log l WHERE l.account_id = x.account_id
);


-- ============================================================
-- 2. ACCESS REQUESTS
-- ============================================================
CREATE TABLE IF NOT EXISTS account_agency_access_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  requested_level TEXT NOT NULL CHECK (requested_level IN ('read', 'full')),
  -- NULL = permanent; otherwise a temporary grant of this many hours.
  temp_hours      INT CHECK (temp_hours BETWEEN 1 AND 168),
  reason          TEXT,
  requested_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
  decided_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agency_access_requests_one_pending
  ON account_agency_access_requests(account_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_agency_access_requests_account
  ON account_agency_access_requests(account_id, created_at DESC);

ALTER TABLE account_agency_access_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_agency_access_requests_select ON account_agency_access_requests;
CREATE POLICY account_agency_access_requests_select ON account_agency_access_requests FOR SELECT
  USING (is_account_member(account_id) OR is_agencia());


-- ============================================================
-- 3. NOTIFICATIONS — new type
-- ============================================================
DO $$
DECLARE
  v_name TEXT;
BEGIN
  FOR v_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.notifications'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%conversation_assigned%'
  LOOP
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', v_name);
  END LOOP;

  ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('conversation_assigned', 'agency_access_request'));
END $$;


-- ============================================================
-- 4. RPCs
-- ============================================================

-- The agency asks the CRM owner for a level. Replaces any open
-- request for the same CRM. The owner(s) get a notification.
CREATE OR REPLACE FUNCTION public.agencia_request_access(
  p_account_id UUID,
  p_level TEXT,
  p_reason TEXT DEFAULT NULL,
  p_temp_hours INT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := require_agencia_operator(p_account_id);
  v_name TEXT;
  v_status TEXT;
  v_current TEXT;
  v_request_id UUID;
  v_what TEXT;
BEGIN
  SELECT name, status INTO v_name, v_status FROM accounts WHERE id = p_account_id;
  IF v_name IS NULL OR v_status = 'archived' THEN
    RAISE EXCEPTION 'CRM não encontrado' USING ERRCODE = '22023';
  END IF;

  IF p_level IS NULL OR p_level NOT IN ('read', 'full') THEN
    RAISE EXCEPTION 'Peça Leitura ou Total' USING ERRCODE = '22023';
  END IF;
  IF p_temp_hours IS NOT NULL AND (p_temp_hours < 1 OR p_temp_hours > 168) THEN
    RAISE EXCEPTION 'O acesso temporário dura de 1 a 168 horas' USING ERRCODE = '22023';
  END IF;

  v_current := agency_access_level(p_account_id);
  IF (CASE v_current WHEN 'full' THEN 2 WHEN 'read' THEN 1 ELSE 0 END)
     >= (CASE p_level WHEN 'full' THEN 2 ELSE 1 END) THEN
    RAISE EXCEPTION 'Este CRM já libera esse nível de acesso' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM account_members WHERE account_id = p_account_id AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Este CRM ainda não tem dono para responder ao pedido'
      USING ERRCODE = '22023';
  END IF;

  UPDATE account_agency_access_requests
  SET status = 'cancelled', decided_at = NOW()
  WHERE account_id = p_account_id AND status = 'pending';

  INSERT INTO account_agency_access_requests (
    account_id, requested_level, temp_hours, reason, requested_by
  ) VALUES (
    p_account_id, p_level, p_temp_hours, NULLIF(btrim(p_reason), ''), auth.uid()
  )
  RETURNING id INTO v_request_id;

  INSERT INTO agencia_auditoria (actor_user_id, account_id, action)
  VALUES (auth.uid(), p_account_id, 'request_access');

  v_what := CASE p_level WHEN 'full' THEN 'acesso Total' ELSE 'acesso de Leitura' END
    || CASE WHEN p_temp_hours IS NOT NULL
            THEN ' por ' || p_temp_hours || ' hora' || CASE WHEN p_temp_hours = 1 THEN '' ELSE 's' END
            ELSE '' END;

  INSERT INTO notifications (account_id, user_id, type, actor_user_id, title, body)
  SELECT
    p_account_id,
    m.user_id,
    'agency_access_request',
    auth.uid(),
    'A agência pediu ' || v_what,
    v_name || COALESCE(' · ' || NULLIF(btrim(p_reason), ''), '')
      || ' · Responda em Configurações › Acesso da agência.'
  FROM account_members m
  WHERE m.account_id = p_account_id AND m.role = 'owner';

  RETURN v_request_id;
END;
$$;

ALTER FUNCTION public.agencia_request_access(UUID, TEXT, TEXT, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.agencia_request_access(UUID, TEXT, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agencia_request_access(UUID, TEXT, TEXT, INT) TO authenticated;

-- The owner of the active CRM answers a request. Approving goes
-- through set_agency_access(), so the change is logged like any other.
CREATE OR REPLACE FUNCTION public.decide_agency_access_request(
  p_request_id UUID,
  p_approve BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID := require_active_account();
  v_req account_agency_access_requests%ROWTYPE;
  v_base TEXT;
BEGIN
  SELECT * INTO v_req
  FROM account_agency_access_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_req.account_id <> v_account_id THEN
    RAISE EXCEPTION 'Pedido não encontrado' USING ERRCODE = '22023';
  END IF;
  IF member_role_in(v_account_id) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Só o dono do CRM responde aos pedidos da agência'
      USING ERRCODE = '42501';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Este pedido já foi respondido' USING ERRCODE = '22023';
  END IF;

  IF p_approve THEN
    IF v_req.temp_hours IS NOT NULL THEN
      SELECT level INTO v_base FROM account_agency_access WHERE account_id = v_account_id;
      PERFORM set_agency_access(
        COALESCE(v_base, 'metrics'), v_req.requested_level, v_req.temp_hours, NULL
      );
    ELSE
      PERFORM set_agency_access(v_req.requested_level, NULL, NULL, NULL);
    END IF;
  END IF;

  UPDATE account_agency_access_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'denied' END,
      decided_by = auth.uid(),
      decided_at = NOW()
  WHERE id = p_request_id;
END;
$$;

ALTER FUNCTION public.decide_agency_access_request(UUID, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.decide_agency_access_request(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_agency_access_request(UUID, BOOLEAN) TO authenticated;

-- What the agency did in the caller's active CRM: who, when, what.
-- Owner and admins only. Names the person on the agency team — that is
-- the point of the log.
CREATE OR REPLACE FUNCTION public.my_crm_agency_activity(p_limit INT DEFAULT 100)
RETURNS TABLE (
  created_at TIMESTAMPTZ,
  action TEXT,
  actor_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID := require_active_account();
BEGIN
  IF NOT is_account_member(v_account_id, 'admin') THEN
    RAISE EXCEPTION 'Só o dono e os administradores veem este registro'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    a.created_at,
    a.action,
    COALESCE(NULLIF(m.label, ''), NULLIF(p.full_name, ''), p.email, 'Equipe da agência')
  FROM agencia_auditoria a
  LEFT JOIN agencia_membros m ON m.user_id = a.actor_user_id
  LEFT JOIN profiles p ON p.user_id = a.actor_user_id
  WHERE a.account_id = v_account_id
  ORDER BY a.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
END;
$$;

ALTER FUNCTION public.my_crm_agency_activity(INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.my_crm_agency_activity(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_crm_agency_activity(INT) TO authenticated;
