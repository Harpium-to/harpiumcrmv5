import { describe, expect, it } from 'vitest'

import {
  computeAlerts,
  computeHealth,
  messageDelta,
  momentum,
  parseUsageRow,
  type CrmUsage,
} from './health'

const NOW = new Date('2026-11-04T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

function usage(over: Partial<CrmUsage> = {}): CrmUsage {
  return {
    accountId: 'a',
    membersTotal: 4,
    activeUsers7d: 4,
    activeUsersPrev7d: 4,
    lastActivityAt: daysAgo(0),
    msgsByWeek: [100, 100, 100, 100, 100, 100],
    msgsIn7d: 50,
    msgsOut7d: 50,
    openConversations: 10,
    openUnassigned: 0,
    unanswered24h: 0,
    channelConnected: true,
    automationsActive: 1,
    flowsActive: 0,
    agentsActive: 1,
    broadcasts30d: 1,
    dealsMoved30d: 3,
    won30d: 1,
    wonValue30d: 1000,
    ...over,
  }
}

describe('computeHealth', () => {
  it('a CRM in full use scores 100', () => {
    const h = computeHealth(usage())
    expect(h.score).toBe(100)
    expect(h.band).toBe('healthy')
    expect(h.trend).toBe('flat')
  })

  it('an empty, disconnected CRM scores low', () => {
    const h = computeHealth(
      usage({
        activeUsers7d: 0,
        activeUsersPrev7d: 0,
        msgsByWeek: [0, 0, 0, 0, 0, 0],
        channelConnected: false,
        openConversations: 0,
        automationsActive: 0,
        agentsActive: 0,
        broadcasts30d: 0,
        dealsMoved30d: 0,
      }),
    )
    // Only "nobody left waiting" holds with nothing open.
    expect(h.score).toBe(15)
    expect(h.band).toBe('risk')
  })

  it('each part carries its plan weight', () => {
    const half = computeHealth(usage({ activeUsers7d: 2 }))
    expect(half.parts.users).toBe(15)
    const noChannel = computeHealth(usage({ channelConnected: false }))
    expect(noChannel.parts.channel).toBe(0)
    expect(noChannel.score).toBe(85)
    const waiting = computeHealth(usage({ unanswered24h: 5 }))
    expect(waiting.parts.responsiveness).toBe(7.5)
  })

  it('three modules in use is already full depth', () => {
    expect(computeHealth(usage({ broadcasts30d: 0 })).parts.modules).toBe(15)
    expect(
      computeHealth(usage({ broadcasts30d: 0, agentsActive: 0 })).parts.modules,
    ).toBe(10)
  })

  it('falling usage shows a downward trend against last week', () => {
    const h = computeHealth(
      usage({ activeUsers7d: 1, msgsByWeek: [20, 100, 100, 100, 100, 100] }),
    )
    expect(h.prevScore).toBe(100)
    expect(h.score).toBeLessThan(80)
    expect(h.trend).toBe('down')
  })
})

describe('momentum', () => {
  it('is full at or above the recent average, proportional below it', () => {
    expect(momentum(100, [100, 100, 100, 100])).toBe(1)
    expect(momentum(150, [100, 100, 100, 100])).toBe(1)
    expect(momentum(50, [100, 100, 100, 100])).toBe(0.5)
  })

  it('a first week of use counts as full, silence as zero', () => {
    expect(momentum(5, [0, 0, 0, 0])).toBe(1)
    expect(momentum(0, [0, 0, 0, 0])).toBe(0)
  })
})

describe('computeAlerts', () => {
  const active = { status: 'active' as const, since: daysAgo(60) }

  it('a healthy CRM raises nothing', () => {
    expect(computeAlerts(usage(), active, NOW)).toEqual([])
  })

  it('lists what needs attention, most urgent first', () => {
    const alerts = computeAlerts(
      usage({
        channelConnected: false,
        unanswered24h: 3,
        lastActivityAt: daysAgo(10),
        msgsByWeek: [10, 40, 40, 40, 40, 40],
        openUnassigned: 6,
      }),
      active,
      NOW,
    )
    expect(alerts.map((a) => a.label)).toEqual([
      'Nenhum canal conectado',
      '3 conversas sem resposta há 24h+',
      'Ninguém entra há 10 dias',
      'Mensagens caíram 75% na semana',
      '6 conversas sem atendente',
    ])
  })

  it('a CRM nobody has opened says so', () => {
    expect(
      computeAlerts(usage({ lastActivityAt: null }), active, NOW).map((a) => a.kind),
    ).toEqual(['no_access'])
  })

  it('small weekly swings are not a drop', () => {
    expect(computeAlerts(usage({ msgsByWeek: [2, 10, 0, 0, 0, 0] }), active, NOW)).toEqual([])
  })

  it('onboarding only alerts when it has stalled', () => {
    const quiet = usage({ channelConnected: false, lastActivityAt: null })
    expect(computeAlerts(quiet, { status: 'onboarding', since: daysAgo(3) }, NOW)).toEqual([])
    expect(
      computeAlerts(quiet, { status: 'onboarding', since: daysAgo(20) }, NOW)[0].label,
    ).toBe('Em implantação há 20 dias')
  })

  it('suspended CRMs raise nothing', () => {
    expect(
      computeAlerts(usage({ channelConnected: false }), { status: 'suspended', since: null }, NOW),
    ).toEqual([])
  })
})

describe('parseUsageRow / messageDelta', () => {
  it('reads NUMERIC sent as strings and missing values as zero', () => {
    const u = parseUsageRow({
      account_id: 'a',
      members_total: 3,
      won_value_30d: '1200.50',
      msgs_w0: 8,
      msgs_w1: 4,
      channel_connected: true,
      last_activity_at: null,
    })
    expect(u.wonValue30d).toBe(1200.5)
    expect(u.msgsByWeek).toEqual([8, 4, 0, 0, 0, 0])
    expect(u.activeUsers7d).toBe(0)
    expect(messageDelta(u)).toBe(1)
  })

  it('no messages last week means no percentage, not infinity', () => {
    expect(messageDelta(usage({ msgsByWeek: [5, 0, 0, 0, 0, 0] }))).toBeNull()
  })
})
