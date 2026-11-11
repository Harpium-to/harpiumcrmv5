// ============================================================
// POST /api/v1/conversations/{id}/flow/pause — stop the chatbot flow
// running on this conversation (scope: conversations:write)
//
// The run ends as `paused_by_agent`, as when an attendant replies from
// the inbox. Safe to repeat; with no flow running, nothing changes.
// Answers the conversation's state.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { pauseConversationFlow } from '@/lib/api/v1/conversation-state';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'conversations:write');
    const { id } = await params;
    try {
      const state = await pauseConversationFlow(ctx.supabase, ctx.accountId, id, ctx.createdBy);
      if (!state) return fail('not_found', 'Conversa não encontrada', 404);
      return ok(state);
    } catch (error) {
      console.error('[api/v1/conversations/flow/pause] error:', error);
      return fail('internal', 'Falha ao pausar o fluxo', 500);
    }
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
