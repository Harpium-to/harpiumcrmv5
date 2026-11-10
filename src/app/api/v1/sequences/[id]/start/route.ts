// ============================================================
// POST /api/v1/sequences/{id}/start — start a sequence on a contact
// (scope: messages:send)
//
// Body: { "contact_id": "<uuid>" }
//
// Sends the first messages now and leaves the rest to the scheduler.
// Refused with a message when the sequence is off (409), already
// running for this contact (409), the contact has no conversation
// (409), the sequence breaks the pacing rule (422), or the CRM reached
// its daily limit of starts (429). See src/lib/api/v1/sequences.ts.
//
// Response (201): { "data": { "log_id": "<uuid>" } }
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { SequenceError, startSequence } from '@/lib/api/v1/sequences';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { contact_id?: unknown } | null;
    const contactId = typeof body?.contact_id === 'string' ? body.contact_id : '';
    if (!UUID.test(id)) return fail('not_found', 'Sequência não encontrada.', 404);
    if (!UUID.test(contactId)) return fail('bad_request', "informe 'contact_id'", 400);
    return ok(await startSequence(ctx.supabase, ctx.accountId, id, contactId), 201);
  } catch (err) {
    if (err instanceof SequenceError) return fail(err.code, err.message, err.status);
    return toApiErrorResponse(err);
  }
}
