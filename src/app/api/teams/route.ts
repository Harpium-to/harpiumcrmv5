import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  clearOtherEntry,
  listTeams,
  parseTeamPayload,
  setTeamMembers,
  uniqueCode,
} from '@/lib/atendimento/setores'

/**
 * GET  /api/teams  (any member) — the CRM's setores with their people.
 *                  [] before migration 077.
 * POST /api/teams  (admin+)     — create one.
 *
 * Both through the caller's RLS-scoped client: teams_* policies (077)
 * let every member read and only admins write.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    return NextResponse.json({ teams: await listTeams(supabase, accountId) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const parsed = parseTeamPayload(await request.json().catch(() => null), { partial: false })
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const existing = await listTeams(supabase, accountId)
    const code = uniqueCode(parsed.values.name!, existing.map((t) => t.code))
    if (parsed.values.is_entry) await clearOtherEntry(supabase, accountId, null)

    const { data, error } = await supabase
      .from('teams')
      .insert({
        ...parsed.values,
        account_id: accountId,
        code,
        position: parsed.values.position ?? existing.length,
      })
      .select('id')
      .single()
    if (error || !data) {
      console.error('[teams POST] insert error:', error)
      return NextResponse.json({ error: 'Falha ao criar o setor' }, { status: 500 })
    }

    if (parsed.members && parsed.members.length > 0) {
      const memberErr = await setTeamMembers(supabase, accountId, data.id as string, parsed.members)
      if (memberErr) return NextResponse.json({ error: memberErr }, { status: 400 })
    }

    const teams = await listTeams(supabase, accountId)
    return NextResponse.json({ team: teams.find((t) => t.id === data.id) ?? null }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
