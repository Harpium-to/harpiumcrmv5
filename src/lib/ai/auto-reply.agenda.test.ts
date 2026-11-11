// ============================================================
// The auto-reply's scheduling path (Fase 3 of the agenda): an agent
// with the "Agenda" tool is shown the free slots, and its booking
// marker is acted on — directly, or as a reservation a person approves.
// The agenda itself (what is free, what a marker may book) is tested
// in lib/agenda/ai.test.ts; here it is the wiring.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetRateLimitForTests } from '@/lib/rate-limit'
import type { AgendaForAi } from '@/lib/agenda/ai'
import { freeSlots } from '@/lib/agenda/slots'

const h = vi.hoisted(() => ({
  generateReply: vi.fn(),
  sendChannelText: vi.fn(),
  loadAgendaForAi: vi.fn(),
  bookForAi: vi.fn(),
  requestApproval: vi.fn(),
  agent: null as Record<string, unknown> | null,
}))

vi.mock('./config', () => ({
  loadAiConfig: async () => ({
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
  }),
}))
vi.mock('./context', () => ({
  buildConversationContext: async () => [{ role: 'user', content: 'Quero marcar amanhã às 9h' }],
}))
vi.mock('./knowledge', () => ({ retrieveKnowledge: async () => [] }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('./usage', () => ({ logAiUsage: async () => {} }))
vi.mock('@/lib/channels/send-text', () => ({
  channelOf: async () => 'whatsapp',
  sendChannelText: h.sendChannelText,
}))
vi.mock('@/lib/agents/store', () => ({ loadActiveAgents: async () => (h.agent ? [h.agent] : []) }))
vi.mock('@/lib/agents/routing', () => ({
  agentsForChannel: (agents: unknown[]) => agents,
  pickAgent: (agents: unknown[]) => ({ agent: agents[0], matchedKeyword: null }),
}))
vi.mock('@/lib/agents/runtime', () => ({
  startAgentRun: async () => ({ id: 'run-1' }),
  finishAgentRun: async () => {},
  recordInstantRun: async () => {},
  recordSkippedRun: async () => {},
}))
vi.mock('@/lib/agents/approvals', () => ({ requestApproval: h.requestApproval }))
vi.mock('@/lib/agenda/ai', async (original) => ({
  ...(await original<typeof import('@/lib/agenda/ai')>()),
  loadAgendaForAi: h.loadAgendaForAi,
  bookForAi: h.bookForAi,
}))
vi.mock('./admin-client', () => {
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {
      select: () => c,
      update: () => c,
      eq: () => c,
      in: () => c,
      limit: () => c,
      maybeSingle: async () => result,
      then: (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok),
    }
    return c
  }
  return {
    supabaseAdmin: () => ({
      from: (table: string) => {
        if (table === 'conversations') {
          return chain({
            data: { assigned_agent_id: null, ai_autoreply_disabled: false, ai_reply_count: 0, agent_id: null },
            error: null,
          })
        }
        if (table === 'contacts') return chain({ data: { name: 'Ana Souza', phone: '5511900000001' }, error: null })
        return chain({ data: [], error: null })
      },
      // claim_ai_reply_slot
      rpc: async () => ({ data: true, error: null }),
    }),
  }
})

import { dispatchInboundToAiReply } from './auto-reply'

const SP = 'America/Sao_Paulo'
const agenda: AgendaForAi = {
  now: new Date('2030-01-07T07:00:00-03:00'),
  contactEvents: [],
  calendars: [
    {
      id: 'c1',
      name: 'Dr. João',
      slotMinutes: 60,
      timezone: SP,
      slots: freeSlots({
        hours: [{ weekday: 1, starts: '08:00', ends: '11:00' }],
        slotMinutes: 60,
        timezone: SP,
        busy: [],
        fromDay: '2030-01-07',
        days: 1,
        now: new Date('2030-01-07T07:00:00-03:00'),
      }),
    },
  ],
}

const agent = (over: Record<string, unknown> = {}) => ({
  id: 'agent-1',
  name: 'Recepção',
  autonomy: 3,
  tools: ['calendar'],
  requireApprovalFor: [],
  systemPrompt: '',
  model: null,
  maxRepliesPerConversation: 10,
  handoffAgentId: null,
  ...over,
})

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

const MARKED = 'Perfeito, Ana! Fica para segunda às 9h.\n[[AGENDAR 1 2030-01-07 09:00]]'
const sentText = () => h.sendChannelText.mock.calls[0]?.[0]?.text
const promptSent = () => h.generateReply.mock.calls[0][0].systemPrompt as string

beforeEach(() => {
  __resetRateLimitForTests()
  for (const fn of [h.generateReply, h.sendChannelText, h.loadAgendaForAi, h.bookForAi, h.requestApproval]) {
    fn.mockReset()
  }
  h.agent = agent()
  h.loadAgendaForAi.mockResolvedValue(agenda)
  h.generateReply.mockResolvedValue({ text: MARKED, handoff: false, usage: null })
  h.bookForAi.mockResolvedValue({
    status: 'booked',
    eventId: 'e1',
    calendar: agenda.calendars[0],
    slot: agenda.calendars[0].slots[1],
  })
})

describe('an agent with the Agenda tool', () => {
  it('is shown the free slots, and told its booking is final', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(promptSent()).toContain('Agenda 1 — Dr. João')
    expect(promptSent()).toContain('Mon 2030-01-07: 08:00, 09:00, 10:00')
    expect(promptSent()).toContain('Booking takes effect at once')
  })

  it('books what its marker asked for and sends its words without the marker', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.bookForAi).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: 'acct-1',
        contactId: 'contact-1',
        request: { calendarNumber: 1, dayKey: '2030-01-07', minute: 540 },
        needsApproval: false,
        agentName: 'Recepção',
      }),
    )
    expect(sentText()).toBe('Perfeito, Ana! Fica para segunda às 9h.')
    expect(h.requestApproval).not.toHaveBeenCalled()
  })

  it('a reply with no marker books nothing', async () => {
    h.generateReply.mockResolvedValue({ text: 'Temos 08:00, 09:00 ou 10:00.', handoff: false, usage: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.bookForAi).not.toHaveBeenCalled()
    expect(sentText()).toBe('Temos 08:00, 09:00 ou 10:00.')
  })

  it('when the slot was just taken, the customer is told so instead of "marcado"', async () => {
    h.bookForAi.mockResolvedValue({ status: 'taken' })
    await dispatchInboundToAiReply(ARGS)
    expect(sentText()).toBe(
      'Esse horário acabou de ser ocupado. Quer que eu veja outro horário para você?',
    )
  })
})

