-- ============================================================
-- 070_campos_do_lead.sql — what a lead answers becomes custom fields
--
-- Every answer of a received form (quiz, Meta, Google, Harpium Lead v1)
-- now fills a custom field of the contact, and the field is created
-- when the account has none with that name (docs/plano-leads-contexto-ia.md,
-- Fase 2). Two columns on custom_fields support it:
--
--   field_key     the name folded (lowercase, no accents, '_' between
--                 words: "Faturamento mensal" → faturamento_mensal).
--                 Unique per account when set, so two leads of the same
--                 form arriving together can't create the field twice:
--                 the second insert fails and reads the first one's.
--                 Fields created by hand keep it NULL; the code still
--                 matches them by name.
--   created_from  'lead' for fields a lead created, so the settings
--                 screen can say where a field came from.
--
-- Safe to apply before or after the code: without these columns the
-- code creates the field without them (and without the race guard).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE custom_fields
  ADD COLUMN IF NOT EXISTS field_key TEXT
    CHECK (field_key IS NULL OR char_length(field_key) BETWEEN 1 AND 100);

ALTER TABLE custom_fields
  ADD COLUMN IF NOT EXISTS created_from TEXT
    CHECK (created_from IS NULL OR created_from IN ('lead'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_fields_account_key
  ON custom_fields (account_id, field_key)
  WHERE field_key IS NOT NULL;
