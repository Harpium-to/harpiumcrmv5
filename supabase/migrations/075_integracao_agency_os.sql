-- ============================================================
-- 075_integracao_agency_os.sql — the platform API the agency's
-- internal system (Agency OS) reads the CRM through.
--
-- See docs/plano-integracao-agency-os.md (§5, Fase 1). Four pieces:
--
--   1. platform_api_keys — keys of the PLATFORM (not of one CRM), made
--      by a super_admin in /agencia/integracoes. Only the SHA-256 is
--      stored. No policies: the service role is the only reader, like
--      the rest of the agency console.
--   2. platform_user_id_by_email() — the person a request speaks for
--      (header X-Harpium-Pessoa). Exact, case-insensitive match on
--      auth.users; service role only.
--   3. platform_effective_role(user, account) — what THAT person may do
--      in THAT CRM. A faithful copy of effective_role_in (049) with the
--      agency_role_in of 050 (a manager only gets 'full' in the CRMs of
--      their portfolio), with auth.uid() swapped for a parameter.
--      supabase/tests/plataforma.test.ts checks both always agree.
--   4. agencia_auditoria.origem / .detalhe — where an access came from
--      ('crm' = the console, 'agency_os' = the platform API), so the
--      CRM owner sees "pelo sistema da agência" in their log.
--
-- Idempotent — safe to run more than once.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Platform keys
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_api_keys (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  key_prefix   TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  scopes       TEXT[] NOT NULL DEFAULT '{}',
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

ALTER TABLE platform_api_keys ENABLE ROW LEVEL SECURITY;
-- No policy on purpose: anon and authenticated read nothing.
REVOKE ALL ON platform_api_keys FROM anon, authenticated;

-- ------------------------------------------------------------
-- 2. E-mail → user
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_user_id_by_email(p_email TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.id
  FROM auth.users u
  WHERE p_email IS NOT NULL
    AND lower(u.email) = lower(trim(p_email))
  ORDER BY u.created_at
  LIMIT 1;
$$;

ALTER FUNCTION public.platform_user_id_by_email(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.platform_user_id_by_email(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_user_id_by_email(TEXT) TO service_role;

-- ------------------------------------------------------------
-- 3. One person's effective role in one CRM
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_effective_role(p_user_id UUID, p_account_id UUID)
RETURNS account_role_enum
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member account_role_enum;
  v_agency account_role_enum;
  v_platform_role TEXT;
  v_level TEXT;
  v_manager UUID;
BEGIN
  IF p_user_id IS NULL OR p_account_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- member_role_in (049)
  SELECT role INTO v_member
  FROM account_members
  WHERE account_id = p_account_id
    AND user_id = p_user_id;

  -- agency_role_in (050)
  SELECT role INTO v_platform_role
  FROM agencia_membros
  WHERE user_id = p_user_id;

  IF v_platform_role IS NOT NULL THEN
    v_level := agency_access_level(p_account_id);
    IF v_level = 'full' THEN
      IF v_platform_role = 'super_admin' THEN
        v_agency := 'admin';
      ELSIF v_platform_role = 'manager' THEN
        SELECT manager_user_id INTO v_manager FROM accounts WHERE id = p_account_id;
        IF v_manager = p_user_id THEN
          v_agency := 'admin';
        ELSE
          v_agency := 'viewer';
        END IF;
      ELSE
        v_agency := 'viewer';
      END IF;
    ELSIF v_level = 'read' THEN
      v_agency := 'viewer';
    END IF;
  END IF;

  -- effective_role_in (049): the higher of the two
  IF account_role_rank(v_agency) > account_role_rank(v_member) THEN
    RETURN v_agency;
  END IF;
  RETURN v_member;
END;
$$;

ALTER FUNCTION public.platform_effective_role(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.platform_effective_role(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_effective_role(UUID, UUID) TO service_role;

-- ------------------------------------------------------------
-- 4. Where an agency access came from
-- ------------------------------------------------------------
ALTER TABLE agencia_auditoria
  ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'crm'
    CHECK (origem IN ('crm', 'agency_os'));
ALTER TABLE agencia_auditoria
  ADD COLUMN IF NOT EXISTS detalhe TEXT;

-- The "at most once per 30 min" check of the platform API reads the
-- latest row of one person + CRM + action.
CREATE INDEX IF NOT EXISTS idx_agencia_auditoria_actor_account_created
  ON agencia_auditoria(actor_user_id, account_id, created_at DESC);
