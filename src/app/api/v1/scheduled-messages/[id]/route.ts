// ============================================================
// DELETE /api/v1/scheduled-messages/{id} — cancel a scheduled message
// (scope: messages:send)
//
// Only one that has not gone yet: 409 otherwise. Answers the message,
// now `cancelled`.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { cancelScheduledMessage, ScheduleError } from '@/lib/scheduled/messages';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');
    const { id } = await params;
    if (!UUID.test(id)) return fail('not_found', 'Mensagem agendada não encontrada.', 404);
    return ok(await cancelScheduledMessage(ctx.supabase, ctx.accountId, id));
  } catch (err) {
    if (err instanceof ScheduleError) return fail(err.code, err.message, err.status);
    return toApiErrorResponse(err);
  }
}
