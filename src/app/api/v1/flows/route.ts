// ============================================================
// GET /api/v1/flows — the CRM's chatbot flows that start by hand
// (scope: messages:send)
//
// The active flows whose trigger is "manual": started on one contact
// from the Chrome extension (POST /api/v1/flows/{id}/start).
//
// Response: { data: [{ id, name, description }] }
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { FlowStartError, listManualFlows } from '@/lib/api/v1/flows';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');
    return ok(await listManualFlows(ctx.supabase, ctx.accountId));
  } catch (err) {
    if (err instanceof FlowStartError) return fail(err.code, err.message, err.status);
    return toApiErrorResponse(err);
  }
}
