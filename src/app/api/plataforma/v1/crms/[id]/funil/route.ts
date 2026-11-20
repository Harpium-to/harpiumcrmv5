// ============================================================
// GET /api/plataforma/v1/crms/{id}/funil?pipeline=<id>
// Scope crms:read. Stage counts and totals at any level; the cards
// (with contact names) only when the person may read rows.
// ============================================================

import { isUuid, resolveCrmAccess } from '@/lib/plataforma/access'
import { logPlatformAccess } from '@/lib/plataforma/audit'
import { requirePlatformKey } from '@/lib/plataforma/auth'
import { ok, platformErrors, toPlatformErrorResponse } from '@/lib/plataforma/errors'
import { loadFunil } from '@/lib/plataforma/funil'
import { originOf } from '@/lib/plataforma/route-helpers'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePlatformKey(request, 'crms:read')
    const { id } = await params
    const access = await resolveCrmAccess(ctx.admin, ctx.person, id)
    const pipeline = new URL(request.url).searchParams.get('pipeline')
    if (pipeline && !isUuid(pipeline)) throw platformErrors.badRequest('Funil inválido')
    const funil = await loadFunil(ctx.admin, access, {
      origin: originOf(request),
      pipelineId: pipeline,
    })
    await logPlatformAccess(ctx.admin, { person: ctx.person, access, action: 'api_view_funnel' })
    return ok(funil)
  } catch (err) {
    return toPlatformErrorResponse(err)
  }
}
