// ============================================================
// GET  /api/agencia/integracoes — the platform keys (super_admin)
// POST /api/agencia/integracoes — create one; the plaintext comes
//                                  back exactly once
//
// Platform keys let the agency's internal system (Agency OS) read the
// CRMs through /api/plataforma/v1. See docs/plano-integracao-agency-os.md.
// ============================================================

import { NextResponse } from 'next/server'

import { requireAgencia } from '@/lib/agencia/guard'
import { toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { normalizeScopes } from '@/lib/plataforma/scopes'
import { createPlatformKey, listPlatformKeys } from '@/lib/plataforma/store'

function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null
  return (
    e?.code === '42P01' || e?.code === 'PGRST205' || /schema cache|does not exist/i.test(e?.message ?? '')
  )
}

export async function GET() {
  try {
    const { admin } = await requireAgencia('super_admin')
    try {
      return NextResponse.json({ available: true, keys: await listPlatformKeys(admin) })
    } catch (err) {
      if (isMissingTable(err)) return NextResponse.json({ available: false, keys: [] })
      throw err
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { admin, userId } = await requireAgencia('super_admin')
    const limit = checkRateLimit(`plat-keys:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) {
      return NextResponse.json({ error: 'Muitas tentativas. Aguarde um minuto.' }, { status: 429 })
    }

    const body = (await request.json().catch(() => ({}))) as { name?: unknown; scopes?: unknown }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 80) {
      return NextResponse.json({ error: 'Dê um nome à chave (até 80 letras).' }, { status: 400 })
    }
    const scopes = normalizeScopes(body.scopes)
    if (scopes.length === 0) {
      return NextResponse.json({ error: 'Escolha pelo menos uma permissão.' }, { status: 400 })
    }

    const key = await createPlatformKey(admin, { name, scopes, createdBy: userId })
    return NextResponse.json({ key }, { status: 201 })
  } catch (err) {
    if (isMissingTable(err)) {
      return NextResponse.json(
        { error: 'Falta aplicar a migration 075 no banco.' },
        { status: 503 },
      )
    }
    return toErrorResponse(err)
  }
}
