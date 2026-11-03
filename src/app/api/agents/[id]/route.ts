import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { AGENT_COLUMNS, mapAgentRow } from '@/lib/agents/store'
import { parseAgentPayload, bad } from '@/lib/agents/payload'

/**
 * PATCH /api/agents/:id  (admin+)
 *
 * Partial update — the team screen's on/off switch sends nothing but
 * `{ is_active }`, so every field is optional here.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`agents:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const parsed = parseAgentPayload(body, { partial: true })
    if ('error' in parsed) return bad(parsed.error)
    if (Object.keys(parsed.values).length === 0) {
      return bad('Nada para atualizar')
    }

    // Demote the current default before promoting this one — see the
    // note in POST. Scoped to other rows so re-saving the existing
    // default doesn't clear itself.
    if (parsed.values.is_fallback === true) {
      await supabase
        .from('agents')
        .update({ is_fallback: false })
        .eq('account_id', accountId)
        .eq('is_fallback', true)
        .neq('id', id)
    }

    const { data, error } = await supabase
      .from('agents')
      .update(parsed.values)
      // RLS already scopes writes to the caller's account; the explicit
      // filter makes that true in the query as well, so a leaked id
      // from another account reads as "not found" rather than relying
      // on the policy alone.
      .eq('id', id)
      .eq('account_id', accountId)
      .select(AGENT_COLUMNS)
      .maybeSingle()

    if (error) {
      console.error('[agents PATCH] update error:', error)
      return NextResponse.json(
        { error: 'Não foi possível salvar o agente' },
        { status: 500 },
      )
    }
    if (!data) {
      return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })
    }

    return NextResponse.json({ agent: mapAgentRow(data) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/agents/:id  (admin+)
 *
 * The agent goes; its runs stay. `agent_runs.agent_id` is ON DELETE
 * SET NULL and each run carries a name snapshot, so the history keeps
 * reading correctly after the agent is gone.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`agents:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { error } = await supabase
      .from('agents')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)

    if (error) {
      console.error('[agents DELETE] error:', error)
      return NextResponse.json(
        { error: 'Não foi possível excluir o agente' },
        { status: 500 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
