-- ============================================================
-- 049_plataforma_acesso.sql — Platform access foundation (Fase 1)
--
-- See docs/plano-plataforma-agencia.md §3, §4 and §8. This migration
-- turns the instance into a platform of client CRMs with two
-- separate access layers, without changing anything a client sees
-- today.
--
-- What changes
--   1. `account_members` — a user may belong to several CRMs, each
--      with its own role. Backfilled 1:1 from profiles. It becomes
--      the source of truth for membership.
--   2. `profiles.account_id` now means "the ACTIVE CRM". RLS only
--      ever exposes the active CRM, so a user in two CRMs never sees
--      their rows mixed by a query that forgets `.eq('account_id')`.
--      `profiles.account_role` is a mirror of the role in the active
--      CRM, kept by triggers/RPCs, for the client UI that reads it.
--   3. `account_agency_access` — per-CRM consent for the agency:
--      metrics (nothing row-level) / read (≈ viewer) / full (≈ admin),
--      with an optional temporary elevation that expires by itself.
--   4. `agencia_membros.role` — super_admin / manager / support.
--      support is capped at read-only even if the CRM grants full.
--   5. `is_account_member()` rewritten. Every data policy already
--      calls it, so they all pick up (2) and (3) without being
--      touched. The rule:
--        target is the caller's active CRM
--        AND ( caller's membership role >= min_role
--           OR caller is agency AND the CRM's consent maps to >= min_role )
--   6. Member RPCs (018/019) rewritten on top of account_members.
--      Joining a CRM by invite no longer requires leaving the old one.
--      Owner invitations exist, but only the service role / agency
--      path can mint them.
--   7. New RPCs: current_account_context, list_my_accounts,
--      set_active_account, set_agency_access.
--   8. Signup keeps creating a personal CRM, behind a platform flag
--      (`platform_settings.auto_personal_account`, default true). Fase 2
--      turns it off together with the "aguardando liberação" screen.
--   9. Deleting a CRM no longer deletes the profiles whose active CRM
--      it was (the 017 FK was ON DELETE CASCADE); they move to another
--      membership, or to no CRM.
--  10. chat-media / flow-media uploads now require agent+ on the
--      active CRM (before: any member, including viewers).
--
-- What does NOT change
--   - The /agencia console still reads through the service role. It
--     starts honouring the consent level in Fase 3.
--   - Webhooks, crons and the public API run as service role and
--     resolve the account themselves — untouched.
--
-- Error contract (same as 018/019): 42501 → 403, 22023 → 400,
-- 23505 → 409. Messages are user-facing, in Portuguese.
--
-- Idempotent — safe to run multiple times.
-- ============================================================


-- ============================================================
-- 0. Role rank helper
-- ============================================================
CREATE OR REPLACE FUNCTION public.account_role_rank(p_role account_role_enum)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_role
    WHEN 'owner'  THEN 4
    WHEN 'admin'  THEN 3
    WHEN 'agent'  THEN 2
    WHEN 'viewer' THEN 1
    ELSE 0
  END;
$$;

GRANT EXECUTE ON FUNCTION public.account_role_rank(account_role_enum) TO authenticated, service_role;


-- ============================================================
-- 1. PLATFORM_SETTINGS — single-row instance configuration
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_settings (
  id                    BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  -- Signup (and removal from your last CRM) creates a personal CRM.
  -- Today's behaviour; Fase 2 turns it off.
  auto_personal_account BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_settings_select ON platform_settings;
CREATE POLICY platform_settings_select ON platform_settings FOR SELECT
  USING (is_agencia());

CREATE OR REPLACE FUNCTION public.auto_personal_account_enabled()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT auto_personal_account FROM platform_settings WHERE id),
    TRUE
  );
$$;

ALTER FUNCTION public.auto_personal_account_enabled() OWNER TO postgres;


