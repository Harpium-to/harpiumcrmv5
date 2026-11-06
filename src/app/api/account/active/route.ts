// ============================================================
// POST /api/account/active — switch the CRM the caller has open.
//
// Body: { accountId }
//
// set_active_account (049/050) allows a CRM the caller is a member
// of, or — for the agency — one whose owner granted at least read
// access (that entry is audited). Everything else the app does reads
// the active CRM, so the client reloads after this.
// ============================================================

import { NextResponse } from 'next/server'

import { rpcErrorToResponse } from '@/lib/supabase/rpc-error'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { accountId?: unknown } | null
  if (typeof body?.accountId !== 'string' || !body.accountId) {
    return NextResponse.json({ error: 'Informe o CRM.' }, { status: 400 })
  }

  const { error } = await supabase.rpc('set_active_account', {
    p_account_id: body.accountId,
  })
  if (error) {
    return rpcErrorToResponse(error, {
      fallback: 'Falha ao trocar de CRM',
      migration: '049',
      log: 'POST /api/account/active',
    })
  }
  return NextResponse.json({ ok: true })
}
