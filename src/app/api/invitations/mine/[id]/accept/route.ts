// ============================================================
// POST /api/invitations/mine/[id]/accept — accept an invitation
// addressed to the caller's email, without the link (migration 050).
// The database re-checks that the invitation is bound to this email.
// ============================================================

import { NextResponse } from 'next/server'

import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { rpcErrorToResponse } from '@/lib/supabase/rpc-error'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const limit = checkRateLimit(`invite:acceptMine:${user.id}`, RATE_LIMITS.invitationRedeem)
  if (!limit.success) return rateLimitResponse(limit)

  const { id } = await params
  const { data: accountId, error } = await supabase.rpc('accept_my_invitation', {
    p_invitation_id: id,
  })
  if (error) {
    return rpcErrorToResponse(error, {
      fallback: 'Falha ao aceitar o convite',
      migration: '050',
      log: 'POST /api/invitations/mine/[id]/accept',
    })
  }
  return NextResponse.json({ ok: true, accountId })
}
