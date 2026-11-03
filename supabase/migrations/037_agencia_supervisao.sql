-- ============================================================
-- 037_agencia_supervisao.sql — Agency super-vision (foundation)
--
-- Adds a super-tenant layer ABOVE accounts. An "agency" member is a
-- trusted operator who can supervise and manage EVERY account
-- (client) in the instance — not through RLS widening, but through
-- the service role from the server (see src/lib/agencia/*). This
-- migration only needs to (a) record who the agency members are and
-- (b) expose a cheap `is_agencia()` predicate the app can call to
-- gate the /agencia console and the post-login redirect.
--
-- Why membership is its own tiny table (not a profiles flag)
--   Agency membership is orthogonal to the one-account-per-user
--   model from 017: an operator still owns their own personal
--   account and behaves like any owner inside it. Being "agency"
--   is a separate, instance-wide capability, so it lives in its own
--   table keyed by auth.users — no coupling to profiles.account_id.
--
-- Security model
--   - The table is service-role / SQL-editor managed. There is NO
--     client-facing INSERT/UPDATE/DELETE policy: a member cannot
--     enroll themselves or anyone else. Seeding happens out of band
--     (SQL editor) or via the service role.
--   - A member may read ONLY their own row (so the app can confirm
--     "am I agency?" without the service role when convenient).
--   - `is_agencia()` is SECURITY DEFINER so any authenticated caller
--     can ask "am I an agency member?" without needing to read the
--     table directly.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- AGENCIA_MEMBROS — who the agency operators are
-- ============================================================
CREATE TABLE IF NOT EXISTS agencia_membros (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Free-form label for the human behind the row (name / note). Not
  -- load-bearing — the join to auth.users is the source of truth.
  label      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE agencia_membros ENABLE ROW LEVEL SECURITY;

-- Members may read their own row. No client write policies at all —
-- enrollment is service-role / SQL-editor only (see header).
DROP POLICY IF EXISTS agencia_membros_select_self ON agencia_membros;
CREATE POLICY agencia_membros_select_self ON agencia_membros FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- is_agencia() — cheap "is the caller an agency operator?" predicate
--
-- SECURITY DEFINER so it can read agencia_membros regardless of the
-- caller's RLS. Takes no argument: it always asks about auth.uid(),
-- which is exactly what the /agencia gate and login redirect need.
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_agencia()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM agencia_membros m WHERE m.user_id = auth.uid()
  );
$$;

ALTER FUNCTION public.is_agencia() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.is_agencia() TO authenticated, service_role;
