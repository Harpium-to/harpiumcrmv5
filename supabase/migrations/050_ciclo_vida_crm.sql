-- ============================================================
-- 050_ciclo_vida_crm.sql — CRM lifecycle (Fase 2)
--
-- See docs/plano-plataforma-agencia.md §5. Builds on 049.
--
-- What changes
--   1. accounts gets platform fields: status (onboarding / active /
--      suspended / archived), niche, created_by, manager_user_id
--      (the agency manager responsible — their "portfolio"), notes.
--      A client session can't change them (trigger), not even an
--      admin of that CRM.
--   2. Status is enforced where everything else is: is_account_member.
--        suspended → read-only for everyone (members and agency)
--        archived  → invisible to everyone; the console reads it
--                    through the service role
--      Archiving moves people whose active CRM it was to another one.
--   3. Managers only operate (admin) the CRMs in their portfolio;
--      elsewhere a full grant gives them read-only, like support.
--   4. Invitations can be bound to an email. A bound invitation can
--      only be redeemed by that email, and shows up for that person
--      inside the app (my_pending_invitations / accept_my_invitation)
--      so a signup waiting for access doesn't need the link at all.
--   5. The agency creates CRMs (agencia_create_account), re-invites an
--      owner (agencia_invite_owner) and updates platform fields
--      (agencia_update_account) — each checked against agencia_role()
--      and written to agencia_auditoria.
--   6. redeem_invitation only discards the caller's previous CRM when
--      they OWN it by membership. 049 used accounts.owner_user_id,
--      which for an agency-created CRM is the agency placeholder
--      until the client accepts (see §5).
--
-- Why an agency-created CRM has owner_user_id = its creator
--   Webhooks (WhatsApp, Instagram, lead ingest) attribute the rows
--   they create to accounts.owner_user_id, and those user_id columns
--   are NOT NULL. Until the client accepts the owner invitation the
--   creator stands in; redeeming it moves owner_user_id to the client.
--   The placeholder is a pointer, not a membership: it grants nothing.
--
-- Idempotent — safe to run multiple times.
-- ============================================================


