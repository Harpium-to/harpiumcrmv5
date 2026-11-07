// ============================================================
// POST /api/account/leave-support — the agency leaves a client CRM
// (support mode) and goes back to its own CRM, or to none. Audited as
// 'leave_account' (migration 055). A no-op outside support mode.
// ============================================================

import { NextResponse } from 'next/server'

import { rpcErrorToResponse } from '@/lib/supabase/rpc-error'
import { createClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const { data, error } = await supabase.rpc('leave_agency_session')
  if (error) {
    return rpcErrorToResponse(error, {
      fallback: 'Falha ao sair do modo suporte',
      migration: '055',
      log: 'POST /api/account/leave-support',
    })
  }
  return NextResponse.json({ ok: true, activeAccountId: data ?? null })
}
