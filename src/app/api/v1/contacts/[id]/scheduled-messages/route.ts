// ============================================================
// GET  /api/v1/contacts/{id}/scheduled-messages — what is scheduled
// POST /api/v1/contacts/{id}/scheduled-messages — schedule one
// (scope: messages:send)
//
// A message to this contact at a set time, sent by the CRM's scheduler
// (migration 064, src/lib/scheduled/messages.ts).
//
// POST body:
//   {
//     "text": "Oi! Conseguiu ver a proposta?",   // or the caption
//     "quick_reply_id": "<uuid>",               // optional: its file
//     "send_at": "2026-11-12T09:00:00-03:00",   // 1 min to 90 days ahead
//     "only_if_no_reply": true                  // a follow-up: skipped if
//   }                                           // the customer writes first
//
// GET answers what is waiting, soonest first, then the last 5 done:
//   [{ id, text, media, send_at, only_if_no_reply, status, outcome,
//      created_at }]   status: scheduled | sending | sent | skipped |
//                              cancelled | failed
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  createScheduledMessage,
  listScheduledMessages,
  parseScheduleInput,
  ScheduleError,
} from '@/lib/scheduled/messages';

type Params = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');
    const { id } = await params;
    if (!UUID.test(id)) return fail('not_found', 'Contato não encontrado.', 404);
    return ok(await listScheduledMessages(ctx.supabase, ctx.accountId, id));
  } catch (err) {
    if (err instanceof ScheduleError) return fail(err.code, err.message, err.status);
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');
    const { id } = await params;
    if (!UUID.test(id)) return fail('not_found', 'Contato não encontrado.', 404);
    const body = await request.json().catch(() => null);
    const input = parseScheduleInput(body, Date.now());
    return ok(
      await createScheduledMessage(ctx.supabase, ctx.accountId, id, ctx.createdBy, input),
      201,
    );
  } catch (err) {
    if (err instanceof ScheduleError) return fail(err.code, err.message, err.status);
    return toApiErrorResponse(err);
  }
}
