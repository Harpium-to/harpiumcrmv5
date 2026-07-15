-- ============================================================
-- 041_app_branding.sql — Global white-label branding
--
-- One brand for the whole instance (name + logo) shown in the sidebar /
-- header. Read by every signed-in user (so their sidebar renders it);
-- writable ONLY by agency members (the "general admin") via is_agencia()
-- from migration 037. A single-row table (id = TRUE) keeps it global.
--
-- Also provisions a public `branding` Storage bucket for the logo, with
-- writes gated to agency members.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS app_branding (
  id         BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  name       TEXT,
  logo_url   TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure the single row always exists so reads/updates have a target.
INSERT INTO app_branding (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

ALTER TABLE app_branding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_branding_select ON app_branding;
DROP POLICY IF EXISTS app_branding_update ON app_branding;
-- Any signed-in user reads the brand (their sidebar needs it).
CREATE POLICY app_branding_select ON app_branding FOR SELECT
  USING (auth.uid() IS NOT NULL);
-- Only agency members change it.
CREATE POLICY app_branding_update ON app_branding FOR UPDATE
  USING (is_agencia())
  WITH CHECK (is_agencia());

-- ============================================================
-- Public `branding` Storage bucket for the logo
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'branding', 'branding', TRUE, 5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Branding public read" ON storage.objects;
DROP POLICY IF EXISTS "Branding agency insert" ON storage.objects;
DROP POLICY IF EXISTS "Branding agency update" ON storage.objects;
DROP POLICY IF EXISTS "Branding agency delete" ON storage.objects;
CREATE POLICY "Branding public read" ON storage.objects FOR SELECT
  USING (bucket_id = 'branding');
CREATE POLICY "Branding agency insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'branding' AND is_agencia());
CREATE POLICY "Branding agency update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'branding' AND is_agencia());
CREATE POLICY "Branding agency delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'branding' AND is_agencia());
