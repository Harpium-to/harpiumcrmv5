// ============================================================
// POST /api/agencia/crms — the agency creates a client CRM.
//
// Body: { name, ownerEmail, niche?, accessLevel?, managerUserId?, notes?,
//         templateId? }
//
// The CRM starts in onboarding, with the agency access level the
// agency proposes (the owner sees it before accepting) and an owner
// invitation bound to ownerEmail. Everything happens in one SQL
// function (agencia_create_account, migration 050), called with the
// operator's own session so the database checks their platform role
// and records them in the audit log.
// ============================================================

import { NextResponse } from 'next/server'

import { requireAgencia } from '@/lib/agencia/guard'
import { isAgencyAccessLevel, isCrmNiche } from '@/lib/agencia/crm'
import { newOwnerInvite, ownerInviteLink } from '@/lib/agencia/owner-invite'
import { describeApplySummary } from '@/lib/agencia/templates'
import { toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { rpcErrorToResponse } from '@/lib/supabase/rpc-error'
import { createClient } from '@/lib/supabase/server'

const MAX_NAME = 120
const MAX_NOTES = 2000

export async function POST(request: Request) {
  try {
    const { userId } = await requireAgencia('manager')

    const limit = checkRateLimit(`agencia:crmCreate:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const ownerEmail =
      typeof body?.ownerEmail === 'string' ? body.ownerEmail.trim().toLowerCase() : ''
    const niche = isCrmNiche(body?.niche) ? body.niche : null
    const accessLevel = isAgencyAccessLevel(body?.accessLevel) ? body.accessLevel : 'metrics'
    const managerUserId =
      typeof body?.managerUserId === 'string' && body.managerUserId !== ''
        ? body.managerUserId
        : null
    const notes = typeof body?.notes === 'string' ? body.notes.trim() : ''
    const templateId =
      typeof body?.templateId === 'string' && body.templateId ? body.templateId : null

    if (!name || name.length > MAX_NAME) {
      return NextResponse.json(
        { error: `Dê um nome ao CRM (até ${MAX_NAME} caracteres).` },
        { status: 400 },
      )
    }
    if (!ownerEmail) {
      return NextResponse.json({ error: 'Informe o e-mail do dono.' }, { status: 400 })
    }
    if (notes.length > MAX_NOTES) {
      return NextResponse.json(
        { error: `As observações podem ter até ${MAX_NOTES} caracteres.` },
        { status: 400 },
      )
    }

    const invite = newOwnerInvite()
    const supabase = await createClient()
    const { data: accountId, error } = await supabase.rpc('agencia_create_account', {
      p_name: name,
      p_owner_email: ownerEmail,
      p_token_hash: invite.hash,
      p_expires_at: invite.expiresAt.toISOString(),
      p_niche: niche,
      p_access_level: accessLevel,
      p_manager_user_id: managerUserId,
      p_notes: notes || null,
    })
    if (error) {
      return rpcErrorToResponse(error, {
        fallback: 'Falha ao criar o CRM',
        migration: '050',
        log: 'POST /api/agencia/crms',
      })
    }

    // The template goes in right after: the CRM is in onboarding, so the
    // agency may still write into it. Not in the same transaction — if
    // it fails the CRM exists without it, and the page can apply it.
    let template: { text: string } | { error: string } | null = null
    if (templateId) {
      const applied = await supabase.rpc('agencia_apply_template', {
        p_account_id: accountId,
        p_template_id: templateId,
      })
      template = applied.error
        ? { error: applied.error.message ?? 'Falha ao aplicar o modelo' }
        : { text: describeApplySummary((applied.data ?? {}) as Record<string, unknown>) }
    }

    return NextResponse.json(
      {
        accountId,
        template,
        invite: {
          ...ownerInviteLink(request, invite.token, 'POST /api/agencia/crms'),
          email: ownerEmail,
          expiresAt: invite.expiresAt.toISOString(),
        },
      },
      { status: 201 },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
