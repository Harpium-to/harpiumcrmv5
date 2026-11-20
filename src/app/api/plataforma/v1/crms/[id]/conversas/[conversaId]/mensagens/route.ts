// ============================================================
// GET /api/plataforma/v1/crms/{id}/conversas/{conversaId}/mensagens
// Scope dados:read, Leitura or membership. A conversation of another
// CRM is "not found". Each agency read is audited (the conversation id
// goes in the log, as when the console opens one).
// ============================================================

import { requireRows, resolveCrmAccess } from '@/lib/plataforma/access'
import { logPlatformAccess } from '@/lib/plataforma/audit'
import { requirePlatformKey } from '@/lib/plataforma/auth'
import { okList, toPlatformErrorResponse } from '@/lib/plataforma/errors'
import { loadMessages } from '@/lib/plataforma/listas'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; conversaId: string }> },
) {
  try {
    const ctx = await requirePlatformKey(request, 'dados:read')
    const { id, conversaId } = await params
    const access = await resolveCrmAccess(ctx.admin, ctx.person, id)
    requireRows(access)
    const page = await loadMessages(ctx.admin, id, conversaId, request)
    await logPlatformAccess(ctx.admin, {
      person: ctx.person,
      access,
      action: 'api_view_conversation',
      conversationId: conversaId,
    })
    return okList(page.items, page.nextCursor)
  } catch (err) {
    return toPlatformErrorResponse(err)
  }
}
