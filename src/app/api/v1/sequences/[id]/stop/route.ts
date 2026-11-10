// ============================================================
// POST /api/v1/sequences/{id}/stop — stop a sequence for a contact
// (scope: messages:send)
//
// Body: { "contact_id": "<uuid>" }
//
// Drops what was still waiting to be sent. What already went, went.
//
// Response: { "data": { "stopped": <how many waiting runs> } } — 0
// when it wasn't running.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { SequenceError, stopSequence } from '@/lib/api/v1/sequences';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { contact_id?: unknown } | null;
    const contactId = typeof body?.contact_id === 'string' ? body.contact_id : '';
    if (!UUID.test(id)) return fail('not_found', 'Sequência não encontrada.', 404);
    if (!UUID.test(contactId)) return fail('bad_request', "informe 'contact_id'", 400);
    return ok(await stopSequence(ctx.supabase, ctx.accountId, id, contactId));
  } catch (err) {
    if (err instanceof SequenceError) return fail(err.code, err.message, err.status);
    return toApiErrorResponse(err);
  }
}
