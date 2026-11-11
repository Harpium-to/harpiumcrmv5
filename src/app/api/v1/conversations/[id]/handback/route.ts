// ============================================================
// POST /api/v1/conversations/{id}/handback — give it back to the AI
// (scope: conversations:write)
//
// The opposite of /takeover, and what "Retomar IA" does in the inbox:
// clears the pause and the handoff note, releases the owner and gives
// the bot a fresh reply budget here. Answers the conversation's state.
//
// Account-scoped: another account's conversation is a 404.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { handBackConversation } from '@/lib/api/v1/conversation-state';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'conversations:write');
    const { id } = await params;
    try {
      const state = await handBackConversation(ctx.supabase, ctx.accountId, id, ctx.createdBy);
      if (!state) return fail('not_found', 'Conversa não encontrada', 404);
      return ok(state);
    } catch (error) {
      console.error('[api/v1/conversations/handback] error:', error);
      return fail('internal', 'Falha ao devolver a conversa para a IA', 500);
    }
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
