// ============================================================
// GET /api/account/mine — the CRMs the caller belongs to, for the
// CRM switcher, plus whether they are on the agency team.
//
// Before migration 049 there is one CRM per user and no switcher:
// the list is empty and the UI hides itself.
// ============================================================

import { NextResponse } from 'next/server'

import { isMissingFunction } from '@/lib/auth/account-context'
import { isAccountRole } from '@/lib/auth/roles'
import { toCrmStatus } from '@/lib/agencia/crm'
import { createClient } from '@/lib/supabase/server'
import type { MyAccount } from '@/types/platform'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const [listRes, agencyRes] = await Promise.all([
    supabase.rpc('list_my_accounts'),
    supabase.rpc('is_agencia'),
  ])

  let accounts: MyAccount[] = []
  if (listRes.error) {
    if (!isMissingFunction(listRes.error)) {
      console.error('[GET /api/account/mine] list error:', listRes.error)
      return NextResponse.json({ error: 'Falha ao listar seus CRMs' }, { status: 500 })
    }
  } else {
    accounts = ((listRes.data ?? []) as Array<Record<string, unknown>>).flatMap((r) =>
      typeof r.account_id === 'string' && isAccountRole(r.role)
        ? [
            {
              id: r.account_id,
              name: typeof r.account_name === 'string' ? r.account_name : '',
              role: r.role,
              status: toCrmStatus(r.status),
              active: r.is_active === true,
            },
          ]
        : [],
    )
  }

  return NextResponse.json({
    accounts,
    isAgencia: agencyRes.data === true,
  })
}
