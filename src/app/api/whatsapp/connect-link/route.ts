// ============================================================
// /api/whatsapp/connect-link — "Mandar link para outra pessoa
// conectar" in Settings › WhatsApp (Fase A, migration 081).
//
// Admins of the active CRM only: the link connects this CRM's official
// WhatsApp without login. Answers in lib/whatsapp/connect-link-api.ts.
// ============================================================

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/whatsapp/admin-client'
import {
  cancelConnectLinks,
  connectLinkStatus,
  newConnectLink,
} from '@/lib/whatsapp/connect-link-api'

export async function GET() {
  try {
    const { accountId } = await requireRole('admin')
    return await connectLinkStatus(supabaseAdmin(), accountId)
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId, account } = await requireRole('admin')
    const limit = checkRateLimit(`wa-connect-link-new:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    return await newConnectLink(request, supabaseAdmin(), {
      accountId,
      userId,
      via: 'crm',
      crmName: account?.name ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const { accountId } = await requireRole('admin')
    return await cancelConnectLinks(supabaseAdmin(), accountId)
  } catch (err) {
    return toErrorResponse(err)
  }
}
