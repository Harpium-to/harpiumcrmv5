import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { AGENT_COLUMNS, mapAgentRow } from '@/lib/agents/store'

/**
 * What a copy inherits: the configuration, and nothing else.
 *
 * Everything an agent *is* comes across — persona, tools, autonomy,
 * hours, targets. Everything it has *done* does not, and that split is
 * the whole design of this route:
 *
 *   is_fallback   forced false. At most one agent per account takes
 *                 the unmatched inbound (partial unique index in 044),
 *                 so copying the flag would either bounce off the
 *                 index or silently move the default to a clone nobody
 *                 has looked at yet.
 *   is_active     forced false. You duplicate an agent to change it.
 *                 A copy that starts answering customers the instant
 *                 you click the button is a copy that answers them
 *                 with the previous agent's script.
 *   status, cost  reset. Operational state and spend belong to the
 *                 agent that did the work; a clone has done nothing
 *                 and spent nothing, and showing it mid-conversation
 *                 would be a lie about which row the runner is holding.
 *
 * `keywords` *are* copied even though two agents matching the same
 * words is a routing conflict — because the copy is off, the conflict
 * cannot bite before the operator opens the form, and a clone with its
 * routing stripped is useless as a starting point. The order the
 * router uses (priority, then age) breaks the tie deterministically if
 * they ever both run.
 */
const COPIED_COLUMNS = [
  'name',
  'role',
  'avatar_url',
  'objective',
  'autonomy',
  'tools',
  'channels',
  'require_approval_for',
  'work_days',
  'work_start',
  'work_end',
  'timezone',
  'goals',
  'department',
  'system_prompt',
  'model',
  'keywords',
  'priority',
  'max_replies_per_conversation',
  'handoff_agent_id',
] as const

type CopiedColumn = (typeof COPIED_COLUMNS)[number]
type AgentCopy = Record<CopiedColumn, unknown> & { name: string }

const MAX_NAME = 80

/**
 * POST /api/agents/:id/duplicate  (admin+)
 *
 * The suffix is Portuguese like every other operator-facing string
 * these routes produce. It is truncated from the left so a long name
 * loses its tail rather than its marker — "(cópia)" is the part that
 * has to survive for the list to make sense.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`agents:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { data: source, error: readError } = await supabase
      .from('agents')
      .select(COPIED_COLUMNS.join(', '))
      // RLS scopes this already; the explicit filter makes a leaked id
      // from another account read as "not found" rather than relying
      // on the policy alone.
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle<AgentCopy>()

    if (readError) {
      console.error('[agents duplicate] read error:', readError)
      return NextResponse.json(
        { error: 'Não foi possível duplicar o agente' },
        { status: 500 },
      )
    }
    if (!source) {
      return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })
    }

    const suffix = ' (cópia)'
    const base = String(source.name ?? '').trim()
    const name = `${base.slice(0, MAX_NAME - suffix.length)}${suffix}`

    // Built column by column from the list above rather than spread
    // from the row. Spreading would make the exclusions a property of
    // the SELECT — true today, and silently false the first time
    // somebody widens it to `*` the way the automations duplicate
    // route does. The list governs both halves, so what is not copied
    // cannot start being copied by accident.
    const values: Record<string, unknown> = {}
    for (const column of COPIED_COLUMNS) {
      values[column] = source[column]
    }

    const { data, error } = await supabase
      .from('agents')
      .insert({
        ...values,
        name,
        account_id: accountId,
        created_by: userId,
        is_fallback: false,
        is_active: false,
      })
      .select(AGENT_COLUMNS)
      .single()

    if (error) {
      console.error('[agents duplicate] insert error:', error)
      return NextResponse.json(
        { error: 'Não foi possível duplicar o agente' },
        { status: 500 },
      )
    }

    return NextResponse.json({ agent: mapAgentRow(data) }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
