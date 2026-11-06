import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { CrmTable } from './crm-table'
import { HealthCard } from './[accountId]/health-card'
import { computeAlerts, computeHealth, type CrmUsage } from '@/lib/agencia/health'
import { buildPanelRows, parsePanelFilters } from '@/lib/agencia/panel'
import type { AccountOverview } from '@/lib/agencia/queries'

/**
 * The platform panel is behind the agency login; its table and the
 * health breakdown are pinned from markup.
 */

const NOW = new Date('2026-11-04T12:00:00Z')

const account = (id: string, over: Partial<AccountOverview> = {}): AccountOverview => ({
  id,
  name: id,
  ownerUserId: 'u',
  ownerEmail: `${id.toLowerCase()}@cliente.com`,
  pendingOwnerEmail: null,
  status: 'active',
  niche: 'gym',
  managerUserId: null,
  managerEmail: null,
  statusChangedAt: null,
  createdAt: '2026-08-01T00:00:00Z',
  memberCount: 3,
  contactCount: 5,
  openConversationCount: 0,
  openDealCount: 0,
  openDealValue: 0,
  ...over,
})

const quiet: CrmUsage = {
  accountId: 'Beta',
  membersTotal: 3,
  activeUsers7d: 0,
  activeUsersPrev7d: 1,
  lastActivityAt: null,
  msgsByWeek: [0, 40, 40, 40, 40, 40],
  msgsIn7d: 0,
  msgsOut7d: 0,
  openConversations: 2,
  openUnassigned: 2,
  unanswered24h: 2,
  channelConnected: false,
  automationsActive: 0,
  flowsActive: 0,
  agentsActive: 0,
  broadcasts30d: 0,
  dealsMoved30d: 0,
  won30d: 0,
  wonValue30d: 0,
}

describe('CrmTable', () => {
  it('shows score, last access, people, messages with the weekly change, channel and alerts', () => {
    const rows = buildPanelRows([account('Beta')], new Map([['Beta', quiet]]), new Map([['Beta', 'read']]), NOW)
    const html = renderToStaticMarkup(
      <CrmTable rows={rows} filters={parsePanelFilters({})} dias={30} now={NOW} />,
    )
    expect(html).toContain('href="/agencia/Beta"')
    expect(html).toContain('Academia / Studio · beta@cliente.com')
    expect(html).toContain('Acesso: Leitura')
    expect(html).toContain('nunca')
    expect(html).toContain('0 de 3')
    expect(html).toContain('-100%')
    expect(html).toContain('Desconectado')
    expect(html).toContain('Nenhum canal conectado')
    expect(html).toContain('+2') // more alerts than the two shown
  })

  it('before migration 052 the usage columns are dashes, not zeros', () => {
    const rows = buildPanelRows([account('Beta')], null, new Map(), NOW)
    const html = renderToStaticMarkup(
      <CrmTable rows={rows} filters={parsePanelFilters({})} dias={30} now={NOW} />,
    )
    expect(html).not.toContain('nunca')
    expect(html).not.toContain('Desconectado')
    expect((html.match(/—/g) ?? []).length).toBeGreaterThanOrEqual(5)
  })

  it('marks the active sort column', () => {
    const rows = buildPanelRows([account('Beta')], null, new Map(), NOW)
    const html = renderToStaticMarkup(
      <CrmTable rows={rows} filters={parsePanelFilters({ ordem: 'uso' })} dias={7} now={NOW} />,
    )
    expect(html).toContain('Mensagens 7d ↓')
    expect(html).toContain('href="/agencia?dias=7&amp;ordem=uso"')
  })
})

describe('HealthCard', () => {
  it('breaks the score down by part against its weight', () => {
    const html = renderToStaticMarkup(
      <HealthCard
        usage={quiet}
        health={computeHealth(quiet)}
        alerts={computeAlerts(quiet, { status: 'active', since: null }, NOW)}
      />,
    )
    expect(html).toContain('Pessoas usando')
    expect(html).toContain('0 / 30')
    expect(html).toContain('Canal conectado')
    expect(html).toContain('0 / 15')
    expect(html).toContain('Em risco')
    expect(html).toContain('2 conversas sem resposta há 24h+')
  })

  it('a suspended CRM shows its numbers but no score', () => {
    const html = renderToStaticMarkup(<HealthCard usage={quiet} health={null} alerts={[]} />)
    expect(html).toContain('não são avaliados')
    expect(html).toContain('0 de 3')
  })
})
