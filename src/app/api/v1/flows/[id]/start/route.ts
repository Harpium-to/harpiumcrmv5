// ============================================================
// POST /api/v1/flows/{id}/start — start a manual flow on a contact
// (scope: messages:send)
//
// Body: { "contact_id": "<uuid>" }
//
// Runs the flow until it waits for the customer; the replies carry it
// on, as with any flow. Refused when the flow is not active (409), the
// contact already has a flow running (409) or no conversation (409),
// the flow has no entry (422), or the CRM reached its daily limit of
// manual starts (429). See src/lib/api/v1/flows.ts.
//
// Response (201): { "data": { "run_id": "<uuid>" } }
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { FlowStartError, startFlow } from '@/lib/api/v1/flows';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { contact_id?: unknown } | null;
    const contactId = typeof body?.contact_id === 'string' ? body.contact_id : '';
    if (!UUID.test(id)) return fail('not_found', 'Fluxo não encontrado.', 404);
    if (!UUID.test(contactId)) return fail('bad_request', "informe 'contact_id'", 400);
    return ok(await startFlow(ctx.supabase, ctx.accountId, id, contactId), 201);
  } catch (err) {
    if (err instanceof FlowStartError) return fail(err.code, err.message, err.status);
    return toApiErrorResponse(err);
  }
}
