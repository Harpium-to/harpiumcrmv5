import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { loadAgentRuns } from '@/lib/agents/store'

/**
 * GET /api/agents/runs?limit=50
 *
 * The live monitor's initial page. Subsequent rows arrive over
 * Supabase Realtime, so this is only ever called once per mount — it
 * is the backfill, not a poll.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const limitParam = Number(new URL(request.url).searchParams.get('limit'))
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50

    const runs = await loadAgentRuns(supabase, accountId, limit)
    return NextResponse.json({ runs })
  } catch (err) {
    return toErrorResponse(err)
  }
}
