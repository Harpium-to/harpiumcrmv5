-- ============================================================
-- 054_extensao_chrome.sql — personal keys for the Chrome extension (0B)
--
-- See docs/plano-plataforma-agencia.md §7A. The extension (extension/)
-- talks to the public API with an API key. Until now only admins could
-- mint one, and it belonged to the whole CRM: the attendant who lives
-- in WhatsApp Web couldn't connect alone, a shared key made everyone
-- the same person, and removing someone from the team didn't stop the
-- key they used.
--
--   api_keys.user_id / kind   a key can be personal ('extension')
--   create_extension_key()    any member from agent up mints their own,
--                             with the scopes the extension needs and
--                             nothing else (fixed here, not by the
--                             caller); a new one replaces the old
--   my_extension_key()        status for the settings screen
--   revoke_my_extension_key() disconnect
--   triggers                  leaving the CRM, or becoming a viewer,
--                             revokes the person's extension key
--
-- The agency inside a client CRM (049) cannot mint one: the extension
-- is the client team's tool.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'api';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'api_keys_kind_check' AND conrelid = 'public.api_keys'::regclass
  ) THEN
    ALTER TABLE api_keys ADD CONSTRAINT api_keys_kind_check CHECK (kind IN ('api', 'extension'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_one_extension_per_member
  ON api_keys(account_id, user_id)
  WHERE kind = 'extension' AND revoked_at IS NULL;

-- What the extension calls (extension/README.md): find and create
-- contacts, read and move deals.
CREATE OR REPLACE FUNCTION public.extension_key_scopes()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY['contacts:read', 'contacts:write', 'deals:read', 'deals:write']::text[];
$$;

CREATE OR REPLACE FUNCTION public.create_extension_key(
  p_key_hash TEXT,
  p_key_prefix TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID := require_active_account();
  v_name TEXT;
  v_id UUID;
BEGIN
  IF account_role_rank(member_role_in(v_account_id)) < account_role_rank('agent') THEN
    RAISE EXCEPTION 'A extensão é para quem atende: peça o papel de atendente ou acima'
      USING ERRCODE = '42501';
  END IF;
  IF NULLIF(p_key_hash, '') IS NULL OR NULLIF(p_key_prefix, '') IS NULL THEN
    RAISE EXCEPTION 'Chave inválida' USING ERRCODE = '22023';
  END IF;

  UPDATE api_keys
  SET revoked_at = NOW()
  WHERE account_id = v_account_id
    AND user_id = auth.uid()
    AND kind = 'extension'
    AND revoked_at IS NULL;

  SELECT COALESCE(NULLIF(full_name, ''), email) INTO v_name
  FROM profiles WHERE user_id = auth.uid();

  INSERT INTO api_keys (
    account_id, created_by, user_id, kind, name, key_prefix, key_hash, scopes
  ) VALUES (
    v_account_id, auth.uid(), auth.uid(), 'extension',
    'Extensão do Chrome · ' || COALESCE(v_name, 'membro'),
    p_key_prefix, p_key_hash, extension_key_scopes()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

ALTER FUNCTION public.create_extension_key(TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_extension_key(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_extension_key(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_extension_key()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', k.id,
    'prefix', k.key_prefix,
    'created_at', k.created_at,
    'last_used_at', k.last_used_at
  )
  FROM api_keys k
  JOIN profiles p ON p.user_id = auth.uid() AND p.account_id = k.account_id
  WHERE k.user_id = auth.uid()
    AND k.kind = 'extension'
    AND k.revoked_at IS NULL
  ORDER BY k.created_at DESC
  LIMIT 1;
$$;

ALTER FUNCTION public.my_extension_key() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.my_extension_key() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_extension_key() TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_my_extension_key()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID := require_active_account();
BEGIN
  UPDATE api_keys
  SET revoked_at = NOW()
  WHERE account_id = v_account_id
    AND user_id = auth.uid()
    AND kind = 'extension'
    AND revoked_at IS NULL;
END;
$$;

ALTER FUNCTION public.revoke_my_extension_key() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.revoke_my_extension_key() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_my_extension_key() TO authenticated;

-- Leaving the CRM, or dropping to viewer (read-only), ends the
-- person's extension access in that CRM.
CREATE OR REPLACE FUNCTION public.revoke_extension_keys_on_membership_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.role = 'viewer' THEN
    UPDATE api_keys
    SET revoked_at = NOW()
    WHERE account_id = OLD.account_id
      AND user_id = OLD.user_id
      AND kind = 'extension'
      AND revoked_at IS NULL;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

ALTER FUNCTION public.revoke_extension_keys_on_membership_change() OWNER TO postgres;

DROP TRIGGER IF EXISTS revoke_extension_keys_on_membership_change ON account_members;
CREATE TRIGGER revoke_extension_keys_on_membership_change
  AFTER DELETE OR UPDATE OF role ON account_members
  FOR EACH ROW EXECUTE FUNCTION public.revoke_extension_keys_on_membership_change();
