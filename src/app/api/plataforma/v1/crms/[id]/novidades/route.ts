// ============================================================
// GET /api/plataforma/v1/crms/{id}/novidades?desde=<ISO>
// Scope crms:read. New leads, deals won/lost and conversations that
// started waiting, since `desde` (≤ 7 days). Names only with Leitura.
// ============================================================

import { resolveCrmAccess } from '@/lib/plataforma/access'
import { logPlatformAccess } from '@/lib/plataforma/audit'
import { requirePlatformKey } from '@/lib/plataforma/auth'
import { ok, toPlatformErrorResponse } from '@/lib/plataforma/errors'
import { loadNovidades } from '@/lib/plataforma/novidades'
import { originOf } from '@/lib/plataforma/route-helpers'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePlatformKey(request, 'crms:read')
    const { id } = await params
    const access = await resolveCrmAccess(ctx.admin, ctx.person, id)
    const news = await loadNovidades(
      ctx.admin,
      access,
      new URL(request.url).searchParams.get('desde'),
      { origin: originOf(request) },
    )
    await logPlatformAccess(ctx.admin, { person: ctx.person, access, action: 'api_view_news' })
    return ok(news)
  } catch (err) {
    return toPlatformErrorResponse(err)
  }
}
