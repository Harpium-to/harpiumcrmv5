import { describe, expect, it } from 'vitest'

import { attendanceByAccount, isOverdue, isQueued, type AttendanceRow } from './atendimento'
import { computeAlerts, type CrmUsage } from './health'

const row = (r: Partial<AttendanceRow>): AttendanceRow => ({
  account_id: 'A',
  team_id: null,
  assigned_agent_id: null,
  needs_human_since: null,
  sla_alerted_at: null,
  assigned_at: null,
  ...r,
})

describe('attendance signals', () => {
  it('overdue: still waiting, and warned since the current owner got it', () => {
    expect(isOverdue(row({ needs_human_since: 't', sla_alerted_at: '2026-11-20T10:30:00Z', assigned_at: '2026-11-20T10:00:00Z' }))).toBe(true)
    // A new owner after the warning: their own deadline starts again.
    expect(isOverdue(row({ needs_human_since: 't', sla_alerted_at: '2026-11-20T10:30:00Z', assigned_at: '2026-11-20T10:45:00Z' }))).toBe(false)
    // Answered (no longer waiting): not overdue.
    expect(isOverdue(row({ sla_alerted_at: '2026-11-20T10:30:00Z' }))).toBe(false)
  })

  it('queued: in a setor, nobody owns it', () => {
    expect(isQueued(row({ team_id: 'fin' }))).toBe(true)
    expect(isQueued(row({ team_id: 'fin', assigned_agent_id: 'carla' }))).toBe(false)
    expect(isQueued(row({}))).toBe(false)
  })

  it('counts per CRM', () => {
    const m = attendanceByAccount([
      row({ team_id: 'fin' }),
      row({ team_id: 'fin' }),
      row({ account_id: 'B', team_id: 'x', assigned_agent_id: 'u', needs_human_since: 't', sla_alerted_at: '2026-11-20T11:00:00Z', assigned_at: '2026-11-20T10:00:00Z' }),
    ])
    expect(m.get('A')).toEqual({ overdueNow: 0, queuedInTeams: 2 })
    expect(m.get('B')).toEqual({ overdueNow: 1, queuedInTeams: 0 })
  })
})

describe('computeAlerts — setores', () => {
  const usage = (patch: Partial<CrmUsage>): CrmUsage => ({
    accountId: 'A',
    membersTotal: 3,
    activeUsers7d: 3,
    activeUsersPrev7d: 3,
    lastActivityAt: new Date().toISOString(),
    msgsByWeek: [100, 100, 100, 100, 100, 100],
    msgsIn7d: 60,
    msgsOut7d: 40,
    openConversations: 10,
    openUnassigned: 0,
    unanswered24h: 0,
    channelConnected: true,
    automationsActive: 1,
    flowsActive: 0,
    agentsActive: 1,
    broadcasts30d: 0,
    dealsMoved30d: 1,
    won30d: 0,
    wonValue30d: 0,
    ...patch,
  })
  const active = { status: 'active' as const, since: null }

  it('past the deadline is urgent; a long setor queue is attention', () => {
    const alerts = computeAlerts(usage({ overdueNow: 2, queuedInTeams: 6 }), active)
    expect(alerts.map((a) => [a.kind, a.label])).toEqual([
      ['overdue', '2 conversas passaram do prazo do setor'],
      ['team_queue', '6 conversas na fila dos setores sem ninguém'],
    ])
    expect(computeAlerts(usage({ overdueNow: 1 }), active)[0].label).toBe('1 conversa passou do prazo do setor')
  })

  it('nothing for a short queue, or without setores', () => {
    expect(computeAlerts(usage({ queuedInTeams: 2 }), active)).toEqual([])
    expect(computeAlerts(usage({}), active)).toEqual([])
  })
})
