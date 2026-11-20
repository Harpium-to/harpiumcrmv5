// ============================================================
// POST /api/plataforma/v1/crms/{id}/aviso-agency-os
// Scope webhooks:manage, Leitura or membership, and the person must be
// an agency super_admin. Turns on (or re-arms, with a new secret) the
// `lead.received` webhook of that CRM to AGENCY_OS_WEBHOOK_URL. The
// secret comes back exactly once.
// ============================================================

import { requireRows, resolveCrmAccess } from '@/lib/plataforma/access'
import { logPlatformAccess } from '@/lib/plataforma/audit'
import { requirePlatformKey } from '@/lib/plataforma/auth'
import { PlatformError, ok, toPlatformErrorResponse } from '@/lib/plataforma/errors'
import { registerAgencyOsWebhook } from '@/lib/plataforma/aviso'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePlatformKey(request, 'webhooks:manage')
    const { id } = await params
    if (ctx.person.agencyRole !== 'super_admin') {
      throw new PlatformError('forbidden', 'Só um super admin da agência liga este aviso', 403, {
        reason: 'no_access',
      })
    }
    const access = await resolveCrmAccess(ctx.admin, ctx.person, id)
    requireRows(access)
    const hook = await registerAgencyOsWebhook(ctx.admin, id, ctx.person.userId)
    await logPlatformAccess(ctx.admin, {
      person: ctx.person,
      access: { ...access, via: 'agency' },
      action: 'api_register_webhook',
    })
    return ok(hook, hook.reused ? 200 : 201)
  } catch (err) {
    return toPlatformErrorResponse(err)
  }
}
