// ============================================================
// POST /api/conectar-whatsapp/<token>
//   { code, waba_id?, phone_number_id?, business_id?, mode?, event? }
//
// The link without login (Fase A, migration 081): whoever opened
// /conectar-whatsapp/<token> went through Meta's popup, and this
// finishes the connection for THAT link's CRM — the same steps as the
// button inside the CRM (lib/whatsapp/finish-embedded-signup.ts).
//
// The link is taken before talking to Meta, so two tabs can't both use
// it; if the connection fails, it is given back and can be tried again.
// ============================================================

import { NextResponse } from 'next/server'

import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/whatsapp/admin-client'
import {
  claimConnectLink,
  findUsableConnectLink,
  releaseConnectLink,
} from '@/lib/whatsapp/connect-links'
import { finishEmbeddedSignup } from '@/lib/whatsapp/finish-embedded-signup'

const GONE =
  'Este link não vale mais: ele expira em 7 dias, serve para uma conexão só e para de funcionar quando um link novo é gerado. Peça outro para quem enviou.'

function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  )
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const limit = checkRateLimit(`wa-connect-link:${clientIp(request)}`, RATE_LIMITS.adminAction)
  if (!limit.success) return rateLimitResponse(limit)

  try {
    const { token } = await params
    const admin = supabaseAdmin()
    const link = await findUsableConnectLink(admin, token)
    if (!link) return NextResponse.json({ error: GONE }, { status: 410 })

    // whatsapp_config.user_id: who generated the link, else the owner.
    let userId = link.createdBy
    if (!userId) {
      const { data } = await admin
        .from('accounts')
        .select('owner_user_id')
        .eq('id', link.accountId)
        .maybeSingle()
      userId = (data?.owner_user_id as string | null) ?? null
    }
    if (!userId) return NextResponse.json({ error: GONE }, { status: 410 })

    if (!(await claimConnectLink(admin, link.id))) {
      return NextResponse.json({ error: GONE }, { status: 410 })
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    let result
    try {
      result = await finishEmbeddedSignup({
        db: admin,
        admin,
        accountId: link.accountId,
        userId,
        body,
      })
    } catch (err) {
      await releaseConnectLink(admin, link.id)
      throw err
    }
    if (!result.saved) await releaseConnectLink(admin, link.id)

    return NextResponse.json({ ...result.body, crm_name: link.crmName }, { status: result.status })
  } catch (err) {
    console.error('[conectar-whatsapp] failed:', err)
    return NextResponse.json(
      { error: 'Não foi possível concluir a conexão agora. Tente de novo em alguns minutos.' },
      { status: 500 },
    )
  }
}
