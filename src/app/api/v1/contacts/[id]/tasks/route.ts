// ============================================================
// GET  /api/v1/contacts/{id}/tasks — a contact's tasks (scope: tasks:read)
// POST /api/v1/contacts/{id}/tasks — add a task       (scope: tasks:write)
//
// A task is a to-do about the contact, for a person: "ligar na
// quinta". `GET` returns the open ones, soonest first (`?status=done`
// or `all` for the rest), at most 100. `POST` takes `title` and an
// optional `due_at`; the task is for the person the key belongs to,
// who is reminded when it comes due.
//
// Account-scoped: a contact belonging to another account is a 404.
// Needs migration 060; without it both answer 503.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getContactById } from '@/lib/api/v1/contacts';
import { resolveNoteAuthor } from '@/lib/api/v1/notes';
import {
  createTask,
  isMissingTasksTable,
  listTasks,
  parseTaskCreate,
  parseTaskStatus,
} from '@/lib/api/v1/tasks';

const UNAVAILABLE = 'Tarefas indisponíveis neste servidor: falta aplicar a migration 060';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'tasks:read');
    const { id } = await params;
    const contact = await getContactById(ctx.supabase, ctx.accountId, id);
    if (!contact) return fail('not_found', 'Contato não encontrado', 404);

    const status = parseTaskStatus(new URL(request.url).searchParams.get('status'));
    try {
      return ok(await listTasks(ctx.supabase, ctx.accountId, { contactId: contact.id, status }));
    } catch (error) {
      if (isMissingTasksTable(error)) return fail('unavailable', UNAVAILABLE, 503);
      console.error('[api/v1/contacts/tasks] list error:', error);
      return fail('internal', 'Falha ao listar as tarefas', 500);
    }
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'tasks:write');
    const { id } = await params;

    const parsed = parseTaskCreate(await request.json().catch(() => null));
    if (!parsed.ok) return fail('bad_request', parsed.message, 400);

    const contact = await getContactById(ctx.supabase, ctx.accountId, id);
    if (!contact) return fail('not_found', 'Contato não encontrado', 404);

    try {
      // The same person a note by this key is by: the one it belongs to.
      const person = await resolveNoteAuthor(ctx);
      const task = await createTask(ctx.supabase, ctx.accountId, contact.id, person, parsed.values);
      return ok(task, 201);
    } catch (error) {
      if (isMissingTasksTable(error)) return fail('unavailable', UNAVAILABLE, 503);
      console.error('[api/v1/contacts/tasks] create error:', error);
      return fail('internal', 'Falha ao criar a tarefa', 500);
    }
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
