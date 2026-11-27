import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseRondaPayload, RONDA_COLUMNS } from '@/lib/agents/rondas-payload'

/** PATCH: edit or switch a round (admin+). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const { data: current } = await supabase
      .from('agent_rondas')
      .select('check_kind')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!current) return NextResponse.json({ error: 'Ronda não encontrada.' }, { status: 404 })
    const parsed = parseRondaPayload(
      body ? { ...body, checkKindForParam: (current as { check_kind: string }).check_kind } : null,
      { partial: true },
    )
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const update: Record<string, unknown> = { ...parsed.values }
    // A changed schedule, or switching it back on, runs from now.
    if ('every_minutes' in update || 'run_at' in update || update.is_active === true) {
      update.next_run_at = new Date().toISOString()
    }
    const { data, error } = await supabase
      .from('agent_rondas')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select(RONDA_COLUMNS)
      .single()
    if (error) throw error
    return NextResponse.json({ ronda: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE: remove a round (admin+). Its history goes with it. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params
    const { error } = await supabase.from('agent_rondas').delete().eq('id', id).eq('account_id', accountId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
