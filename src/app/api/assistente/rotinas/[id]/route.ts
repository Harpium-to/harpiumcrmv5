import { NextResponse } from 'next/server'

import { fail, resolve } from '@/lib/assistente/http'
import { nextRunAt } from '@/lib/assistente/time'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function own(id: string) {
  const { ctx } = await resolve()
  const { data } = await ctx.admin
    .from('assistant_routines')
    .select('id, user_id, weekdays, run_time, timezone')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  const isAdmin = ctx.role === 'owner' || ctx.role === 'admin'
  const row = data as { id: string; user_id: string; weekdays: number[]; run_time: string; timezone: string } | null
  if (!row || (row.user_id !== ctx.userId && !isAdmin) || ctx.readOnly) return { ctx, row: null }
  return { ctx, row }
}

/** PATCH /api/assistente/rotinas/[id]  { ativa: boolean } — switch a routine on/off from settings. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Rotina inválida' }, { status: 400 })
  try {
    const body = (await request.json().catch(() => null)) as { ativa?: unknown } | null
    if (typeof body?.ativa !== 'boolean') return NextResponse.json({ error: "'ativa' precisa ser true/false" }, { status: 400 })
    const { ctx, row } = await own(id)
    if (!row) return NextResponse.json({ error: 'Rotina não encontrada' }, { status: 404 })
    const next = body.ativa ? nextRunAt(row.weekdays, row.run_time, row.timezone, new Date()) : null
    const { error } = await ctx.admin
      .from('assistant_routines')
      .update({ is_active: body.ativa, next_run_at: next?.toISOString() ?? null, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    return fail(err)
  }
}

/** DELETE /api/assistente/rotinas/[id] */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Rotina inválida' }, { status: 400 })
  try {
    const { ctx, row } = await own(id)
    if (!row) return NextResponse.json({ error: 'Rotina não encontrada' }, { status: 404 })
    const { error } = await ctx.admin.from('assistant_routines').delete().eq('id', id).eq('account_id', ctx.accountId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    return fail(err)
  }
}
