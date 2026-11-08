-- ============================================================
-- 057_whatsapp_coexistencia.sql — WhatsApp coexistence (W3)
--
-- A client can now connect the number that is ALREADY on the
-- WhatsApp Business app on their phone, without deleting the app.
-- Meta calls this "coexistence": the phone keeps working, the CRM
-- receives the customers' messages, and what the business answers
-- from the phone arrives here too (`smb_message_echoes`).
--
-- What this migration stores on `whatsapp_config`:
--
--   connection_mode        'cloud'       — number registered for the
--                                          Cloud API only (the path we
--                                          had until now; the default,
--                                          so every existing row keeps
--                                          meaning what it meant)
--                          'coexistence' — number shared with the
--                                          WhatsApp Business app.
--                                          /register must NOT be
--                                          called for it.
--
--   status_reason          Why the row is 'disconnected' when Meta
--                          told us so (account_update webhook):
--                            'partner_removed'    — the business
--                                                   removed our app
--                            'account_offboarded' — the number left
--                                                   coexistence (app
--                                                   reinstalled, etc.)
--                          NULL when connected or for any other cause.
--   status_changed_at      When that happened.
--
--   history_sync_*         The one-time import of the last months of
--                          chats from the phone (Meta allows asking
--                          for it once, within 24h of connecting):
--                            status    requested | importing | done
--                                      | declined (the business said
--                                      no on the phone) | failed
--                            progress  0–100, as Meta reports it
--                            error     Meta's message when it failed
--   contacts_sync_*        The one-time import of the phone's contact
--                          names (smb_app_state_sync).
--
-- Nothing here is secret; RLS on whatsapp_config already covers the
-- new columns.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS connection_mode TEXT NOT NULL DEFAULT 'cloud',
  ADD COLUMN IF NOT EXISTS status_reason TEXT,
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS history_sync_status TEXT,
  ADD COLUMN IF NOT EXISTS history_sync_progress SMALLINT,
  ADD COLUMN IF NOT EXISTS history_sync_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS history_sync_finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS history_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS contacts_sync_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contacts_synced_at TIMESTAMPTZ;

ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_connection_mode_check;
ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_connection_mode_check
  CHECK (connection_mode IN ('cloud', 'coexistence'));

ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_history_sync_status_check;
ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_history_sync_status_check
  CHECK (
    history_sync_status IS NULL
    OR history_sync_status IN ('requested', 'importing', 'done', 'declined', 'failed')
  );

ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_history_sync_progress_check;
ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_history_sync_progress_check
  CHECK (history_sync_progress IS NULL OR history_sync_progress BETWEEN 0 AND 100);

-- account_update events name the WhatsApp Business Account, not the
-- number, so the webhook looks the row up by waba_id.
CREATE INDEX IF NOT EXISTS idx_whatsapp_config_waba_id
  ON whatsapp_config (waba_id)
  WHERE waba_id IS NOT NULL;