describe('an agent that needs a person’s approval to book', () => {
  beforeEach(() => {
    h.agent = agent({ autonomy: 2 })
    h.bookForAi.mockResolvedValue({
      status: 'pending',
      eventId: 'e1',
      calendar: agenda.calendars[0],
      slot: agenda.calendars[0].slots[1],
    })
  })

  it('is told its booking is only a reservation', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(promptSent()).toContain('still has to approve')
    expect(h.bookForAi.mock.calls[0][1].needsApproval).toBe(true)
  })

  it('asks a person, pointing at the appointment it reserved', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.requestApproval).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agentId: 'agent-1',
        taskId: null,
        contactId: 'contact-1',
        kind: 'schedule_meeting',
        summary:
          'Marcar Ana Souza com Dr. João: seg, 7 jan às 09:00. O horário já está reservado.',
        payload: expect.objectContaining({
          event_id: 'e1',
          conversation_id: 'conv-1',
          reason: 'autonomy_below_threshold',
        }),
      }),
    )
    expect(sentText()).toBe('Perfeito, Ana! Fica para segunda às 9h.')
  })

  it('an operator can pin booking to always-ask on an autonomous agent', async () => {
    h.agent = agent({ autonomy: 4, requireApprovalFor: ['schedule_meeting'] })
    await dispatchInboundToAiReply(ARGS)
    expect(h.bookForAi.mock.calls[0][1].needsApproval).toBe(true)
    expect(h.requestApproval.mock.calls[0][1].payload.reason).toBe('pinned_by_operator')
  })
})

describe('an agent without the Agenda tool', () => {
  beforeEach(() => {
    h.agent = agent({ tools: ['messaging'] })
  })

  it('is not told about scheduling and never reads the agenda', async () => {
    h.generateReply.mockResolvedValue({ text: 'Vou verificar.', handoff: false, usage: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.loadAgendaForAi).not.toHaveBeenCalled()
    expect(promptSent()).not.toContain('Scheduling')
  })

  it('cannot book even if it writes the marker — which still never reaches the customer', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.bookForAi).not.toHaveBeenCalled()
    expect(sentText()).toBe('Perfeito, Ana! Fica para segunda às 9h.')
  })
})

describe('a CRM with no agenda', () => {
  it('the agent answers as before', async () => {
    h.loadAgendaForAi.mockResolvedValue(null)
    h.generateReply.mockResolvedValue({ text: 'Olá! Como posso ajudar?', handoff: false, usage: null })
    await dispatchInboundToAiReply(ARGS)
    expect(promptSent()).not.toContain('Scheduling')
    expect(sentText()).toBe('Olá! Como posso ajudar?')
  })

  it('a failure reading the agenda costs the customer nothing but that topic', async () => {
    h.loadAgendaForAi.mockRejectedValue(new Error('boom'))
    h.generateReply.mockResolvedValue({ text: 'Olá!', handoff: false, usage: null })
    await dispatchInboundToAiReply(ARGS)
    expect(sentText()).toBe('Olá!')
  })
})
