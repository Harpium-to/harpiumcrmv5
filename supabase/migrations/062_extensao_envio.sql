-- ============================================================
-- 062_extensao_envio.sql — the Chrome extension may send through the
-- CRM (Fase 4B of docs/plano-extensao-chrome.md)
--
--   extension_key_scopes()   gains 'messages:send'; active extension
--                            keys gain it too
--
-- With it, the extension's "Enviar pelo CRM" works: a quick reply goes
-- out through the number connected to the CRM (POST /api/v1/messages),
-- and the extension can ask which number that is
-- (GET /api/v1/whatsapp/sender). The extension only offers to send
-- when that number is the one logged in to WhatsApp Web.
--
-- Extension keys are personal, minted only by agents and above, and
-- revoked when the person leaves the CRM or becomes a viewer (054) —
-- the same people who already send from the CRM's inbox.
--
-- Safe to apply before or after the code: before, nothing asks for
-- the scope; after, until it runs, the extension simply does not
-- offer to send.
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
    'quick_replies:read',
    'tasks:read', 'tasks:write',
    'conversations:read', 'conversations:write',
    'messages:send'
  ]::text[];
$$;

-- Keys minted before this migration get what they are missing, after
-- what they already have. Only the personal extension keys: an
-- account-level API key keeps exactly the scopes its admin chose.
UPDATE api_keys k
SET scopes = k.scopes || ARRAY(
  SELECT s.scope
  FROM unnest(extension_key_scopes()) WITH ORDINALITY AS s(scope, position)
  WHERE NOT (s.scope = ANY (k.scopes))
  ORDER BY s.position
)
WHERE k.kind = 'extension'
  AND k.revoked_at IS NULL
  AND NOT (k.scopes @> extension_key_scopes());
