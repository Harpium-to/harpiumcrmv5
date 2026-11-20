import { describe, expect, it } from 'vitest'

import { computeAlerts, type CrmUsage } from './health'
import { radarSignalsByAccount } from './radar-sinais'

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

describe('the Radar in the agency console', () => {
  it('worst first per CRM, good news left out', () => {
    const m = radarSignalsByAccount([
      { account_id: 'A', title: 'Mensagens subiram 120%', severity: 'atencao', tone: 'neutro', created_at: '2026-11-18T06:00:00Z' },
      { account_id: 'A', title: 'Leads do Instagram caíram 60%', severity: 'alta', tone: 'ruim', created_at: '2026-11-17T06:00:00Z' },
      { account_id: 'A', title: 'Valor ganho subiu 80%', severity: 'alta', tone: 'bom', created_at: '2026-11-18T06:00:00Z' },
      { account_id: 'B', title: 'Faltas subiram', severity: 'atencao', tone: 'ruim', created_at: '2026-11-18T06:00:00Z' },
    ])
    expect(m.get('A')?.map((s) => s.title)).toEqual(['Leads do Instagram caíram 60%', 'Mensagens subiram 120%'])
    expect(m.get('B')).toHaveLength(1)
  })

  it('becomes one alert of the CRM, urgent when severe', () => {
    const alerts = computeAlerts(
      usage({ radarAlerts: [{ title: 'Leads do Instagram caíram 60%', severity: 'alta' }, { title: 'x', severity: 'atencao' }] }),
      { status: 'active', since: null },
    )
    expect(alerts).toEqual([{ kind: 'radar', label: 'Radar: Leads do Instagram caíram 60% (+1)', priority: 1 }])
  })
})