-- ============================================================
-- 2. ACCOUNT_MEMBERS — many CRMs per user
-- ============================================================
CREATE TABLE IF NOT EXISTS account_members (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       account_role_enum NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_account_members_user
  ON account_members(user_id);

-- Backfill BEFORE the one-owner index, so corrupt data fails loudly
-- here instead of being silently skipped.
INSERT INTO account_members (account_id, user_id, role, created_at)
SELECT p.account_id, p.user_id, p.account_role, COALESCE(p.created_at, NOW())
FROM profiles p
WHERE p.account_id IS NOT NULL
  AND p.account_role IS NOT NULL
ON CONFLICT (account_id, user_id) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_members_one_owner
  ON account_members(account_id)
  WHERE role = 'owner';

DROP TRIGGER IF EXISTS set_updated_at ON account_members;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON account_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE account_members ENABLE ROW LEVEL SECURITY;
-- Policies are created after is_account_member() is rewritten (§6).

-- One owner can now own several CRMs (agency creates a CRM for an
-- existing user; a client with two clinics).
DROP INDEX IF EXISTS idx_accounts_one_per_owner;


-- ============================================================
-- 3. PROFILES — account_id becomes "active CRM", nullable
-- ============================================================
ALTER TABLE profiles ALTER COLUMN account_id   DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN account_role DROP NOT NULL;

-- 017 created profiles.account_id with ON DELETE CASCADE: deleting a
-- CRM deleted the profile of everyone whose active CRM it was. Swap
-- it for SET NULL (the BEFORE DELETE trigger in §7 moves them to
-- another membership first). The constraint name is looked up
-- rather than assumed.
DO $$
DECLARE
  v_name TEXT;
BEGIN
  FOR v_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.profiles'::regclass
      AND c.contype = 'f'
      AND a.attname = 'account_id'
      AND c.confdeltype <> 'n'  -- 'n' = SET NULL already
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', v_name);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.profiles'::regclass
      AND c.contype = 'f'
      AND a.attname = 'account_id'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
  END IF;
END $$;


-- ============================================================
-- 4. AGENCIA_MEMBROS.role — platform roles
--
--   super_admin  everything (incl. managing the agency team)
--   manager      operates CRMs (portfolio scoping comes in Fase 2)
--   support      read-only, even where a CRM grants full access
--
-- Existing members keep today's power (super_admin); members added
-- from now on start at least-privilege (support).
-- ============================================================
ALTER TABLE agencia_membros ADD COLUMN IF NOT EXISTS role TEXT;
UPDATE agencia_membros SET role = 'super_admin' WHERE role IS NULL;
ALTER TABLE agencia_membros ALTER COLUMN role SET DEFAULT 'support';
ALTER TABLE agencia_membros ALTER COLUMN role SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agencia_membros_role_check'
      AND conrelid = 'public.agencia_membros'::regclass
  ) THEN
    ALTER TABLE agencia_membros
      ADD CONSTRAINT agencia_membros_role_check
      CHECK (role IN ('super_admin', 'manager', 'support'));
  END IF;
END $$;

-- Caller's platform role, or NULL when not agency.
CREATE OR REPLACE FUNCTION public.agencia_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM agencia_membros WHERE user_id = auth.uid();
$$;

ALTER FUNCTION public.agencia_role() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.agencia_role() TO authenticated, service_role;


-- ============================================================
-- 5. ACCOUNT_AGENCY_ACCESS — per-CRM consent
--
--   level       metrics | read | full   (missing row = metrics)
--   temp_level  read | full, until temp_until — reverts by itself,
--               no cron needed: the effective level is computed.
--
-- Existing CRMs start at 'read': that is exactly what the agency
-- console already shows today (decision 7 of the plan). New CRMs
-- start at 'metrics'. The backfill runs only when the table is
-- created, so re-running this file never re-grants.
-- ============================================================
DO $$
BEGIN
  IF to_regclass('public.account_agency_access') IS NULL THEN
    CREATE TABLE public.account_agency_access (
      account_id    UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      level         TEXT NOT NULL DEFAULT 'metrics'
                    CHECK (level IN ('metrics', 'read', 'full')),
      temp_level    TEXT CHECK (temp_level IN ('read', 'full')),
      temp_until    TIMESTAMPTZ,
      terms_version TEXT,
      updated_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK ((temp_level IS NULL) = (temp_until IS NULL))
    );

    INSERT INTO public.account_agency_access (account_id, level)
    SELECT id, 'read' FROM public.accounts;
  END IF;
END $$;

ALTER TABLE account_agency_access ENABLE ROW LEVEL SECURITY;
-- SELECT policy is created after is_account_member() (§6). No write
-- policy: the owner writes through set_agency_access(), the agency
-- through the service role when it creates a CRM (Fase 2).

