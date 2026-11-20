// ============================================================
// GET /api/plataforma/v1/crms — the CRMs the person can see.
// Scope crms:read. Agency team: the whole portfolio, in aggregates
// (status, consent, health, usage, alerts). Others: their own CRMs.
// ?status=archived includes archived CRMs.
// ============================================================

import { requirePlatformKey } from '@/lib/plataforma/auth'
import { loadCarteira } from '@/lib/plataforma/carteira'
import { ok, toPlatformErrorResponse } from '@/lib/plataforma/errors'
import { originOf } from '@/lib/plataforma/route-helpers'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const ctx = await requirePlatformKey(request, 'crms:read')
    const url = new URL(request.url)
    const rows = await loadCarteira(ctx.admin, ctx.person, {
      origin: originOf(request),
      includeArchived: url.searchParams.get('status') === 'archived',
    })
    return ok(rows)
  } catch (err) {
    return toPlatformErrorResponse(err)
  }
}
