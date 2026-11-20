import type { SupabaseClient } from '@supabase/supabase-js'

import { fetchAllRows } from '@/lib/reports/fetch-all'

import type { CrmUsage } from './health'

// ============================================================
// Atendimento in the agency console and the platform API (Agency OS):
// per CRM, how many conversations are past their setor's deadline and
// how many wait in setor queues; per setor of one CRM, the same broken
// down. Read from the conversations themselves (076–078), so nothing
// in the 052 usage function changes. A database without them answers
// nothing and the console shows what it showed before.
// See docs/plano-distribuicao-atendimento.md, Fase 5.
// ============================================================

/** An open conversation, as these signals need it. */
export interface AttendanceRow {
  account_id: string
  team_id: string | null
  assigned_agent_id: string | null
  needs_human_since: string | null
  sla_alerted_at: string | null
  assigned_at: string | null
}

/**
 * Past the deadline right now: still waiting for a person, and the
 * deadline warned (or moved it) since the current owner got it.
 */
export function isOverdue(r: AttendanceRow): boolean {
  if (!r.needs_human_since || !r.sla_alerted_at) return false
  if (!r.assigned_at) return true
  return Date.parse(r.sla_alerted_at) >= Date.parse(r.assigned_at)
}

/** Waiting in a setor's queue: in a setor, nobody owns it. */
export function isQueued(r: AttendanceRow): boolean {
  return !!r.team_id && !r.assigned_agent_id
}

/** Per CRM: { overdueNow, queuedInTeams }. */
export function attendanceByAccount(
  rows: readonly AttendanceRow[],
): Map<string, { overdueNow: number; queuedInTeams: number }> {
  const out = new Map<string, { overdueNow: number; queuedInTeams: number }>()
  for (const r of rows) {
    const cur = out.get(r.account_id) ?? { overdueNow: 0, queuedInTeams: 0 }
    if (isOverdue(r)) cur.overdueNow += 1
    if (isQueued(r)) cur.queuedInTeams += 1
    out.set(r.account_id, cur)
  }
  return out
}

const COLUMNS = 'account_id, team_id, assigned_agent_id, needs_human_since, sla_alerted_at, assigned_at'

/**
 * Add the attendance signals to every CRM's usage row, in place. Only
 * open conversations in a setor or warned by a deadline are read.
 * Best-effort: before 077/078 the columns are missing and nothing is added.
 */
export async function addAttendanceSignals(
  admin: SupabaseClient,
  usage: Map<string, CrmUsage>,
): Promise<void> {
  let rows: AttendanceRow[]
  try {
    rows = await fetchAllRows<AttendanceRow>((from, to) =>
      admin
        .from('conversations')
        .select(COLUMNS)
        .neq('status', 'closed')
        .or('team_id.not.is.null,sla_alerted_at.not.is.null')
        .order('id', { ascending: true })
        .range(from, to),
    )
  } catch {
    return
  }
  for (const [accountId, signals] of attendanceByAccount(rows)) {
    const u = usage.get(accountId)
    if (u) Object.assign(u, signals)
  }
}

export interface TeamQueue {
  id: string
  name: string
  color: string
  members: number
  /** Waiting in the setor's queue (nobody owns it). */
  queued: number
  /** Waiting for a person (needs_human_since), owned or not. */
  waiting: number
  /** Past the setor's deadline right now. */
  overdue: number
}

/** One CRM's active setores with their queues. [] before 077. */
export async function loadTeamQueues(admin: SupabaseClient, accountId: string): Promise<TeamQueue[]> {
  const [teamsRes, membersRes] = await Promise.all([
    admin
      .from('teams')
      .select('id, name, color')
      .eq('account_id', accountId)
      .eq('active', true)
      .order('position', { ascending: true }),
    admin.from('team_members').select('team_id').eq('account_id', accountId),
  ])
  if (teamsRes.error || !teamsRes.data || teamsRes.data.length === 0) return []

  let rows: AttendanceRow[] = []
  try {
    rows = await fetchAllRows<AttendanceRow>((from, to) =>
      admin
        .from('conversations')
        .select(COLUMNS)
        .eq('account_id', accountId)
        .neq('status', 'closed')
        .not('team_id', 'is', null)
        .order('id', { ascending: true })
        .range(from, to),
    )
  } catch {
    rows = []
  }

  const memberCount = new Map<string, number>()
  for (const m of (membersRes.data ?? []) as { team_id: string }[]) {
    memberCount.set(m.team_id, (memberCount.get(m.team_id) ?? 0) + 1)
  }
  return (teamsRes.data as { id: string; name: string; color: string }[]).map((t) => {
    const mine = rows.filter((r) => r.team_id === t.id)
    return {
      id: t.id,
      name: t.name,
      color: t.color,
      members: memberCount.get(t.id) ?? 0,
      queued: mine.filter(isQueued).length,
      waiting: mine.filter((r) => !!r.needs_human_since).length,
      overdue: mine.filter(isOverdue).length,
    }
  })
}
