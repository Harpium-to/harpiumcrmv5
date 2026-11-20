// ============================================================
// GET /api/plataforma/v1/crms/{id}/resumo?dias=7|30|90
// Scope crms:read. The operation of one CRM seen from above; the
// short lists (with names) only when the person may read rows.
// Agency reads are audited (at most once per 30 min).
// ============================================================

import { resolveCrmAccess } from '@/lib/plataforma/access'
import { logPlatformAccess } from '@/lib/plataforma/audit'
import { requirePlatformKey } from '@/lib/plataforma/auth'
import { ok, toPlatformErrorResponse } from '@/lib/plataforma/errors'
import { loadResumo, parseSummaryWindow } from '@/lib/plataforma/resumo'
import { originOf } from '@/lib/plataforma/route-helpers'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePlatformKey(request, 'crms:read')
    const { id } = await params
    const access = await resolveCrmAccess(ctx.admin, ctx.person, id)
    const days = parseSummaryWindow(new URL(request.url).searchParams.get('dias'))
    const summary = await loadResumo(ctx.admin, access, days, { origin: originOf(request) })
    await logPlatformAccess(ctx.admin, {
      person: ctx.person,
      access,
      action: 'api_view_summary',
      detalhe: `${days} dias`,
    })
    return ok(summary)
  } catch (err) {
    return toPlatformErrorResponse(err)
  }
}