-- Effective consent level right now (temporary elevation applied).
CREATE OR REPLACE FUNCTION public.agency_access_level(p_account_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN x.temp_level IS NOT NULL
         AND x.temp_until > NOW()
         AND (CASE x.temp_level WHEN 'full' THEN 2 WHEN 'read' THEN 1 ELSE 0 END)
           > (CASE x.level      WHEN 'full' THEN 2 WHEN 'read' THEN 1 ELSE 0 END)
        THEN x.temp_level
        ELSE x.level
      END
      FROM account_agency_access x
      WHERE x.account_id = p_account_id
    ),
    'metrics'
  );
$$;

ALTER FUNCTION public.agency_access_level(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.agency_access_level(UUID) TO authenticated, service_role;


-- ============================================================
-- 6. ROLE RESOLUTION + is_account_member() rewrite
-- ============================================================

-- Caller's membership role in a CRM (ignores which CRM is active).
CREATE OR REPLACE FUNCTION public.member_role_in(p_account_id UUID)
RETURNS account_role_enum
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM account_members
  WHERE account_id = p_account_id
    AND user_id = auth.uid();
$$;

ALTER FUNCTION public.member_role_in(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.member_role_in(UUID) TO authenticated, service_role;

-- Caller's role in a CRM through the agency consent, or NULL.
--   read → viewer, full → admin (never owner), metrics → NULL.
--   support is capped at viewer.
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

  IF v_level = 'full' AND v_platform_role IN ('super_admin', 'manager') THEN
    RETURN 'admin';
  END IF;
  IF v_level IN ('read', 'full') THEN
    RETURN 'viewer';
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.agency_role_in(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.agency_role_in(UUID) TO authenticated, service_role;

-- The higher of membership role and agency role (ignores active CRM).
CREATE OR REPLACE FUNCTION public.effective_role_in(p_account_id UUID)
RETURNS account_role_enum
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member account_role_enum := member_role_in(p_account_id);
  v_agency account_role_enum := agency_role_in(p_account_id);
BEGIN
  IF account_role_rank(v_agency) > account_role_rank(v_member) THEN
    RETURN v_agency;
  END IF;
  RETURN v_member;
END;
$$;

ALTER FUNCTION public.effective_role_in(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.effective_role_in(UUID) TO authenticated, service_role;

-- The predicate every data policy calls (017 and later). Same
-- signature and default as before, so no policy needs recreating.
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

  RETURN account_role_rank(effective_role_in(target_account_id))
      >= account_role_rank(min_role);
END;
$$;

ALTER FUNCTION public.is_account_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.is_account_member(UUID, account_role_enum) TO authenticated, service_role;

-- account_members: the active CRM's roster, plus your own rows (so
-- a CRM switcher can list them).
DROP POLICY IF EXISTS account_members_select ON account_members;
CREATE POLICY account_members_select ON account_members FOR SELECT
  USING (user_id = auth.uid() OR is_account_member(account_id));

DROP POLICY IF EXISTS account_agency_access_select ON account_agency_access;
CREATE POLICY account_agency_access_select ON account_agency_access FOR SELECT
  USING (is_account_member(account_id) OR is_agencia());

-- profiles: yourself, plus everyone who is a member of your active
-- CRM. (Before: everyone whose active CRM was yours — which, with
-- several CRMs per user, would hide a teammate who is currently
-- looking at another CRM.)
CREATE OR REPLACE FUNCTION public.is_teammate(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles me
    JOIN account_members m ON m.account_id = me.account_id
    WHERE me.user_id = auth.uid()
      AND m.user_id = p_user_id
      AND is_account_member(me.account_id)
  );
$$;

ALTER FUNCTION public.is_teammate(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.is_teammate(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT
  USING (auth.uid() = user_id OR is_teammate(user_id));


-- ============================================================
-- 7. KEEPING profiles (active CRM + role mirror) IN SYNC
-- ============================================================

-- Membership written → mirror the role if it is the active CRM.
-- Membership deleted → if it was the active CRM, move to the most
-- recent remaining membership (or none).
CREATE OR REPLACE FUNCTION public.sync_profile_from_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_account UUID;
  v_next_role account_role_enum;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM profiles
      WHERE user_id = OLD.user_id AND account_id = OLD.account_id
    ) THEN
      SELECT account_id, role INTO v_next_account, v_next_role
      FROM account_members
      WHERE user_id = OLD.user_id
        AND account_id <> OLD.account_id
      ORDER BY created_at DESC
      LIMIT 1;

      UPDATE profiles
      SET account_id = v_next_account,
          account_role = v_next_role
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

ALTER FUNCTION public.sync_profile_from_membership() OWNER TO postgres;

DROP TRIGGER IF EXISTS sync_profile_from_membership ON account_members;
CREATE TRIGGER sync_profile_from_membership
  AFTER INSERT OR UPDATE OF role OR DELETE ON account_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_from_membership();

-- Before a CRM is deleted, move everyone whose active CRM it is to
-- another membership (FK cascades run after this, as AFTER triggers).
CREATE OR REPLACE FUNCTION public.reassign_active_before_account_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_next_account UUID;
  v_next_role account_role_enum;
BEGIN
  FOR r IN SELECT user_id FROM profiles WHERE account_id = OLD.id LOOP
    v_next_account := NULL;
    v_next_role := NULL;

    SELECT account_id, role INTO v_next_account, v_next_role
    FROM account_members
    WHERE user_id = r.user_id
      AND account_id <> OLD.id
    ORDER BY created_at DESC
    LIMIT 1;

    UPDATE profiles
    SET account_id = v_next_account,
        account_role = v_next_role
    WHERE user_id = r.user_id;
  END LOOP;
  RETURN OLD;
END;
$$;

ALTER FUNCTION public.reassign_active_before_account_delete() OWNER TO postgres;

DROP TRIGGER IF EXISTS reassign_active_before_account_delete ON accounts;
CREATE TRIGGER reassign_active_before_account_delete
  BEFORE DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION public.reassign_active_before_account_delete();

-- Creates a personal CRM owned by p_user_id and makes it active.
-- Shared by signup and "removed from your last CRM".
CREATE OR REPLACE FUNCTION public.create_personal_account(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
  v_account_id UUID;
BEGIN
  SELECT COALESCE(NULLIF(full_name, ''), email) INTO v_name
  FROM profiles WHERE user_id = p_user_id;

  INSERT INTO accounts (name, owner_user_id)
  VALUES (COALESCE(v_name, 'Minha conta'), p_user_id)
  RETURNING id INTO v_account_id;

  INSERT INTO account_members (account_id, user_id, role)
  VALUES (v_account_id, p_user_id, 'owner');

  UPDATE profiles
  SET account_id = v_account_id,
      account_role = 'owner'
  WHERE user_id = p_user_id;

  RETURN v_account_id;
END;
$$;

ALTER FUNCTION public.create_personal_account(UUID) OWNER TO postgres;
-- Takes an arbitrary user id, so it must never be callable from a
-- session. Supabase's default privileges grant EXECUTE to anon and
-- authenticated explicitly, which REVOKE ... FROM PUBLIC alone does
-- not undo.
REVOKE ALL ON FUNCTION public.create_personal_account(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_personal_account(UUID) TO service_role;


-- ============================================================
-- 8. SIGNUP — profile always; personal CRM only if the flag is on
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (NEW.id, v_full_name, NEW.email);

  IF public.auto_personal_account_enabled() THEN
    PERFORM public.create_personal_account(NEW.id);
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
-- The on_auth_user_created trigger from 017 keeps pointing at this
-- function; nothing to recreate.


-- ============================================================
-- 9. OWNER INVITATIONS — allowed, but not from a client session
--
-- 017 had CHECK (role <> 'owner'). An admin could otherwise insert
-- an owner invite through PostgREST (account_invitations_modify is
-- FOR ALL to admins) and redeem it with a second login to outrank
-- the real owner. Owner invites now exist for the agency's "create
-- a CRM and invite its owner" flow (Fase 2), minted only by the
-- service role or a SECURITY DEFINER function.
-- ============================================================
DO $$
DECLARE
  v_name TEXT;
BEGIN
  FOR v_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.account_invitations'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%owner%'
  LOOP
    EXECUTE format('ALTER TABLE public.account_invitations DROP CONSTRAINT %I', v_name);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_owner_invitation_origin()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'owner' AND current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Convite de dono só pode ser criado pela agência'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_owner_invitation_origin() OWNER TO postgres;

DROP TRIGGER IF EXISTS enforce_owner_invitation_origin ON account_invitations;
CREATE TRIGGER enforce_owner_invitation_origin
  BEFORE INSERT OR UPDATE ON account_invitations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_owner_invitation_origin();


-- ============================================================
-- 10. MEMBER RPCs (replacing 018) — on account_members
-- ============================================================

-- Caller's active CRM, or raise. Shared by the RPCs below.
CREATE OR REPLACE FUNCTION public.require_active_account()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_account_id
  FROM profiles WHERE user_id = auth.uid();

  IF v_account_id IS NULL OR effective_role_in(v_account_id) IS NULL THEN
    RAISE EXCEPTION 'Você não está em nenhum CRM' USING ERRCODE = '42501';
  END IF;

  RETURN v_account_id;
END;
$$;

ALTER FUNCTION public.require_active_account() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.set_member_role(
  p_user_id UUID,
  p_new_role account_role_enum
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID := require_active_account();
  v_target_role account_role_enum;
BEGIN
  IF NOT is_account_member(v_account_id, 'admin') THEN
    RAISE EXCEPTION 'Esta ação exige o papel de administrador ou superior'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode mudar o seu próprio papel'
      USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_target_role
  FROM account_members
  WHERE account_id = v_account_id AND user_id = p_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Essa pessoa não é membro deste CRM'
      USING ERRCODE = '22023';
  END IF;

  IF v_target_role = 'owner' OR p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Para mudar o dono, use a transferência de propriedade'
      USING ERRCODE = '22023';
  END IF;

  UPDATE account_members
  SET role = p_new_role
  WHERE account_id = v_account_id AND user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.set_member_role(UUID, account_role_enum) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_role(UUID, account_role_enum) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_role(UUID, account_role_enum) TO authenticated;

-- Removes p_user_id from the caller's active CRM. Their login and
-- their other CRMs are untouched. If it was their last CRM and the
-- platform still auto-creates personal CRMs, they get a fresh one
-- (018's behaviour). Returns the removed user's new active CRM id,
-- or NULL.
CREATE OR REPLACE FUNCTION public.remove_account_member(
  p_user_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID := require_active_account();
  v_target_role account_role_enum;
  v_new_active UUID;
BEGIN
  IF NOT is_account_member(v_account_id, 'admin') THEN
    RAISE EXCEPTION 'Esta ação exige o papel de administrador ou superior'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode remover a si mesmo; transfira a propriedade antes'
      USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_target_role
  FROM account_members
  WHERE account_id = v_account_id AND user_id = p_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Essa pessoa não é membro deste CRM'
      USING ERRCODE = '22023';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Não é possível remover o dono do CRM; transfira a propriedade antes'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM account_members
  WHERE account_id = v_account_id AND user_id = p_user_id;
  -- sync_profile_from_membership moved their active CRM if needed.

  SELECT account_id INTO v_new_active
  FROM profiles WHERE user_id = p_user_id;

  IF v_new_active IS NULL AND auto_personal_account_enabled() THEN
    v_new_active := create_personal_account(p_user_id);
  END IF;

  RETURN v_new_active;
END;
$$;

ALTER FUNCTION public.remove_account_member(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.remove_account_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_account_member(UUID) TO authenticated;

-- Owner only — by membership, never through the agency (agency tops
-- out at admin anyway).
CREATE OR REPLACE FUNCTION public.transfer_account_ownership(
  p_new_owner_user_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID := require_active_account();
BEGIN
  IF member_role_in(v_account_id) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Só o dono do CRM pode transferir a propriedade'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_owner_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Você já é o dono' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM account_members
    WHERE account_id = v_account_id AND user_id = p_new_owner_user_id
  ) THEN
    RAISE EXCEPTION 'Essa pessoa não é membro deste CRM'
      USING ERRCODE = '22023';
  END IF;

  -- Demote first: the one-owner index is checked per statement.
  UPDATE account_members SET role = 'admin'
  WHERE account_id = v_account_id AND user_id = auth.uid();

  UPDATE account_members SET role = 'owner'
  WHERE account_id = v_account_id AND user_id = p_new_owner_user_id;

  UPDATE accounts SET owner_user_id = p_new_owner_user_id
  WHERE id = v_account_id;
END;
$$;

ALTER FUNCTION public.transfer_account_ownership(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transfer_account_ownership(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_account_ownership(UUID) TO authenticated;


-- ============================================================
-- 11. INVITATIONS (replacing 019's redeem) — join without leaving
-- ============================================================
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID  -- the joined account_id
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
  WHERE token_hash = p_token_hash
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

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = v_caller_id) THEN
    RAISE EXCEPTION 'Perfil não encontrado' USING ERRCODE = '42501';
  END IF;

  IF v_inv.role <> 'owner' AND EXISTS (
    SELECT 1 FROM account_members
    WHERE account_id = v_inv.account_id AND user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Você já é membro deste CRM' USING ERRCODE = '23505';
  END IF;

  -- The CRM the caller is leaving the screen of. If it is an
  -- untouched personal CRM (theirs, alone, no data) — the one signup
  -- auto-created — it is removed, as 019 did. Anything else stays.
  SELECT account_id INTO v_old_account_id
  FROM profiles WHERE user_id = v_caller_id;

  IF v_old_account_id IS NOT NULL AND v_old_account_id <> v_inv.account_id THEN
    SELECT
      a.owner_user_id = v_caller_id
      AND NOT EXISTS (
        SELECT 1 FROM account_members m
        WHERE m.account_id = a.id AND m.user_id <> v_caller_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM contacts WHERE account_id = a.id
        UNION ALL SELECT 1 FROM conversations WHERE account_id = a.id
        UNION ALL SELECT 1 FROM broadcasts WHERE account_id = a.id
        UNION ALL SELECT 1 FROM automations WHERE account_id = a.id
        UNION ALL SELECT 1 FROM flows WHERE account_id = a.id
        UNION ALL SELECT 1 FROM pipelines WHERE account_id = a.id
        UNION ALL SELECT 1 FROM message_templates WHERE account_id = a.id
        UNION ALL SELECT 1 FROM tags WHERE account_id = a.id
        UNION ALL SELECT 1 FROM custom_fields WHERE account_id = a.id
        UNION ALL SELECT 1 FROM contact_notes WHERE account_id = a.id
        UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = a.id
        LIMIT 1
      )
    INTO v_old_is_disposable
    FROM accounts a
    WHERE a.id = v_old_account_id;
  END IF;

  IF v_inv.role = 'owner' THEN
    -- Previous owner (if someone else) steps down to admin.
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

  -- Land the caller in the CRM they just joined.
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

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;


-- ============================================================
-- 12. ACTIVE CRM — context, list, switch
-- ============================================================

-- The caller's active CRM with their effective role in it, or NULL
-- when there is none (or no longer any right to it). This is what
-- getCurrentAccount() trusts — not the profiles.account_role mirror,
-- which can't follow a temporary agency grant expiring.
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
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT account_id INTO v_account_id
  FROM profiles WHERE user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_member := member_role_in(v_account_id);
  v_agency := agency_role_in(v_account_id);
  v_role := effective_role_in(v_account_id);

  IF v_role IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT name INTO v_name FROM accounts WHERE id = v_account_id;

  RETURN jsonb_build_object(
    'account_id', v_account_id,
    'account_name', v_name,
    'role', v_role,
    -- True when the agency consent is what grants (or raises) access.
    'via_agency', account_role_rank(v_agency) > account_role_rank(v_member)
  );
END;
$$;

ALTER FUNCTION public.current_account_context() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.current_account_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_account_context() TO authenticated;

-- Every CRM the caller is a member of (for the switcher, Fase 2).
-- Agency access to client CRMs is listed by the console, not here.
CREATE OR REPLACE FUNCTION public.list_my_accounts()
RETURNS TABLE (
  account_id UUID,
  account_name TEXT,
  role account_role_enum,
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
    a.id = (SELECT p.account_id FROM profiles p WHERE p.user_id = auth.uid())
  FROM account_members m
  JOIN accounts a ON a.id = m.account_id
  WHERE m.user_id = auth.uid()
  ORDER BY a.name;
$$;

ALTER FUNCTION public.list_my_accounts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_my_accounts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_accounts() TO authenticated;

-- Switch the active CRM. Allowed into a CRM you are a member of, or
-- — for the agency — one whose consent grants at least read. An
-- agency entry is written to agencia_auditoria.
CREATE OR REPLACE FUNCTION public.set_active_account(p_account_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member account_role_enum;
  v_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autorizado' USING ERRCODE = '42501';
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

ALTER FUNCTION public.set_active_account(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_active_account(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_active_account(UUID) TO authenticated;


-- ============================================================
-- 13. CONSENT — the owner sets what the agency may see
-- ============================================================
--   p_level        metrics | read | full
--   p_temp_level   read | full | NULL (clears any temporary grant)
--   p_temp_hours   1..168, required with p_temp_level
CREATE OR REPLACE FUNCTION public.set_agency_access(
  p_level TEXT,
  p_temp_level TEXT DEFAULT NULL,
  p_temp_hours INT DEFAULT NULL,
  p_terms_version TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID := require_active_account();
  v_until TIMESTAMPTZ;
BEGIN
  IF member_role_in(v_account_id) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Só o dono do CRM decide o acesso da agência'
      USING ERRCODE = '42501';
  END IF;

  IF p_level IS NULL OR p_level NOT IN ('metrics', 'read', 'full') THEN
    RAISE EXCEPTION 'Nível de acesso inválido' USING ERRCODE = '22023';
  END IF;

  IF p_temp_level IS NOT NULL THEN
    IF p_temp_level NOT IN ('read', 'full') THEN
      RAISE EXCEPTION 'Nível temporário inválido' USING ERRCODE = '22023';
    END IF;
    IF p_temp_hours IS NULL OR p_temp_hours < 1 OR p_temp_hours > 168 THEN
      RAISE EXCEPTION 'O acesso temporário dura de 1 a 168 horas'
        USING ERRCODE = '22023';
    END IF;
    v_until := NOW() + make_interval(hours => p_temp_hours);
  END IF;

  INSERT INTO account_agency_access (
    account_id, level, temp_level, temp_until, terms_version,
    updated_by, updated_at
  ) VALUES (
    v_account_id, p_level, p_temp_level, v_until, p_terms_version,
    auth.uid(), NOW()
  )
  ON CONFLICT (account_id) DO UPDATE SET
    level         = EXCLUDED.level,
    temp_level    = EXCLUDED.temp_level,
    temp_until    = EXCLUDED.temp_until,
    terms_version = COALESCE(EXCLUDED.terms_version, account_agency_access.terms_version),
    updated_by    = EXCLUDED.updated_by,
    updated_at    = EXCLUDED.updated_at;
END;
$$;

ALTER FUNCTION public.set_agency_access(TEXT, TEXT, INT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_agency_access(TEXT, TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_agency_access(TEXT, TEXT, INT, TEXT) TO authenticated;


-- ============================================================
-- 14. STORAGE — uploads need agent+ on the active CRM
--
-- 020/023 matched the folder against profiles.account_id with no
-- role check, so a viewer — and now a read-only agency session —
-- could write media. Reads are unchanged (chat-media is public by
-- design, 023).
-- ============================================================
DROP POLICY IF EXISTS "Members can upload chat media" ON storage.objects;
CREATE POLICY "Members can upload chat media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND public.is_account_member(p.account_id, 'agent')
    )
  );

DROP POLICY IF EXISTS "Members can update chat media" ON storage.objects;
CREATE POLICY "Members can update chat media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND public.is_account_member(p.account_id, 'agent')
    )
  );

DROP POLICY IF EXISTS "Members can delete chat media" ON storage.objects;
CREATE POLICY "Members can delete chat media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND public.is_account_member(p.account_id, 'agent')
    )
  );

DROP POLICY IF EXISTS "Members can upload flow media" ON storage.objects;
CREATE POLICY "Members can upload flow media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'flow-media'
    AND (
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid()
          AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
          AND public.is_account_member(p.account_id, 'agent')
      )
      OR auth.uid()::text = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can update flow media" ON storage.objects;
CREATE POLICY "Members can update flow media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'flow-media'
    AND (
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid()
          AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
          AND public.is_account_member(p.account_id, 'agent')
      )
      OR auth.uid()::text = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can delete flow media" ON storage.objects;
CREATE POLICY "Members can delete flow media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'flow-media'
    AND (
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid()
          AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
          AND public.is_account_member(p.account_id, 'agent')
      )
      OR auth.uid()::text = (storage.foldername(name))[1]
    )
  );
