// ============================================================
// GET /api/v1/contacts/{id}/conversation — where the contact's
// conversation stands (scope: conversations:read)
//
// The contact's most recently active WhatsApp conversation in the CRM,
// with what an attendant needs to know before answering: whether the
// bot is replying (`ai`), whether the customer is waiting for a person
// (`waiting_since`), and who owns it. `data` is `null` when the CRM has
// no conversation with this contact.
//
// Account-scoped: a contact belonging to another account is a 404.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getContactById } from '@/lib/api/v1/contacts';
import { getContactConversationState } from '@/lib/api/v1/conversation-state';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');
    const { id } = await params;
    const contact = await getContactById(ctx.supabase, ctx.accountId, id);
    if (!contact) return fail('not_found', 'Contato não encontrado', 404);

    try {
      return ok(
        await getContactConversationState(ctx.supabase, ctx.accountId, contact.id, ctx.createdBy)
      );
    } catch (error) {
      console.error('[api/v1/contacts/conversation] read error:', error);
      return fail('internal', 'Falha ao ler a conversa', 500);
    }
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