-- ============================================================
-- 1. ACCOUNTS — platform fields
-- ============================================================
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS niche TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS manager_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounts_status_check'
      AND conrelid = 'public.accounts'::regclass
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_status_check
      CHECK (status IN ('onboarding', 'active', 'suspended', 'archived'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_manager ON accounts(manager_user_id);

-- accounts_update (017) lets a CRM's admins update the row — right for
-- name and currency, wrong for these. Same pattern as 034 on profiles.
CREATE OR REPLACE FUNCTION public.enforce_account_platform_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND (
       NEW.status            IS DISTINCT FROM OLD.status
    OR NEW.niche             IS DISTINCT FROM OLD.niche
    OR NEW.created_by        IS DISTINCT FROM OLD.created_by
    OR NEW.manager_user_id   IS DISTINCT FROM OLD.manager_user_id
    OR NEW.notes             IS DISTINCT FROM OLD.notes
    OR NEW.status_changed_at IS DISTINCT FROM OLD.status_changed_at
    OR NEW.owner_user_id     IS DISTINCT FROM OLD.owner_user_id
  ) THEN
    RAISE EXCEPTION 'Estes campos do CRM são administrados pela agência'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_account_platform_columns() OWNER TO postgres;

DROP TRIGGER IF EXISTS enforce_account_platform_columns ON accounts;
CREATE TRIGGER enforce_account_platform_columns
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_account_platform_columns();


-- ============================================================
-- 2. ACTIVE-CRM BOOKKEEPING skips archived CRMs
-- ============================================================

-- The membership a user lands on when their active CRM goes away.
CREATE OR REPLACE FUNCTION public.next_active_membership(
  p_user_id UUID,
  p_excluding UUID
) RETURNS TABLE (account_id UUID, role account_role_enum)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.account_id, m.role
  FROM account_members m
  JOIN accounts a ON a.id = m.account_id
  WHERE m.user_id = p_user_id
    AND m.account_id <> p_excluding
    AND a.status <> 'archived'
  ORDER BY m.created_at DESC
  LIMIT 1;
$$;

ALTER FUNCTION public.next_active_membership(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.next_active_membership(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Move everyone whose active CRM is p_account_id somewhere else.
CREATE OR REPLACE FUNCTION public.move_active_away_from(p_account_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_next UUID;
  v_role account_role_enum;
BEGIN
  FOR r IN SELECT user_id FROM profiles WHERE account_id = p_account_id LOOP
    v_next := NULL;
    v_role := NULL;
    SELECT n.account_id, n.role INTO v_next, v_role
    FROM next_active_membership(r.user_id, p_account_id) n;

    UPDATE profiles
    SET account_id = v_next, account_role = v_role
    WHERE user_id = r.user_id;
  END LOOP;
END;
$$;

ALTER FUNCTION public.move_active_away_from(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.move_active_away_from(UUID) FROM PUBLIC, anon, authenticated;

-- 049's triggers, now skipping archived CRMs when picking the next one.
CREATE OR REPLACE FUNCTION public.sync_profile_from_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next UUID;
  v_role account_role_enum;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM profiles
      WHERE user_id = OLD.user_id AND account_id = OLD.account_id
    ) THEN
      SELECT n.account_id, n.role INTO v_next, v_role
      FROM next_active_membership(OLD.user_id, OLD.account_id) n;

      UPDATE profiles
      SET account_id = v_next, account_role = v_role
      WHERE user_id = OLD.user_id;
    END IF;
    RETURN OLD;
  END IF;

  UPDATE profiles
  SET account_role = NEW.role
  WHERE user_id = NEW.user_id
    AND account_id = NEW.account_id
    AND account_role IS DISTINCT FROM NEW.role;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reassign_active_before_account_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM move_active_away_from(OLD.id);
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.move_active_on_archive()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'archived' AND OLD.status IS DISTINCT FROM 'archived' THEN
    PERFORM move_active_away_from(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.move_active_on_archive() OWNER TO postgres;

DROP TRIGGER IF EXISTS move_active_on_archive ON accounts;
CREATE TRIGGER move_active_on_archive
  AFTER UPDATE OF status ON accounts
  FOR EACH ROW EXECUTE FUNCTION public.move_active_on_archive();


-- ============================================================
-- 3. ACCESS RULES — status and the manager's portfolio
-- ============================================================
CREATE OR REPLACE FUNCTION public.agency_role_in(p_account_id UUID)
RETURNS account_role_enum
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_platform_role TEXT;
  v_level TEXT;
  v_manager UUID;
BEGIN
  IF auth.uid() IS NULL OR p_account_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT role INTO v_platform_role
  FROM agencia_membros
  WHERE user_id = auth.uid();

  IF v_platform_role IS NULL THEN
    RETURN NULL;
  END IF;

  v_level := agency_access_level(p_account_id);

  IF v_level = 'full' THEN
    IF v_platform_role = 'super_admin' THEN
      RETURN 'admin';
    END IF;
    IF v_platform_role = 'manager' THEN
      SELECT manager_user_id INTO v_manager FROM accounts WHERE id = p_account_id;
      IF v_manager = auth.uid() THEN
        RETURN 'admin';
      END IF;
    END IF;
    RETURN 'viewer';
  END IF;

  IF v_level = 'read' THEN
    RETURN 'viewer';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_status TEXT;
BEGIN
  IF v_uid IS NULL OR target_account_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Only the ACTIVE CRM is ever visible.
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = v_uid AND account_id = target_account_id
  ) THEN
    RETURN FALSE;
  END IF;

  SELECT status INTO v_status FROM accounts WHERE id = target_account_id;
  IF v_status = 'archived' THEN
    RETURN FALSE;
  END IF;
  IF v_status = 'suspended' AND account_role_rank(min_role) > account_role_rank('viewer') THEN
    RETURN FALSE;
  END IF;

  RETURN account_role_rank(effective_role_in(target_account_id))
      >= account_role_rank(min_role);
END;
$$;

-- Context now carries the status; archived means no context.
CREATE OR REPLACE FUNCTION public.current_account_context()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_member account_role_enum;
  v_agency account_role_enum;
  v_role account_role_enum;
  v_name TEXT;
  v_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT account_id INTO v_account_id
  FROM profiles WHERE user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT name, status INTO v_name, v_status
  FROM accounts WHERE id = v_account_id;

  IF v_status IS NULL OR v_status = 'archived' THEN
    RETURN NULL;
  END IF;

  v_member := member_role_in(v_account_id);
  v_agency := agency_role_in(v_account_id);
  v_role := effective_role_in(v_account_id);

  IF v_role IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'account_id', v_account_id,
    'account_name', v_name,
    'role', v_role,
    'status', v_status,
    'via_agency', account_role_rank(v_agency) > account_role_rank(v_member)
  );
END;
$$;

-- list_my_accounts gains the status and drops archived CRMs. The
-- return type changes, so it has to be dropped first.
DROP FUNCTION IF EXISTS public.list_my_accounts();
CREATE FUNCTION public.list_my_accounts()
RETURNS TABLE (
  account_id UUID,
  account_name TEXT,
  role account_role_enum,
  status TEXT,
  is_active BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    a.name,
    m.role,
    a.status,
    a.id = (SELECT p.account_id FROM profiles p WHERE p.user_id = auth.uid())
  FROM account_members m
  JOIN accounts a ON a.id = m.account_id
  WHERE m.user_id = auth.uid()
    AND a.status <> 'archived'
  ORDER BY a.name;
$$;

ALTER FUNCTION public.list_my_accounts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_my_accounts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_accounts() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_active_account(p_account_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member account_role_enum;
  v_role account_role_enum;
  v_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status FROM accounts WHERE id = p_account_id;
  IF v_status = 'archived' THEN
    RAISE EXCEPTION 'Este CRM foi arquivado' USING ERRCODE = '42501';
  END IF;

  v_member := member_role_in(p_account_id);
  v_role := effective_role_in(p_account_id);

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Você não tem acesso a este CRM' USING ERRCODE = '42501';
  END IF;

  UPDATE profiles
  SET account_id = p_account_id,
      account_role = v_role
  WHERE user_id = auth.uid();

  IF account_role_rank(agency_role_in(p_account_id)) > account_role_rank(v_member) THEN
    INSERT INTO agencia_auditoria (actor_user_id, account_id, action)
    VALUES (auth.uid(), p_account_id, 'enter_account');
  END IF;
END;
$$;


-- ============================================================
-- 4. EMAIL-BOUND INVITATIONS
-- ============================================================
ALTER TABLE account_invitations ADD COLUMN IF NOT EXISTS email TEXT;

CREATE INDEX IF NOT EXISTS idx_account_invitations_email_pending
  ON account_invitations (lower(email))
  WHERE accepted_at IS NULL AND email IS NOT NULL;

-- The caller's login email (auth is the source of truth; the profile
-- copy is the fallback).
CREATE OR REPLACE FUNCTION public.caller_email()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(COALESCE(
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    (SELECT email FROM profiles WHERE user_id = auth.uid())
  ));
$$;

ALTER FUNCTION public.caller_email() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.caller_email() TO authenticated;

-- "ma***@gmail.com" — enough to recognise, not to harvest.
CREATE OR REPLACE FUNCTION public.mask_email(p_email TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_email IS NULL OR position('@' IN p_email) = 0 THEN NULL
    ELSE left(split_part(p_email, '@', 1), 2) || '***@' || split_part(p_email, '@', 2)
  END;
$$;

-- peek_invitation (019) + who it is for, and what the agency will see
-- when it is an owner invitation. Anonymous visitors can call it, so
-- the email is masked.
CREATE OR REPLACE FUNCTION public.peek_invitation(
  p_token_hash TEXT
) RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv account_invitations%ROWTYPE;
  v_account_name TEXT;
  v_status TEXT;
BEGIN
  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'used');
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'reason', 'expired');
  END IF;

  SELECT name, status INTO v_account_name, v_status
  FROM accounts WHERE id = v_inv.account_id;

  IF v_status = 'archived' THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'account_name', v_account_name,
    'role', v_inv.role,
    'expires_at', v_inv.expires_at,
    'email_hint', mask_email(v_inv.email),
    'agency_level', CASE WHEN v_inv.role = 'owner'
                         THEN agency_access_level(v_inv.account_id)
                    END
  );
END;
$$;

ALTER FUNCTION public.peek_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.peek_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_invitation(TEXT) TO anon, authenticated;

-- The redeem logic, shared by the link (token) and the in-app
-- "accept" (id). Not callable from a session: both entry points
-- check their own preconditions first.
CREATE OR REPLACE FUNCTION public.redeem_invitation_row(p_invitation_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_is_disposable BOOLEAN := FALSE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Não autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite não encontrado' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este convite já foi usado' USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Este convite expirou' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM accounts WHERE id = v_inv.account_id AND status = 'archived'
  ) THEN
    RAISE EXCEPTION 'Convite não encontrado' USING ERRCODE = '22023';
  END IF;

  IF v_inv.email IS NOT NULL AND lower(v_inv.email) IS DISTINCT FROM caller_email() THEN
    RAISE EXCEPTION 'Este convite é para outro e-mail (%). Entre com ele para aceitar.',
      mask_email(v_inv.email)
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = v_caller_id) THEN
    RAISE EXCEPTION 'Perfil não encontrado' USING ERRCODE = '42501';
  END IF;

  IF v_inv.role <> 'owner' AND EXISTS (
    SELECT 1 FROM account_members
    WHERE account_id = v_inv.account_id AND user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Você já é membro deste CRM' USING ERRCODE = '23505';
  END IF;

  -- The CRM on the caller's screen is discarded only if it is an
  -- untouched personal CRM: owned by them BY MEMBERSHIP (not by the
  -- owner_user_id pointer, which an agency placeholder also matches),
  -- nobody else in it, no data.
  SELECT account_id INTO v_old_account_id
  FROM profiles WHERE user_id = v_caller_id;

  IF v_old_account_id IS NOT NULL AND v_old_account_id <> v_inv.account_id THEN
    SELECT
      EXISTS (
        SELECT 1 FROM account_members m
        WHERE m.account_id = v_old_account_id
          AND m.user_id = v_caller_id
          AND m.role = 'owner'
      )
      AND NOT EXISTS (
        SELECT 1 FROM account_members m
        WHERE m.account_id = v_old_account_id AND m.user_id <> v_caller_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM contacts WHERE account_id = v_old_account_id
        UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
        UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
        UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
        UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
        UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
        UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
        UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
        UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
        UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
        UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
        LIMIT 1
      )
    INTO v_old_is_disposable;
  END IF;

  IF v_inv.role = 'owner' THEN
    UPDATE account_members SET role = 'admin'
    WHERE account_id = v_inv.account_id
      AND role = 'owner'
      AND user_id <> v_caller_id;

    INSERT INTO account_members (account_id, user_id, role)
    VALUES (v_inv.account_id, v_caller_id, 'owner')
    ON CONFLICT (account_id, user_id) DO UPDATE SET role = 'owner';

    UPDATE accounts SET owner_user_id = v_caller_id
    WHERE id = v_inv.account_id;
  ELSE
    INSERT INTO account_members (account_id, user_id, role)
    VALUES (v_inv.account_id, v_caller_id, v_inv.role);
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  IF COALESCE(v_old_is_disposable, FALSE) THEN
    DELETE FROM accounts WHERE id = v_old_account_id;
  END IF;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation_row(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation_row(UUID) FROM PUBLIC, anon, authenticated;

-- By link (token), as before.
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_id
  FROM account_invitations
  WHERE token_hash = p_token_hash;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Convite não encontrado' USING ERRCODE = '22023';
  END IF;

  RETURN redeem_invitation_row(v_id);
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;

-- Invitations addressed to the caller's email, still open.
CREATE OR REPLACE FUNCTION public.my_pending_invitations()
RETURNS TABLE (
  invitation_id UUID,
  account_name TEXT,
  role account_role_enum,
  expires_at TIMESTAMPTZ,
  agency_level TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.id,
    a.name,
    i.role,
    i.expires_at,
    CASE WHEN i.role = 'owner' THEN agency_access_level(i.account_id) END
  FROM account_invitations i
  JOIN accounts a ON a.id = i.account_id
  WHERE i.email IS NOT NULL
    AND lower(i.email) = caller_email()
    AND i.accepted_at IS NULL
    AND i.expires_at > NOW()
    AND a.status <> 'archived'
    AND NOT EXISTS (
      SELECT 1 FROM account_members m
      WHERE m.account_id = i.account_id
        AND m.user_id = auth.uid()
        AND (i.role <> 'owner' OR m.role = 'owner')
    )
  ORDER BY i.created_at DESC;
$$;

ALTER FUNCTION public.my_pending_invitations() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.my_pending_invitations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_pending_invitations() TO authenticated;

-- Accept one of the above without the link. Only email-bound
-- invitations: an unbound one is a bearer link and stays that way.
CREATE OR REPLACE FUNCTION public.accept_my_invitation(p_invitation_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_email
  FROM account_invitations WHERE id = p_invitation_id;

  IF v_email IS NULL OR lower(v_email) IS DISTINCT FROM caller_email() THEN
    RAISE EXCEPTION 'Convite não encontrado' USING ERRCODE = '22023';
  END IF;

  RETURN redeem_invitation_row(p_invitation_id);
END;
$$;

ALTER FUNCTION public.accept_my_invitation(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.accept_my_invitation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_my_invitation(UUID) TO authenticated;


-- ============================================================
-- 5. AGENCY ACTIONS
-- ============================================================

-- Raises unless the caller is super_admin, or a manager and
-- (when p_account_id is given) that CRM is in their portfolio.
CREATE OR REPLACE FUNCTION public.require_agencia_operator(p_account_id UUID DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := agencia_role();
BEGIN
  IF v_role = 'super_admin' THEN
    RETURN v_role;
  END IF;
  IF v_role = 'manager' THEN
    IF p_account_id IS NULL OR EXISTS (
      SELECT 1 FROM accounts
      WHERE id = p_account_id AND manager_user_id = auth.uid()
    ) THEN
      RETURN v_role;
    END IF;
    RAISE EXCEPTION 'Este CRM não está na sua carteira' USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION 'Seu papel na agência não permite esta ação' USING ERRCODE = '42501';
END;
$$;

ALTER FUNCTION public.require_agencia_operator(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.require_agencia_operator(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_valid_email(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_email IS NOT NULL
     AND p_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
$$;

-- Creates a CRM in onboarding with an owner invitation bound to
-- p_owner_email. The plaintext token is made by the server and only
-- its hash comes here (same as every invitation). Returns the id.
CREATE OR REPLACE FUNCTION public.agencia_create_account(
  p_name TEXT,
  p_owner_email TEXT,
  p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ,
  p_niche TEXT DEFAULT NULL,
  p_access_level TEXT DEFAULT 'metrics',
  p_manager_user_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := require_agencia_operator(NULL);
  v_manager UUID := p_manager_user_id;
  v_account_id UUID;
BEGIN
  IF NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Dê um nome ao CRM' USING ERRCODE = '22023';
  END IF;
  IF NOT is_valid_email(btrim(p_owner_email)) THEN
    RAISE EXCEPTION 'E-mail do dono inválido' USING ERRCODE = '22023';
  END IF;
  IF p_access_level NOT IN ('metrics', 'read', 'full') THEN
    RAISE EXCEPTION 'Nível de acesso inválido' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(p_token_hash, '') IS NULL OR p_expires_at IS NULL OR p_expires_at <= NOW() THEN
    RAISE EXCEPTION 'Convite inválido' USING ERRCODE = '22023';
  END IF;

  -- A manager's new CRM is in their own portfolio.
  IF v_role = 'manager' THEN
    v_manager := auth.uid();
  END IF;
  IF v_manager IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM agencia_membros
    WHERE user_id = v_manager AND role IN ('super_admin', 'manager')
  ) THEN
    RAISE EXCEPTION 'O responsável precisa ser gestor ou super admin da agência'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO accounts (
    name, owner_user_id, status, niche, created_by, manager_user_id,
    notes, status_changed_at
  ) VALUES (
    btrim(p_name), auth.uid(), 'onboarding', NULLIF(btrim(p_niche), ''),
    auth.uid(), v_manager, NULLIF(btrim(p_notes), ''), NOW()
  )
  RETURNING id INTO v_account_id;

  INSERT INTO account_agency_access (account_id, level, updated_by)
  VALUES (v_account_id, p_access_level, auth.uid());

  INSERT INTO account_invitations (
    account_id, token_hash, role, email, created_by_user_id, label, expires_at
  ) VALUES (
    v_account_id, p_token_hash, 'owner', lower(btrim(p_owner_email)),
    auth.uid(), 'Dono', p_expires_at
  );

  INSERT INTO agencia_auditoria (actor_user_id, account_id, action)
  VALUES (auth.uid(), v_account_id, 'create_account');

  RETURN v_account_id;
END;
$$;

ALTER FUNCTION public.agencia_create_account(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.agencia_create_account(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agencia_create_account(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, UUID, TEXT) TO authenticated;

-- New owner invitation for an existing CRM (lost link, wrong email,
-- or handing over a CRM the agency set up). Earlier open owner
-- invitations for that CRM stop working.
CREATE OR REPLACE FUNCTION public.agencia_invite_owner(
  p_account_id UUID,
  p_owner_email TEXT,
  p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := require_agencia_operator(p_account_id);
  v_invitation_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM accounts WHERE id = p_account_id AND status <> 'archived'
  ) THEN
    RAISE EXCEPTION 'CRM não encontrado' USING ERRCODE = '22023';
  END IF;
  IF NOT is_valid_email(btrim(p_owner_email)) THEN
    RAISE EXCEPTION 'E-mail do dono inválido' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(p_token_hash, '') IS NULL OR p_expires_at IS NULL OR p_expires_at <= NOW() THEN
    RAISE EXCEPTION 'Convite inválido' USING ERRCODE = '22023';
  END IF;

  UPDATE account_invitations
  SET expires_at = NOW()
  WHERE account_id = p_account_id
    AND role = 'owner'
    AND accepted_at IS NULL
    AND expires_at > NOW();

  INSERT INTO account_invitations (
    account_id, token_hash, role, email, created_by_user_id, label, expires_at
  ) VALUES (
    p_account_id, p_token_hash, 'owner', lower(btrim(p_owner_email)),
    auth.uid(), 'Dono', p_expires_at
  )
  RETURNING id INTO v_invitation_id;

  INSERT INTO agencia_auditoria (actor_user_id, account_id, action)
  VALUES (auth.uid(), p_account_id, 'invite_owner');

  RETURN v_invitation_id;
END;
$$;

ALTER FUNCTION public.agencia_invite_owner(UUID, TEXT, TEXT, TIMESTAMPTZ) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.agencia_invite_owner(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agencia_invite_owner(UUID, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

-- Platform fields of a CRM. p_patch keys: name, status, niche,
-- manager_user_id, notes. A missing key leaves the field alone; an
-- empty string clears niche / notes / manager.
--   archiving and changing the manager: super_admin only
CREATE OR REPLACE FUNCTION public.agencia_update_account(
  p_account_id UUID,
  p_patch JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := require_agencia_operator(p_account_id);
  v_current accounts%ROWTYPE;
  v_status TEXT;
  v_manager UUID;
BEGIN
  SELECT * INTO v_current FROM accounts WHERE id = p_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CRM não encontrado' USING ERRCODE = '22023';
  END IF;

  v_status := COALESCE(p_patch->>'status', v_current.status);
  IF v_status NOT IN ('onboarding', 'active', 'suspended', 'archived') THEN
    RAISE EXCEPTION 'Status inválido' USING ERRCODE = '22023';
  END IF;
  IF v_role <> 'super_admin'
     AND (v_status = 'archived' OR v_current.status = 'archived')
     AND v_status IS DISTINCT FROM v_current.status THEN
    RAISE EXCEPTION 'Só um super admin arquiva ou restaura um CRM'
      USING ERRCODE = '42501';
  END IF;

  v_manager := v_current.manager_user_id;
  IF p_patch ? 'manager_user_id' THEN
    IF v_role <> 'super_admin' THEN
      RAISE EXCEPTION 'Só um super admin muda o gestor responsável'
        USING ERRCODE = '42501';
    END IF;
    v_manager := NULLIF(p_patch->>'manager_user_id', '')::uuid;
    IF v_manager IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM agencia_membros
      WHERE user_id = v_manager AND role IN ('super_admin', 'manager')
    ) THEN
      RAISE EXCEPTION 'O responsável precisa ser gestor ou super admin da agência'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'name' AND NULLIF(btrim(p_patch->>'name'), '') IS NULL THEN
    RAISE EXCEPTION 'Dê um nome ao CRM' USING ERRCODE = '22023';
  END IF;

  UPDATE accounts SET
    name = CASE WHEN p_patch ? 'name' THEN btrim(p_patch->>'name') ELSE name END,
    status = v_status,
    status_changed_at = CASE WHEN v_status IS DISTINCT FROM status THEN NOW() ELSE status_changed_at END,
    niche = CASE WHEN p_patch ? 'niche' THEN NULLIF(btrim(p_patch->>'niche'), '') ELSE niche END,
    notes = CASE WHEN p_patch ? 'notes' THEN NULLIF(btrim(p_patch->>'notes'), '') ELSE notes END,
    manager_user_id = v_manager
  WHERE id = p_account_id;

  INSERT INTO agencia_auditoria (actor_user_id, account_id, action)
  VALUES (
    auth.uid(),
    p_account_id,
    CASE WHEN v_status IS DISTINCT FROM v_current.status
         THEN 'status_' || v_status
         ELSE 'update_account'
    END
  );
END;
$$;

ALTER FUNCTION public.agencia_update_account(UUID, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.agencia_update_account(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agencia_update_account(UUID, JSONB) TO authenticated;
