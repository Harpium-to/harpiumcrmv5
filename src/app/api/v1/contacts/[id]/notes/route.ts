// ============================================================
// GET  /api/v1/contacts/{id}/notes — a contact's notes (scope: contacts:read)
// POST /api/v1/contacts/{id}/notes — add a note        (scope: contacts:write)
//
// Notes are the team's own annotations about a contact — never sent to
// the customer. The list is newest first and not paginated: `?limit=`
// (default 20, at most 50) returns the most recent ones.
//
// Both are account-scoped: a contact belonging to another account is a
// 404 (never 403 — don't reveal it exists elsewhere).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getContactById } from '@/lib/api/v1/contacts';
import {
  createContactNote,
  listContactNotes,
  parseNoteBody,
  parseNotesLimit,
  resolveNoteAuthor,
} from '@/lib/api/v1/notes';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'contacts:read');
    const { id } = await params;
    const contact = await getContactById(ctx.supabase, ctx.accountId, id);
    if (!contact) return fail('not_found', 'Contato não encontrado', 404);

    const limit = parseNotesLimit(new URL(request.url).searchParams.get('limit'));
    try {
      return ok(await listContactNotes(ctx.supabase, ctx.accountId, contact.id, limit));
    } catch (error) {
      console.error('[api/v1/contacts/notes] list error:', error);
      return fail('internal', 'Falha ao listar as anotações', 500);
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
    const ctx = await requireApiKey(request, 'contacts:write');
    const { id } = await params;

    const parsed = parseNoteBody(await request.json().catch(() => null));
    if (!parsed.ok) return fail('bad_request', parsed.message, 400);

    const contact = await getContactById(ctx.supabase, ctx.accountId, id);
    if (!contact) return fail('not_found', 'Contato não encontrado', 404);

    try {
      const author = await resolveNoteAuthor(ctx);
      const note = await createContactNote(
        ctx.supabase,
        ctx.accountId,
        contact.id,
        author,
        parsed.text
      );
      return ok(note, 201);
    } catch (error) {
      console.error('[api/v1/contacts/notes] create error:', error);
      return fail('internal', 'Falha ao salvar a anotação', 500);
    }
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
