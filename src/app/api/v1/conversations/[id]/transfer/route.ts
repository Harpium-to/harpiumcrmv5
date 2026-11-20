// ============================================================
// POST /api/v1/conversations/{id}/transfer — give a conversation to a
// person or a setor, with an optional note (scope: conversations:write)
//
// Body (one of):
//   { "to_user_id": "<uuid>", "note"?: "..." }   a teammate
//   { "to_team_id": "<uuid>", "note"?: "..." }   a setor: its own rule
//                                                (rodízio, menos ocupado
//                                                or fila) picks the person
//   { "to": "queue", "note"?: "..." }            back to the queue
//
// The same path as the inbox's "Transferir": the conversation's history
// records it (as coming from the API, by the person the key belongs
// to), whoever receives it is notified with the note, and the
// conversation.assigned webhook fires.
//
// Account-scoped: another account's conversation is a 404.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { TransferError, transferirConversa, type TransferTarget } from '@/lib/atendimento/transferir';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'conversations:write');
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail('invalid_body', 'Corpo da requisição inválido', 400);

    let target: TransferTarget;
    if (typeof body.to_user_id === 'string' && UUID_RE.test(body.to_user_id)) {
      target = { kind: 'pessoa', userId: body.to_user_id };
    } else if (typeof body.to_team_id === 'string' && UUID_RE.test(body.to_team_id)) {
      target = { kind: 'setor', teamId: body.to_team_id };
    } else if (body.to === 'queue') {
      target = { kind: 'ninguem' };
    } else {
      return fail('invalid_body', 'Informe to_user_id, to_team_id ou to: "queue"', 400);
    }
    const note = typeof body.note === 'string' ? body.note : null;
    if (note && note.trim().length > 500) return fail('invalid_body', 'note: até 500 caracteres', 400);

    // The conversation must be this account's (the service-role client
    // the API runs on would otherwise reach any CRM).
    const { data: conv, error: convErr } = await ctx.supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (convErr && convErr.code !== '22P02') {
      console.error('[api/v1/conversations/transfer] lookup error:', convErr);
      return fail('internal', 'Falha ao transferir a conversa', 500);
    }
    if (!conv) return fail('not_found', 'Conversa não encontrada', 404);

    try {
      const result = await transferirConversa(ctx.supabase, {
        conversationId: id,
        target,
        source: 'api',
        note,
        actorUserId: ctx.createdBy,
      });
      return ok({
        conversation_id: id,
        assigned_user_id: result.toUserId,
        team_id: result.teamId,
        changed: result.changed,
        // queued: in a setor's queue (nobody available, or a "fila" setor);
        // nobody_available: the CRM-wide rotation found nobody.
        status: result.reason === 'queued' ? 'queued' : result.ok ? 'assigned' : result.reason ?? 'unchanged',
      });
    } catch (error) {
      if (error instanceof TransferError && error.status === 400) {
        return fail('invalid_body', error.message, 400);
      }
      console.error('[api/v1/conversations/transfer] error:', error);
      return fail('internal', 'Falha ao transferir a conversa', 500);
    }
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
