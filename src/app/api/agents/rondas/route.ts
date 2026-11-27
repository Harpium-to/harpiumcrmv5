import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { parseRondaPayload, RONDA_COLUMNS } from '@/lib/agents/rondas-payload'

// ============================================================
// /api/agents/rondas — the agents' rounds (082, Fase 2).
// GET any member, with each round's last runs; POST admin+.
// ============================================================

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('agent_rondas')
      .select(RONDA_COLUMNS)
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
    if (error) throw error
    const ids = (data ?? []).map((r) => (r as { id: string }).id)
    const { data: runs } =
      ids.length > 0
        ? await supabase
            .from('agent_ronda_runs')
            .select('ronda_id, ran_at, found, queued, skipped, note')
            .in('ronda_id', ids)
            .order('ran_at', { ascending: false })
            .limit(200)
        : { data: [] }
    return NextResponse.json({ rondas: data ?? [], runs: runs ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`rondas:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const parsed = parseRondaPayload(await request.json().catch(() => null), { partial: false })
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { data: agent } = await supabase
      .from('agents')
      .select('id')
      .eq('id', parsed.values.agent_id!)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!agent) return NextResponse.json({ error: 'Agente não encontrado.' }, { status: 404 })

    const { data, error } = await supabase
      .from('agent_rondas')
      .insert({ ...parsed.values, account_id: accountId, created_by: userId })
      .select(RONDA_COLUMNS)
      .single()
    if (error) {
      console.error('[rondas POST] insert error:', error)
      return NextResponse.json({ error: 'Não foi possível criar a ronda.' }, { status: 500 })
    }
    return NextResponse.json({ ronda: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
