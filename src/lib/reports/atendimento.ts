import type { SupabaseClient } from '@supabase/supabase-js'

import { median } from './aggregate'
import type { DateRange } from './range'

// ============================================================
// Relatórios › Atendimento: per person and per setor, from the
// conversations' history (conversation_transfers, 076/077).
// The aggregation is pure; the loader reads the window once.
// ============================================================

export interface AtendimentoPerson {
  userId: string
  name: string
  /** Conversations that came to them in the window. */
  received: number
  /** Conversations they passed on to someone else or a queue. */
  passedOn: number
  /** Open conversations they own right now. */
  openNow: number
}

export interface AtendimentoTeam {
  teamId: string
  name: string
  color: string
  /** Conversations that entered the setor in the window. */
  entries: number
  /** Median minutes a conversation waited in the setor's queue before someone got it. */
  medianQueueMinutes: number | null
  /** Deadline moves (source 'prazo') into the setor in the window. */
  overdueMoves: number
}

export interface AtendimentoReport {
  people: AtendimentoPerson[]
  teams: AtendimentoTeam[]
}

export interface TransferRow {
  conversation_id: string
  created_at: string
  from_user_id: string | null
  to_user_id: string | null
  from_team_id: string | null
  to_team_id: string | null
  actor_user_id: string | null
  source: string
}

export function buildAtendimento(args: {
  transfers: readonly TransferRow[]
  openByUser: ReadonlyMap<string, number>
  people: readonly { userId: string; name: string }[]
  teams: readonly { id: string; name: string; color: string }[]
}): AtendimentoReport {
  const { transfers, openByUser, people, teams } = args

  const received = new Map<string, number>()
  const passedOn = new Map<string, number>()
  for (const t of transfers) {
    if (t.to_user_id && t.to_user_id !== t.from_user_id) {
      received.set(t.to_user_id, (received.get(t.to_user_id) ?? 0) + 1)
    }
    // Passed on by its owner: they were holding it and changed it themselves.
    if (t.from_user_id && t.actor_user_id === t.from_user_id && t.to_user_id !== t.from_user_id) {
      passedOn.set(t.from_user_id, (passedOn.get(t.from_user_id) ?? 0) + 1)
    }
  }

  // Queue time: from the moment a conversation landed in a setor with
  // nobody, to the next row giving it a person in that same setor.
  const byConversation = new Map<string, TransferRow[]>()
  for (const t of transfers) {
    const list = byConversation.get(t.conversation_id) ?? []
    list.push(t)
    byConversation.set(t.conversation_id, list)
  }
  const queueMinutes = new Map<string, number[]>()
  for (const rows of byConversation.values()) {
    rows.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
    for (let i = 0; i < rows.length; i++) {
      const queued = rows[i]
      if (!queued.to_team_id || queued.to_user_id) continue
      const taken = rows.slice(i + 1).find((r) => r.to_user_id && r.to_team_id === queued.to_team_id)
      if (!taken) continue
      const minutes = (Date.parse(taken.created_at) - Date.parse(queued.created_at)) / 60_000
      if (minutes < 0) continue
      const list = queueMinutes.get(queued.to_team_id) ?? []
      list.push(minutes)
      queueMinutes.set(queued.to_team_id, list)
    }
  }

  const entries = new Map<string, number>()
  const overdue = new Map<string, number>()
  for (const t of transfers) {
    if (t.to_team_id && t.to_team_id !== t.from_team_id) {
      entries.set(t.to_team_id, (entries.get(t.to_team_id) ?? 0) + 1)
    }
    if (t.source === 'prazo' && t.to_team_id) {
      overdue.set(t.to_team_id, (overdue.get(t.to_team_id) ?? 0) + 1)
    }
  }

  return {
    people: people
      .map((p) => ({
        userId: p.userId,
        name: p.name,
        received: received.get(p.userId) ?? 0,
        passedOn: passedOn.get(p.userId) ?? 0,
        openNow: openByUser.get(p.userId) ?? 0,
      }))
      .filter((p) => p.received + p.passedOn + p.openNow > 0)
      .sort((a, b) => b.received - a.received || b.openNow - a.openNow || a.name.localeCompare(b.name)),
    teams: teams.map((t) => {
      const m = median(queueMinutes.get(t.id) ?? [])
      return {
        teamId: t.id,
        name: t.name,
        color: t.color,
        entries: entries.get(t.id) ?? 0,
        medianQueueMinutes: m === null ? null : Math.round(m),
        overdueMoves: overdue.get(t.id) ?? 0,
      }
    }),
  }
}

