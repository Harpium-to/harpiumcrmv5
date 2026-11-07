import { describe, expect, it } from 'vitest'

import type { CrmUsage } from './health'
import {
  applyPanelFilters,
  buildPanelRows,
  panelHref,
  panelTotals,
  parsePanelFilters,
  usageExtremes,
} from './panel'
import type { AccountOverview } from './queries'

const NOW = new Date('2026-11-04T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

function account(id: string, over: Partial<AccountOverview> = {}): AccountOverview {
  return {
    id,
    name: id,
    ownerUserId: 'u',
    ownerEmail: `${id}@cliente.com`,
    pendingOwnerEmail: null,
    status: 'active',
    niche: null,
    managerUserId: null,
    managerEmail: null,
    statusChangedAt: null,
    createdAt: daysAgo(90),
    memberCount: 3,
    contactCount: 10,
    openConversationCount: 0,
    openDealCount: 0,
    openDealValue: 0,
    ...over,
  }
}

function usage(id: string, over: Partial<CrmUsage> = {}): CrmUsage {
  return {
    accountId: id,
    membersTotal: 3,
    activeUsers7d: 3,
    activeUsersPrev7d: 3,
    lastActivityAt: daysAgo(0),
    msgsByWeek: [50, 50, 50, 50, 50, 50],
    msgsIn7d: 25,
    msgsOut7d: 25,
    openConversations: 2,
    openUnassigned: 0,
    unanswered24h: 0,
    channelConnected: true,
    automationsActive: 1,
    flowsActive: 0,
    agentsActive: 1,
    broadcasts30d: 1,
    dealsMoved30d: 1,
    won30d: 1,
    wonValue30d: 500,
    ...over,
  }
}

const accounts = [
  account('Alfa', { niche: 'gym', managerUserId: 'mel' }),
  account('Beta'),
  account('Gama'),
  account('Delta', { status: 'suspended' }),
  account('Épsilon', { status: 'archived' }),
  account('Zeta', { status: 'onboarding', pendingOwnerEmail: 'dono@zeta.com', ownerEmail: null }),
]
const usageMap = new Map<string, CrmUsage>([
  ['Alfa', usage('Alfa')],
  [
    'Beta',
    usage('Beta', {
      activeUsers7d: 0,
      activeUsersPrev7d: 0,
      lastActivityAt: daysAgo(12),
      msgsByWeek: [0, 0, 0, 0, 0, 0],
      channelConnected: false,
      automationsActive: 0,
      agentsActive: 0,
      broadcasts30d: 0,
      dealsMoved30d: 0,
      wonValue30d: 0,
    }),
  ],
  ['Gama', usage('Gama', { activeUsers7d: 1, msgsByWeek: [10, 50, 50, 50, 50, 50] })],
  ['Delta', usage('Delta')],
  ['Épsilon', usage('Épsilon')],
  ['Zeta', usage('Zeta', { lastActivityAt: null, channelConnected: false })],
])
const rows = buildPanelRows(accounts, usageMap, new Map([['Alfa', 'read']]), NOW)
const names = (rs: { name: string }[]) => rs.map((r) => r.name)

describe('buildPanelRows', () => {
  it('scores live CRMs only; suspended has no health', () => {
    const byName = new Map(rows.map((r) => [r.name, r]))
    expect(byName.get('Alfa')!.health!.band).toBe('healthy')
    expect(byName.get('Beta')!.health!.band).toBe('risk')
    expect(byName.get('Delta')!.health).toBeNull()
    expect(byName.get('Alfa')!.access).toBe('read')
  })

  it('shows a pending owner invitation when there is no owner yet', () => {
    expect(rows.find((r) => r.name === 'Zeta')!.ownerLabel).toBe(
      'convite pendente: dono@zeta.com',
    )
  })

  it('before 052, rows still come out — without usage, health or alerts', () => {
    const bare = buildPanelRows(accounts, null, new Map(), NOW)
    expect(bare).toHaveLength(6)
    expect(bare.every((r) => r.usage === null && r.health === null && r.alerts.length === 0)).toBe(
      true,
    )
  })
})

describe('filters and sorting', () => {
  const f = (sp: Record<string, string>) => parsePanelFilters(sp)

  it('by default hides archived and puts the worst health first', () => {
    const out = applyPanelFilters(rows, f({}))
    expect(names(out)).not.toContain('Épsilon')
    expect(names(out)[0]).toBe('Beta')
    // No score (suspended) goes last.
    expect(names(out).at(-1)).toBe('Delta')
  })

  it('filters by status, niche, manager, risk and idle', () => {
    expect(names(applyPanelFilters(rows, f({ status: 'archived' })))).toEqual(['Épsilon'])
    expect(names(applyPanelFilters(rows, f({ nicho: 'gym' })))).toEqual(['Alfa'])
    expect(names(applyPanelFilters(rows, f({ gestor: 'mel' })))).toEqual(['Alfa'])
    expect(names(applyPanelFilters(rows, f({ risco: '1' })))).toEqual(['Beta'])
    expect(names(applyPanelFilters(rows, f({ semacesso: '1' })))).toEqual(['Beta'])
  })

  it('sorts by use and by longest without access', () => {
    expect(names(applyPanelFilters(rows, f({ ordem: 'uso' }))).slice(0, 2)).toEqual([
      'Alfa',
      'Delta',
    ])
    expect(names(applyPanelFilters(rows, f({ ordem: 'acesso' })))[0]).toBe('Zeta')
  })

  it('an unknown sort or status falls back to the default', () => {
    expect(f({ ordem: 'xyz', status: 'deleted' })).toMatchObject({
      sort: 'saude',
      status: null,
    })
  })

  it('builds links that keep the other filters', () => {
    const cur = f({ nicho: 'gym', risco: '1' })
    expect(panelHref(cur, { sort: 'uso' }, 30)).toBe(
      '/agencia?dias=30&nicho=gym&risco=1&ordem=uso',
    )
    expect(panelHref(cur, { risk: false }, 7)).toBe('/agencia?dias=7&nicho=gym')
  })
})

describe('panelTotals / usageExtremes', () => {
  it('counts the portfolio, ignoring archived CRMs', () => {
    const t = panelTotals(rows)
    expect(t).toMatchObject({ active: 3, onboarding: 1, suspended: 1, risk: 1, idle: 1 })
    // Alfa 3 + Gama 1 + Delta 3 + Zeta 3; Épsilon (archived) left out.
    expect(t.activeUsers7d).toBe(10)
  })

  it('lists who uses it most and least among active CRMs', () => {
    const { most, least } = usageExtremes(rows, 2)
    expect(names(most)).toEqual(['Alfa', 'Gama'])
    expect(names(least)[0]).toBe('Beta')
  })
})
