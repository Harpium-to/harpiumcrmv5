// ============================================================
// GET /api/invitations/mine — open invitations addressed to the
// caller's login email (migration 050). This is what lets someone who
// signed up and is waiting for access accept their CRM from inside the
// app, without the link.
// ============================================================

import { NextResponse } from 'next/server'

import { isMissingFunction } from '@/lib/auth/account-context'
import { createClient } from '@/lib/supabase/server'
import type { MyInvitation } from '@/types/platform'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const { data, error } = await supabase.rpc('my_pending_invitations')
  if (error) {
    if (isMissingFunction(error)) return NextResponse.json({ invitations: [] })
    console.error('[GET /api/invitations/mine] rpc error:', error)
    return NextResponse.json({ error: 'Falha ao buscar convites' }, { status: 500 })
  }

  const invitations: MyInvitation[] = (
    (data ?? []) as Array<Record<string, unknown>>
  ).map((r) => ({
    id: String(r.invitation_id),
    accountName: String(r.account_name ?? ''),
    role: String(r.role ?? ''),
    expiresAt: String(r.expires_at ?? ''),
    agencyLevel: typeof r.agency_level === 'string' ? r.agency_level : null,
  }))

  return NextResponse.json({ invitations })
}
