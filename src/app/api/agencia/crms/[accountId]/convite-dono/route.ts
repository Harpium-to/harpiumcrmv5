// ============================================================
// POST /api/agencia/crms/[accountId]/convite-dono
//
// New owner invitation for an existing CRM: the link was lost, the
// email was wrong, or the agency is handing a CRM it set up (or its
// own) over to someone. Earlier open owner invitations for the CRM
// stop working. The person who accepts becomes the owner; a previous
// owner stays on as admin.
//
// Body: { email }
// ============================================================

import { NextResponse } from 'next/server'

import { requireAgencia } from '@/lib/agencia/guard'
import { newOwnerInvite, ownerInviteLink } from '@/lib/agencia/owner-invite'
import { toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { rpcErrorToResponse } from '@/lib/supabase/rpc-error'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { userId } = await requireAgencia('manager')
    const { accountId } = await params

    const limit = checkRateLimit(`agencia:ownerInvite:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as { email?: unknown } | null
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!email) {
      return NextResponse.json({ error: 'Informe o e-mail do dono.' }, { status: 400 })
    }

    const invite = newOwnerInvite()
    const supabase = await createClient()
    const { error } = await supabase.rpc('agencia_invite_owner', {
      p_account_id: accountId,
      p_owner_email: email,
      p_token_hash: invite.hash,
      p_expires_at: invite.expiresAt.toISOString(),
    })
    if (error) {
      return rpcErrorToResponse(error, {
        fallback: 'Falha ao criar o convite',
        migration: '050',
        log: 'POST convite-dono',
      })
    }

    return NextResponse.json(
      {
        invite: {
          ...ownerInviteLink(request, invite.token, 'POST convite-dono'),
          email,
          expiresAt: invite.expiresAt.toISOString(),
        },
      },
      { status: 201 },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
