-- ============================================================
-- 066_descadastro.sql — a contact who asked not to receive automatic
-- messages
--
--   contacts.opted_out_at   when the contact asked to stop (NULL: they
--                           didn't). Marked by a person, in the contact's
--                           page or in the Chrome extension.
--
-- What respects it (in the app): bulk sends through the QR-code number
-- (065), approved-template broadcasts, sequences (manual-trigger
-- automations) and chatbot flows started by hand. A message a person
-- writes or schedules by hand still goes: they chose to send it.
--
-- The existing contacts policies cover reading and changing it.
--
-- Safe to apply before or after the code: before, nobody can mark it;
-- after, until it runs, marking says it is unavailable.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ;

-- "Who in this CRM opted out", for the sends that skip them.
CREATE INDEX IF NOT EXISTS idx_contacts_opted_out
  ON contacts (account_id)
  WHERE opted_out_at IS NOT NULL;
