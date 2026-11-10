-- ============================================================
-- 063_respostas_rapidas_midia.sql — quick replies with a file
-- (Fase 4B, step 3, of docs/plano-extensao-chrome.md)
--
--   quick_replies.kind       gains 'media'
--   quick_replies.media_*    the file: its kind (image, video,
--                            document, audio), its public URL, its path
--                            in the chat-media bucket and its name.
--                            `content_text` is the caption (none for
--                            an audio, which goes as a voice note).
--
-- The file is uploaded to the chat-media bucket (023) under the
-- account's own folder, like an inbox attachment. The app checks that
-- the URL is that file's (src/lib/quick-replies/media.ts); the CHECK
-- below only keeps a media reply from existing without one.
--
-- Safe to apply before or after the code: before, nothing writes
-- 'media'; after, until it runs, saving a reply with a file fails with
-- a message and every other reply keeps working.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE quick_replies
  ADD COLUMN IF NOT EXISTS media_kind     TEXT,
  ADD COLUMN IF NOT EXISTS media_url      TEXT,
  ADD COLUMN IF NOT EXISTS media_path     TEXT,
  ADD COLUMN IF NOT EXISTS media_filename TEXT;

-- The kind list is replaced whatever its constraint is called: 035
-- wrote it inline, so the name is Postgres's choice.
DO $$
DECLARE
  v_name TEXT;
BEGIN
  FOR v_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.quick_replies'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%interactive%'
      AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.quick_replies DROP CONSTRAINT %I', v_name);
  END LOOP;
END $$;

ALTER TABLE quick_replies
  ADD CONSTRAINT quick_replies_kind_check
  CHECK (kind IN ('text', 'interactive', 'media'));

ALTER TABLE quick_replies
  DROP CONSTRAINT IF EXISTS quick_replies_media_check;
ALTER TABLE quick_replies
  ADD CONSTRAINT quick_replies_media_check
  CHECK (
    (kind = 'media'
      AND media_kind IN ('image', 'video', 'document', 'audio')
      AND NULLIF(btrim(media_url), '') IS NOT NULL
      AND NULLIF(btrim(media_path), '') IS NOT NULL)
    OR (kind <> 'media' AND media_kind IS NULL AND media_url IS NULL AND media_path IS NULL)
  );
