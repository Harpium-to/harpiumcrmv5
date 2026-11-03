import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { AGENT_COLUMNS, loadAgents, loadAgentStats, mapAgentRow } from '@/lib/agents/store'
import { parseAgentPayload, bad } from '@/lib/agents/payload'

/**
 * GET /api/agents
 *
 * The team plus the numbers above it. Any member may read — the live
 * monitor is for whoever is on shift, not just admins.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const [agents, stats] = await Promise.all([
      loadAgents(supabase, accountId),
      loadAgentStats(supabase, accountId),
    ])
    return NextResponse.json({ agents, stats })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/agents  (admin+)
 *
 * Create an agent. The account's AI credentials are not touched — an
 * agent borrows them (see migration 044), so creating one never asks
 * for a key.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`agents:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const parsed = parseAgentPayload(body, { partial: false })
    if ('error' in parsed) return bad(parsed.error)

    // Only one default per account (enforced by a partial unique index
    // too). Clear the incumbent first so promoting a new default is one
    // action for the user rather than "unset that one, then set this
    // one" — and so the insert can't bounce off the index.
    if (parsed.values.is_fallback === true) {
      await supabase
        .from('agents')
        .update({ is_fallback: false })
        .eq('account_id', accountId)
        .eq('is_fallback', true)
    }

    const { data, error } = await supabase
      .from('agents')
      .insert({ ...parsed.values, account_id: accountId, created_by: userId })
      .select(AGENT_COLUMNS)
      .single()

    if (error) {
      console.error('[agents POST] insert error:', error)
      return NextResponse.json(
        { error: 'Não foi possível criar o agente' },
        { status: 500 },
      )
    }

    return NextResponse.json({ agent: mapAgentRow(data) }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
