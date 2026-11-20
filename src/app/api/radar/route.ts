import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { loadRadarPanel } from '@/lib/radar/painel'

/**
 * GET /api/radar  (any member) — the Radar screen: alerts, the month's
 * forecast, who is cooling down, deals stopped, the last weekly digest.
 * docs/plano-radar-monitoramento.md §4.
 */
export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    return NextResponse.json(await loadRadarPanel(supabase, supabaseAdmin(), { accountId, role }))
  } catch (err) {
    return toErrorResponse(err)
  }
}
