import { describe, it, expect } from 'vitest'
import {
  agentsForChannel,
  fold,
  matchesKeyword,
  pickAgent,
  speaksOn,
} from './routing'
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

describe('fold', () => {
  it('strips accents and lowercases', () => {
    expect(fold('Orçamento')).toBe('orcamento')
    expect(fold('  PREÇO ')).toBe('preco')
  })
})

describe('matchesKeyword', () => {
  it('matches regardless of which side carries the accent', () => {
    expect(matchesKeyword('qual o preco?', 'preço')).toBe(true)
    expect(matchesKeyword('qual o preço?', 'preco')).toBe(true)
  })

  it('matches whole words only', () => {
    // The bug this guards: a two-letter keyword firing inside a longer
    // word, routing every message to the wrong agent.
    expect(matchesKeyword('quero comprar agora', 'ar')).toBe(false)
    expect(matchesKeyword('o ar condicionado', 'ar')).toBe(true)
  })

  it('matches multi-word phrases', () => {
    expect(matchesKeyword('preciso da segunda via do boleto', 'segunda via')).toBe(
      true,
    )
  })

  it('treats regex metacharacters as literal text', () => {
    expect(matchesKeyword('custa R$ 10 (dez)', '(dez)')).toBe(true)
    expect(() => matchesKeyword('anything', '(')).not.toThrow()
  })

  it('ignores empty keywords', () => {
    expect(matchesKeyword('anything', '   ')).toBe(false)
  })
})

describe('pickAgent', () => {
  const sales = agent({
    id: 'sales',
    keywords: ['preço', 'comprar'],
    priority: 30,
  })
  const billing = agent({
    id: 'billing',
    keywords: ['boleto'],
    priority: 25,
  })
  const frontDesk = agent({ id: 'front-desk', isFallback: true, priority: 0 })

  it('routes on a keyword hit and reports which keyword won', () => {
    const result = pickAgent([sales, billing, frontDesk], 'quero comprar')
    expect(result?.agent.id).toBe('sales')
    expect(result?.matchedKeyword).toBe('comprar')
  })

  it('prefers the higher priority agent when several match', () => {
    const result = pickAgent(
      [billing, sales, frontDesk],
      'quanto é o preço do boleto?',
    )
    expect(result?.agent.id).toBe('sales')
  })

  it('breaks priority ties on the older agent, not on row order', () => {
    const older = agent({
      id: 'older',
      keywords: ['ajuda'],
      priority: 10,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const newer = agent({
      id: 'newer',
      keywords: ['ajuda'],
      priority: 10,
      createdAt: '2026-06-01T00:00:00.000Z',
    })
    expect(pickAgent([newer, older], 'preciso de ajuda')?.agent.id).toBe('older')
    expect(pickAgent([older, newer], 'preciso de ajuda')?.agent.id).toBe('older')
  })

  it('falls back to the default agent when nothing matches', () => {
    const result = pickAgent([sales, billing, frontDesk], 'bom dia')
    expect(result?.agent.id).toBe('front-desk')
    expect(result?.matchedKeyword).toBeNull()
  })

  it('returns null when no agent is active', () => {
    const off = agent({ id: 'off', isFallback: true, isActive: false })
    expect(pickAgent([off], 'bom dia')).toBeNull()
  })

  it('ignores an inactive agent even when its keyword matches', () => {
    const off = agent({ id: 'off', keywords: ['comprar'], isActive: false })
    expect(pickAgent([off, frontDesk], 'quero comprar')?.agent.id).toBe(
      'front-desk',
    )
  })

  it('returns null when nothing matches and there is no fallback', () => {
    expect(pickAgent([sales, billing], 'bom dia')).toBeNull()
  })
})

describe('speaksOn', () => {
  it('covers exactly the channels ticked on the agent', () => {
    expect(speaksOn(['whatsapp'], 'whatsapp')).toBe(true)
    expect(speaksOn(['whatsapp'], 'instagram')).toBe(false)
    expect(speaksOn(['whatsapp', 'instagram'], 'instagram')).toBe(true)
  })

  it('reads an empty list as no channel at all, not every channel', () => {
    // A researcher or prospector: the form says "Vazio significa que
    // ele não fala com cliente", so it must never answer a customer.
    expect(speaksOn([], 'whatsapp')).toBe(false)
    expect(speaksOn([], 'instagram')).toBe(false)
  })
})

describe('agentsForChannel', () => {
  const whatsappDesk = agent({
    id: 'wa-desk',
    channels: ['whatsapp'],
    isFallback: true,
  })
  const instagramSales = agent({
    id: 'ig-sales',
    channels: ['instagram'],
    keywords: ['preço'],
    priority: 30,
  })
  const everywhere = agent({
    id: 'both',
    channels: ['whatsapp', 'instagram'],
    keywords: ['boleto'],
    priority: 20,
  })
  const researcher = agent({
    id: 'researcher',
    channels: [],
    keywords: ['preço'],
    priority: 99,
  })
  const team = [whatsappDesk, instagramSales, everywhere, researcher]

  it('keeps only the agents that speak on the thread’s channel', () => {
    expect(agentsForChannel(team, 'whatsapp').map((a) => a.id)).toEqual([
      'wa-desk',
      'both',
    ])
    expect(agentsForChannel(team, 'instagram').map((a) => a.id)).toEqual([
      'ig-sales',
      'both',
    ])
  })

  it('never hands a thread to an agent with no channels', () => {
    // Highest priority and a matching keyword, but it talks to nobody.
    for (const channel of ['whatsapp', 'instagram']) {
      const picked = pickAgent(agentsForChannel(team, channel), 'qual o preço?')
      expect(picked?.agent.id).not.toBe('researcher')
    }
  })

  it('keeps a WhatsApp-only fallback off Instagram', () => {
    // On Instagram nothing matches "bom dia" and the only fallback is
    // WhatsApp-only, so nobody claims it.
    expect(pickAgent(agentsForChannel(team, 'instagram'), 'bom dia')).toBeNull()
    expect(
      pickAgent(agentsForChannel(team, 'whatsapp'), 'bom dia')?.agent.id,
    ).toBe('wa-desk')
  })

  it('returns nobody for a channel no agent covers', () => {
    expect(agentsForChannel(team, 'email')).toEqual([])
  })
})
