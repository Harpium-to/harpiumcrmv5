import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'

import { AgentNetwork } from './agent-network'
import messages from '../../../messages/pt.json'
import type { Agent } from '@/lib/agents/types'

/**
 * The network view renders behind a login, and the one running here
 * cannot sign in — so the layout is pinned from the markup instead.
 *
 * What these assert that a unit test on `buildAgentNetwork` cannot:
 * that the derived order survives into the DOM (the left-to-right
 * reading *is* the handoff order, so a column out of place is a wrong
 * diagram, not a cosmetic bug), and that every label resolves. The
 * second one matters because next-intl throws on a missing key and
 * half of this screen's labels are looked up dynamically from the role
 * and goal catalogues.
 */

function agent(over: Partial<Agent> & { id: string }): Agent {
  return {
    accountId: 'acct',
    name: over.id,
    role: 'custom',
    avatarUrl: null,
    objective: null,
    autonomy: 3,
    tools: [],
    channels: [],
    requireApprovalFor: [],
    workDays: [1, 2, 3, 4, 5],
    workStart: '09:00',
    workEnd: '18:00',
    timezone: 'America/Sao_Paulo',
    goals: {},
    status: 'idle',
    statusDetail: null,
    statusChangedAt: '2026-01-01T00:00:00.000Z',
    costUsd: 0,
    department: 'geral',
    systemPrompt: 'prompt',
    model: null,
    keywords: [],
    priority: 0,
    isFallback: false,
    isActive: true,
    maxRepliesPerConversation: 3,
    handoffAgentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function render(agents: Agent[] | null): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="pt"
      messages={messages}
      // next-intl warns without one; nothing here formats a date, but
      // an unset zone is a markup-mismatch warning on every render.
      timeZone="America/Sao_Paulo"
    >
      <AgentNetwork agents={agents} />
    </NextIntlClientProvider>,
  )
}

const TEAM: Agent[] = [
  agent({ id: 'Ana', role: 'prospector', status: 'researching' }),
  agent({ id: 'Bruno', role: 'researcher' }),
  agent({ id: 'Carla', role: 'sdr', isActive: false }),
  agent({ id: 'Davi', role: 'executive', status: 'waiting_approval' }),
  // No closer and no success agent: the gap is the point of the screen.
  agent({ id: 'Elis', role: 'frontdesk' }),
  agent({ id: 'Fabio', role: 'manager' }),
]

/**
 * The station headings, in document order.
 *
 * Read from the markup rather than with indexOf, because each card
 * also names its successor in its footer — "Pesquisador" appears
 * inside the prospector's card before the researcher's own station,
 * so a substring search finds the edge label and reports the layout
 * backwards.
 */
function stations(html: string): string[] {
  return [...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((m) => m[1]!)
}

describe('AgentNetwork', () => {
  it('draws the stations in handoff order, entry points first', () => {
    // Two ways in on the left (cold prospecting and reviving a dead
    // thread), one line out to the right.
    expect(stations(render(TEAM))).toEqual([
      'Prospector',
      'Follow-up',
      'Pesquisador',
      'SDR',
      'Executivo comercial',
      'Closer',
      'Customer success',
    ])
  })

  it('shows the agent of each station with its live state', () => {
    const html = render(TEAM)
    expect(html).toContain('Ana')
    expect(html).toContain('Pesquisando')
    expect(html).toContain('Aguardando aprovação')
    // Carla is configured but switched off: named, but not reported as
    // doing anything.
    expect(html).toContain('Carla')
    expect(html).toContain('Desligado')
  })

  it('names the empty stations as the finding', () => {
    const html = render(TEAM)
    expect(html).toContain('Ninguém nesta etapa')
    // Closer, Customer Success and Follow-up are empty; SDR has only a
    // switched-off agent. Four posts with nobody running them.
    expect(html).toContain('4 etapas sem agente ligado')
  })

  it('reports a fully staffed line instead of a count', () => {
    const full = render([
      ...TEAM,
      agent({ id: 'Gi', role: 'closer' }),
      agent({ id: 'Hugo', role: 'success' }),
      agent({ id: 'Iris', role: 'followup' }),
      agent({ id: 'Joana', role: 'sdr' }),
    ])
    expect(full).toContain('Linha completa')
    expect(full).not.toContain('sem agente ligado')
  })

  it('files the inbound desk and the manager off the line', () => {
    const html = render(TEAM)
    const loose = html.indexOf('Fora da linha')
    expect(loose).toBeGreaterThan(0)
    expect(html.indexOf('Elis')).toBeGreaterThan(loose)
    expect(html.indexOf('Fabio')).toBeGreaterThan(loose)
  })

  it('leaks no untranslated key', () => {
    const html = render(TEAM)
    for (const key of [
      'networkComplete',
      'networkUncovered',
      'networkEmptySlot',
      'networkEnds',
      'networkLoose',
      'networkOff',
      'roleProspector',
      'statusResearching',
    ]) {
      expect(html).not.toContain(key)
    }
  })

  it('renders a loading state instead of an empty graph', () => {
    const html = render(null)
    expect(html).not.toContain('Fora da linha')
    expect(html).not.toContain('Ninguém nesta etapa')
  })
})