/** The window's history and today's open conversations. Null before 076. */
export async function loadAtendimento(
  db: SupabaseClient,
  accountId: string,
  range: DateRange,
): Promise<AtendimentoReport | null> {
  const transfersRes = await db
    .from('conversation_transfers')
    .select('conversation_id, created_at, from_user_id, to_user_id, from_team_id, to_team_id, actor_user_id, source')
    .eq('account_id', accountId)
    .gte('created_at', range.fromIso)
    .lt('created_at', range.toIso)
    .order('created_at', { ascending: true })
    .limit(10_000)
  if (transfersRes.error) {
    // 077's team columns missing: read without them; 076 missing: no section.
    if (transfersRes.error.code === '42703' || transfersRes.error.code === 'PGRST204') {
      const legacy = await db
        .from('conversation_transfers')
        .select('conversation_id, created_at, from_user_id, to_user_id, actor_user_id, source')
        .eq('account_id', accountId)
        .gte('created_at', range.fromIso)
        .lt('created_at', range.toIso)
        .limit(10_000)
      if (legacy.error) return null
      return finish(
        db,
        accountId,
        ((legacy.data ?? []) as Omit<TransferRow, 'from_team_id' | 'to_team_id'>[]).map((r) => ({
          ...r,
          from_team_id: null,
          to_team_id: null,
        })),
      )
    }
    return null
  }
  return finish(db, accountId, (transfersRes.data ?? []) as TransferRow[])
}

async function finish(
  db: SupabaseClient,
  accountId: string,
  transfers: TransferRow[],
): Promise<AtendimentoReport> {
  const [openRes, membersRes, teamsRes] = await Promise.all([
    db
      .from('conversations')
      .select('assigned_agent_id')
      .eq('account_id', accountId)
      .neq('status', 'closed')
      .not('assigned_agent_id', 'is', null)
      .limit(20_000),
    db.from('account_members').select('user_id, role').eq('account_id', accountId),
    db.from('teams').select('id, name, color, active').eq('account_id', accountId).order('position'),
  ])

  const openByUser = new Map<string, number>()
  for (const r of (openRes.data ?? []) as { assigned_agent_id: string }[]) {
    openByUser.set(r.assigned_agent_id, (openByUser.get(r.assigned_agent_id) ?? 0) + 1)
  }

  const memberIds = ((membersRes.data ?? []) as { user_id: string; role: string }[])
    .filter((m) => m.role !== 'viewer')
    .map((m) => m.user_id)
  const { data: profiles } = memberIds.length
    ? await db.from('profiles').select('user_id, full_name, email').in('user_id', memberIds)
    : { data: [] }
  const nameById = new Map(
    ((profiles ?? []) as { user_id: string; full_name: string | null; email: string | null }[]).map((p) => [
      p.user_id,
      p.full_name || p.email || 'Sem nome',
    ]),
  )

  return buildAtendimento({
    transfers,
    openByUser,
    people: memberIds.map((id) => ({ userId: id, name: nameById.get(id) ?? 'Sem nome' })),
    teams: teamsRes.error
      ? []
      : ((teamsRes.data ?? []) as { id: string; name: string; color: string; active: boolean }[]).filter(
          (t) => t.active,
        ),
  })
}
