import { describe, expect, it } from 'vitest'

import { buildAgentNetwork } from './network'
import { HANDOFF_CHAIN } from './roles'
import { describeGoals, goalLabelKey } from './goals'
import type { Agent } from './types'

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

function roleAt(
  net: ReturnType<typeof buildAgentNetwork>,
  role: string,
): { lane: number; slot: (typeof net.lanes)[number][number] } | null {
  for (const [lane, slots] of net.lanes.entries()) {
    const slot = slots.find((s) => s.role === role)
    if (slot) return { lane, slot }
  }
  return null
}

describe('buildAgentNetwork', () => {
  it('lays the commercial line out in handoff order', () => {
    const net = buildAgentNetwork([])
    const order = ['prospector', 'researcher', 'sdr', 'executive', 'closer', 'success']
    const lanes = order.map((role) => roleAt(net, role)?.lane)
    expect(lanes.every((l) => l !== undefined)).toBe(true)
    // Strictly increasing: every post sits to the right of the one
    // that feeds it.
    for (let i = 1; i < lanes.length; i += 1) {
      expect(lanes[i]!).toBeGreaterThan(lanes[i - 1]!)
    }
  })

  it('places a side entrance before the post it feeds', () => {
    const net = buildAgentNetwork([])
    const followup = roleAt(net, 'followup')
    const executive = roleAt(net, 'executive')
    expect(followup).not.toBeNull()
    expect(followup!.lane).toBeLessThan(executive!.lane)
    expect(followup!.slot.next).toBe('executive')
  })

  it('keeps oversight out of the line', () => {
    // The manager neither receives nor hands off work. Giving it a
    // column would read as a stage conversations pass through.
    expect(HANDOFF_CHAIN.manager).toBeNull()
    const net = buildAgentNetwork([agent({ id: 'a', role: 'manager' })])
    expect(roleAt(net, 'manager')).toBeNull()
    expect(net.loose.map((a) => a.id)).toEqual(['a'])
  })

  it('files inbound desks and custom agents as loose', () => {
    const net = buildAgentNetwork([
      agent({ id: 'desk', role: 'frontdesk' }),
      agent({ id: 'mine', role: 'custom' }),
      agent({ id: 'sdr', role: 'sdr' }),
    ])
    expect(net.loose.map((a) => a.id).sort()).toEqual(['desk', 'mine'])
    expect(roleAt(net, 'sdr')!.slot.agents.map((a) => a.id)).toEqual(['sdr'])
  })

  it('counts a post with nobody in it as empty and uncovered', () => {
    const net = buildAgentNetwork([])
    expect(net.empty).toBeGreaterThan(0)
    expect(net.uncovered).toBe(net.empty)
  })

  it('counts a post whose only agent is switched off as uncovered but not empty', () => {
    const staffed = buildAgentNetwork([
      agent({ id: 'off', role: 'sdr', isActive: false }),
    ])
    const bare = buildAgentNetwork([])
    expect(staffed.empty).toBe(bare.empty - 1)
    expect(staffed.uncovered).toBe(bare.uncovered)
  })

  it('shows active agents first inside a post', () => {
    const net = buildAgentNetwork([
      agent({ id: 'off', role: 'sdr', isActive: false, priority: 90 }),
      agent({ id: 'on', role: 'sdr', isActive: true, priority: 10 }),
    ])
    expect(roleAt(net, 'sdr')!.slot.agents.map((a) => a.id)).toEqual(['on', 'off'])
  })
})

describe('goals', () => {
  it('spells a target out with its period', () => {
    expect(describeGoals({ leads_per_day: 20 })).toBe('20 leads novos por dia')
    expect(describeGoals({ closes_per_month: 10 })).toBe(
      '10 negócios fechados por mês',
    )
  })

  it('joins several targets', () => {
    expect(
      describeGoals({ conversations_per_day: 15, meetings_per_week: 5 }),
    ).toBe('15 conversas atendidas por dia, 5 reuniões agendadas por semana')
  })

  it('keeps a target the catalogue has never heard of', () => {
    // The factory can mint any key; dropping it would mean the
    // operator set a target the agent is never told about.
    expect(describeGoals({ demos_por_quinzena: 4 })).toBe(
      '4 demos_por_quinzena',
    )
  })

  it('drops zero and negative targets', () => {
    expect(describeGoals({ leads_per_day: 0 })).toBeNull()
    expect(describeGoals({})).toBeNull()
  })

  it('returns null rather than a bogus translation key', () => {
    expect(goalLabelKey('leads_per_day')).toBe('goalLeadsPerDay')
    expect(goalLabelKey('demos_por_quinzena')).toBeNull()
  })
})
