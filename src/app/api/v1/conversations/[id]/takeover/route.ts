// ============================================================
// POST /api/v1/conversations/{id}/takeover — take a conversation over
// (scope: conversations:write)
//
// Pauses the bot on this conversation and makes the person the key
// belongs to its owner — what "Assumir" does in the inbox. Safe to
// repeat. Handing the conversation back to the bot is done in the CRM.
//
// Account-scoped: another account's conversation is a 404.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { takeOverConversation } from '@/lib/api/v1/conversation-state';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'conversations:write');
    const { id } = await params;
    try {
      const state = await takeOverConversation(ctx.supabase, ctx.accountId, id, ctx.createdBy);
      if (!state) return fail('not_found', 'Conversa não encontrada', 404);
      return ok(state);
    } catch (error) {
      console.error('[api/v1/conversations/takeover] error:', error);
      return fail('internal', 'Falha ao assumir a conversa', 500);
    }
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
