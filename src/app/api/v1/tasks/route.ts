// ============================================================
// GET /api/v1/tasks — tasks across contacts (scope: tasks:read)
//
// What a person needs to see "what do I have to do": the open tasks,
// soonest first, each with its contact. `?assigned=me` keeps only the
// tasks for the person the key belongs to; `?status=done` or `all`
// widens it. At most 100.
//
// Needs migration 060; without it this answers 503.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { isMissingTasksTable, listTasks, parseTaskStatus } from '@/lib/api/v1/tasks';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'tasks:read');
    const url = new URL(request.url);
    const status = parseTaskStatus(url.searchParams.get('status'));
    const mine = url.searchParams.get('assigned') === 'me';

    // A key whose owner is gone has no "me": its list is empty rather
    // than everyone's.
    if (mine && !ctx.createdBy) return ok([]);

    try {
      return ok(
        await listTasks(ctx.supabase, ctx.accountId, {
          status,
          ...(mine && ctx.createdBy ? { assignedTo: ctx.createdBy } : {}),
        })
      );
    } catch (error) {
      if (isMissingTasksTable(error)) {
        return fail(
          'unavailable',
          'Tarefas indisponíveis neste servidor: falta aplicar a migration 060',
          503
        );
      }
      console.error('[api/v1/tasks] list error:', error);
      return fail('internal', 'Falha ao listar as tarefas', 500);
    }
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
