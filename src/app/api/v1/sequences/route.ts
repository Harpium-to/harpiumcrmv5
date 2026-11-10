// ============================================================
// GET /api/v1/sequences — the CRM's sequences (scope: messages:send)
//
// A sequence is an automation with the "Sequência (disparo manual)"
// trigger: messages with waits between them, started on one contact
// (src/lib/api/v1/sequences.ts). Only active ones are listed.
//
// `?contact_id=` marks the ones running for that contact.
//
// Response: { data: [{ id, name, description, messages,
//                      duration_minutes, running }] }
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { listSequences, SequenceError } from '@/lib/api/v1/sequences';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');
    const contactId = new URL(request.url).searchParams.get('contact_id');
    if (contactId !== null && !UUID.test(contactId)) {
      return fail('bad_request', "'contact_id' inválido", 400);
    }
    return ok(await listSequences(ctx.supabase, ctx.accountId, contactId));
  } catch (err) {
    if (err instanceof SequenceError) return fail(err.code, err.message, err.status);
    return toApiErrorResponse(err);
  }
}
