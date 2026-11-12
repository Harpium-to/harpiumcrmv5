-- ============================================================
-- 059_extensao_respostas_rapidas.sql — the Chrome extension reads the
-- CRM's quick replies (Fase 4A of docs/plano-extensao-chrome.md)
--
-- The extension shows the account's quick replies inside WhatsApp Web
-- and puts the chosen text in the message box. It reads them through
-- the public API (`GET /api/v1/quick-replies`), which checks a scope of
-- its own, `quick_replies:read` — a quick reply is the team's content,
-- not a contact's, so it is not folded into `contacts:read`.
--
--   extension_key_scopes()   gains 'quick_replies:read'
--   api_keys                 active extension keys gain it too, so
--                            nobody has to generate a new key
--
-- Read-only: the extension lists quick replies, it does not create or
-- edit them (that stays in Configurações › Respostas rápidas).
--
-- Safe to apply before or after the code. Before: nothing asks for the
-- scope yet. After: until it runs, the extension says the key has no
-- access to quick replies, and everything else works.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.extension_key_scopes()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'contacts:read', 'contacts:write',
    'deals:read', 'deals:write',
    'quick_replies:read'
  ]::text[];
$$;

-- Keys minted before this migration. Only the personal extension keys:
-- an account-level API key keeps exactly the scopes its admin chose.
UPDATE api_keys
SET scopes = scopes || ARRAY['quick_replies:read']::text[]
WHERE kind = 'extension'
  AND revoked_at IS NULL
  AND NOT (scopes @> ARRAY['quick_replies:read']::text[]);
