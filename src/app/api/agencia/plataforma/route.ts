// ============================================================
// PATCH /api/agencia/plataforma — instance-wide settings.
//
// Body: { autoPersonalAccount: boolean }
//
//   true   whoever signs up gets an empty CRM of their own (the
//          behaviour before the platform model)
//   false  signup creates only the login; the person waits on
//          /aguardando until the agency creates or links a CRM
//
// super_admin only. platform_settings has no client write policy
// (049), so the write goes through the service role.
// ============================================================

import { NextResponse } from 'next/server'

import { requireAgencia } from '@/lib/agencia/guard'
import { isMissingTable } from '@/lib/auth/account-context'
import { toErrorResponse } from '@/lib/auth/account'

export async function PATCH(request: Request) {
  try {
    const { admin } = await requireAgencia('super_admin')

    const body = (await request.json().catch(() => null)) as {
      autoPersonalAccount?: unknown
    } | null
    if (typeof body?.autoPersonalAccount !== 'boolean') {
      return NextResponse.json(
        { error: 'Informe autoPersonalAccount (true ou false).' },
        { status: 400 },
      )
    }

    const { error } = await admin
      .from('platform_settings')
      .update({
        auto_personal_account: body.autoPersonalAccount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', true)
    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json(
          { error: 'Isto exige a migration 049 aplicada no Supabase.' },
          { status: 409 },
        )
      }
      console.error('[PATCH /api/agencia/plataforma] update error:', error)
      return NextResponse.json({ error: 'Falha ao salvar.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
