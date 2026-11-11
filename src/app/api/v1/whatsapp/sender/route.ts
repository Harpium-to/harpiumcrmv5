// ============================================================
// GET /api/v1/whatsapp/sender — the number a send leaves from.
//
// For a client about to send through `POST /api/v1/messages` that
// needs to know from which WhatsApp number the customer will get it.
// The Chrome extension compares it with the number logged in to
// WhatsApp Web, and offers to send only when the two match.
//
// Auth: API key with `messages:send` — only a key that can send has a
// use for it.
//
// Response (200):
//   { "data": {
//       "provider": "meta" | "uazapi" | "evolution" | null,
//       "path": "oficial" | "nao_oficial" | null,
//       "phone": "5563992286787" | null
//   } }
//
// `phone` is read from the provider on every call (Meta's API or the
// QR-code instance), never from a cache. null means it couldn't be
// read, or nothing is connected: do not send on the assumption.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getWhatsAppSender } from '@/lib/api/v1/whatsapp-sender';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');
    return ok(await getWhatsAppSender(ctx.supabase, ctx.accountId));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
