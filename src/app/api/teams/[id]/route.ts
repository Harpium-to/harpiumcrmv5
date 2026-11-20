import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  clearOtherEntry,
  listTeams,
  parseTeamPayload,
  setTeamMembers,
} from '@/lib/atendimento/setores'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH  /api/teams/[id]  (admin+) — change a setor and/or its people.
 * DELETE /api/teams/[id]  (admin+) — remove it. Its conversations stay,
 *                                    out of any setor (ON DELETE SET NULL).
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params
    const parsed = parseTeamPayload(await request.json().catch(() => null), { partial: true })
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

    if (parsed.values.is_entry) await clearOtherEntry(supabase, accountId, id)

    if (Object.keys(parsed.values).length > 0) {
      const { data, error } = await supabase
        .from('teams')
        .update(parsed.values)
        .eq('id', id)
        .eq('account_id', accountId)
        .select('id')
      if (error) {
        console.error('[teams PATCH] update error:', error)
        return NextResponse.json({ error: 'Falha ao salvar o setor' }, { status: 500 })
      }
      if (!data || data.length === 0) {
        return NextResponse.json({ error: 'Setor não encontrado' }, { status: 404 })
      }
    }

    if (parsed.members) {
      const memberErr = await setTeamMembers(supabase, accountId, id, parsed.members)
      if (memberErr) return NextResponse.json({ error: memberErr }, { status: 400 })
    }

    const teams = await listTeams(supabase, accountId)
    const team = teams.find((t) => t.id === id)
    if (!team) return NextResponse.json({ error: 'Setor não encontrado' }, { status: 404 })
    return NextResponse.json({ team })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params
    const { data, error } = await supabase
      .from('teams')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id')
    if (error) {
      console.error('[teams DELETE] error:', error)
      return NextResponse.json({ error: 'Falha ao apagar o setor' }, { status: 500 })
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Setor não encontrado' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
