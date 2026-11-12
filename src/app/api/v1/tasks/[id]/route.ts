// ============================================================
// PATCH /api/v1/tasks/{id} — update a task (scope: tasks:write)
//
// Updates only the fields sent: `title`, `due_at` (an ISO date-time
// with offset, or null) and `done` (true marks it done now, false
// reopens it). Moving `due_at` makes the task remind again.
//
// Account-scoped: another account's task is a 404.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { isMissingTasksTable, parseTaskPatch, updateTask } from '@/lib/api/v1/tasks';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'tasks:write');
    const { id } = await params;

    const parsed = parseTaskPatch(await request.json().catch(() => null));
    if (!parsed.ok) return fail('bad_request', parsed.message, 400);

    try {
      const task = await updateTask(ctx.supabase, ctx.accountId, id, parsed.values);
      if (!task) return fail('not_found', 'Tarefa não encontrada', 404);
      return ok(task);
    } catch (error) {
      if (isMissingTasksTable(error)) {
        return fail(
          'unavailable',
          'Tarefas indisponíveis neste servidor: falta aplicar a migration 060',
          503
        );
      }
      console.error('[api/v1/tasks] update error:', error);
      return fail('internal', 'Falha ao atualizar a tarefa', 500);
    }
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
