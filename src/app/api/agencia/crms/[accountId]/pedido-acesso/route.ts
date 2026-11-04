// ============================================================
// POST /api/agencia/crms/[accountId]/pedido-acesso
//
// The agency asks the CRM owner for more access (migration 051).
// Body: { level: 'read' | 'full', hours?: number | null, reason?: string }
//
// The owner gets a notification and answers in their settings. The
// database checks the platform role and portfolio, refuses asking for
// what is already granted, and replaces any open request.
// ============================================================

import { NextResponse } from 'next/server'

import { requireAgencia } from '@/lib/agencia/guard'
import { toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { rpcErrorToResponse } from '@/lib/supabase/rpc-error'
import { createClient } from '@/lib/supabase/server'

const MAX_REASON = 500

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { userId } = await requireAgencia('manager')
    const { accountId } = await params

    const limit = checkRateLimit(`agencia:accessRequest:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const level = body?.level
    if (level !== 'read' && level !== 'full') {
      return NextResponse.json({ error: 'Peça Leitura ou Total.' }, { status: 400 })
    }
    const hours =
      typeof body?.hours === 'number' && Number.isInteger(body.hours) ? body.hours : null
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
    if (reason.length > MAX_REASON) {
      return NextResponse.json(
        { error: `O motivo pode ter até ${MAX_REASON} caracteres.` },
        { status: 400 },
      )
    }

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('agencia_request_access', {
      p_account_id: accountId,
      p_level: level,
      p_reason: reason || null,
      p_temp_hours: hours,
    })
    if (error) {
      return rpcErrorToResponse(error, {
        fallback: 'Falha ao enviar o pedido',
        migration: '051',
        log: 'POST pedido-acesso',
      })
    }
    return NextResponse.json({ ok: true, requestId: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
