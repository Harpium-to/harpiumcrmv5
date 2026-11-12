import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AiError, type AiConfig } from './types'
import { MetaApiError } from '@/lib/whatsapp/meta-api'
import { __resetRateLimitForTests } from '@/lib/rate-limit'
import {
  REPLY_FAILURE_CODES,
  classifyReplyFailure,
  parseReplyFailure,
} from './reply-failure'
import { autoReplyStatusFromConfig } from './autoreply-status'
import { DEFAULT_HANDOFF_NOTICE } from './handoff'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    /** Rows `loadActiveAgents` sees. Empty → single-assistant mode. */
    agents: [] as Record<string, unknown>[],
    claim: true as boolean,
    /** Does the guarded handoff UPDATE (`… AND ai_autoreply_disabled =
     *  false`) match the row? false simulates losing that race. */
    handoffMatches: true as boolean,
    /** The last `conversations` UPDATE payload that carried the pause. */
    updatePayload: null as Record<string, unknown> | null,
    /** Every `conversations` UPDATE, with the filters it was scoped by. */
    convUpdates: [] as {
      payload: Record<string, unknown>
      filters: [string, unknown][]
    }[],
    rpcCalls: [] as { name: string; args: unknown }[],
    runInserts: [] as Record<string, unknown>[],
    runUpdates: [] as Record<string, unknown>[],
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('./admin-client', () => {
  /** A PostgREST-ish builder: chainable, and awaitable at any point. */
  function chain(result: () => unknown, extra: Record<string, unknown> = {}) {
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      neq: () => c,
      in: () => c,
      order: () => c,
      limit: () => c,
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(ok, ko),
      ...extra,
    }
    return c
  }

  return {
    supabaseAdmin: () => ({
      from: (table: string) => {
        if (table === 'automations') {
          return chain(() => ({ data: h.state.autoResponders, error: null }))
        }
        if (table === 'agents') {
          return chain(() => ({ data: h.state.agents, error: null }))
        }
        if (table === 'agent_runs') {
          return {
            insert: (row: Record<string, unknown>) => {
              h.state.runInserts.push(row)
              return chain(() => ({ error: null }), {
                single: () =>
                  Promise.resolve({ data: { id: 'run-1' }, error: null }),
              })
            },
            update: (row: Record<string, unknown>) => {
              h.state.runUpdates.push(row)
              return chain(() => ({ error: null }))
            },
          }
        }
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: h.state.conv, error: null }),
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              const entry = { payload, filters: [] as [string, unknown][] }
              h.state.convUpdates.push(entry)
              if ('ai_autoreply_disabled' in payload) {
                h.state.updatePayload = payload
              }
              const guarded = () =>
                entry.filters.some(([col]) => col === 'ai_autoreply_disabled')
              const c: Record<string, unknown> = {
                eq: (col: string, value: unknown) => {
                  entry.filters.push([col, value])
                  return c
                },
                select: () =>
                  Promise.resolve({
                    data:
                      !guarded() || h.state.handoffMatches
                        ? [{ id: 'conv-1' }]
                        : [],
                    error: null,
                  }),
                then: (ok: (v: unknown) => unknown) =>
                  Promise.resolve({ error: null }).then(ok),
              }
              return c
            },
          }
        }
        // ai_usage and anything else: accept writes, return nothing.
        return {
          insert: () => Promise.resolve({ error: null }),
          ...chain(() => ({ data: null, error: null })),
        }
      },
      rpc: (name: string, args: unknown) => {
        h.state.rpcCalls.push({ name, args })
        return Promise.resolve({ data: h.state.claim, error: null })
      },
    }),
  }
})

import { dispatchInboundToAiReply } from './auto-reply'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

/** An `agents` row as PostgREST returns it — the shape `mapAgentRow` reads. */
function agentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    account_id: 'acct-1',
    name: 'Atendimento Harpium',
    role: 'support',
    avatar_url: null,
    objective: null,
    autonomy: 1,
    tools: [],
    channels: ['whatsapp'],
    require_approval_for: [],
    work_days: [1, 2, 3, 4, 5],
    work_start: '09:00',
    work_end: '18:00',
    timezone: 'America/Sao_Paulo',
    goals: {},
    status: 'idle',
    status_detail: null,
    status_changed_at: '2026-01-01T00:00:00.000Z',
    cost_usd: '0',
    department: 'Atendimento',
    system_prompt: 'Você atende clientes da Harpium.',
    model: null,
    keywords: [],
    priority: 0,
    is_fallback: true,
    is_active: true,
    max_replies_per_conversation: 10,
    handoff_agent_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function conv(overrides: Record<string, unknown> = {}) {
  return {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
    agent_id: null,
    ...overrides,
  }
}

/** Every run outcome written, in order: instant rows and closed runs. */
function runOutcomes() {
  return [
    ...h.state.runInserts.filter((r) => r.status !== 'running'),
    ...h.state.runUpdates,
  ].map((r) => ({ status: r.status, reason: r.reason ?? null }))
}

beforeEach(() => {
  __resetRateLimitForTests()
  h.state.conv = conv()
  h.state.autoResponders = []
  h.state.agents = []
  h.state.claim = true
  h.state.handoffMatches = true
  h.state.updatePayload = null
  h.state.convUpdates = []
  h.state.rpcCalls = []
  h.state.runInserts = []
  h.state.runUpdates = []
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('quotes the greeting an automation already sent, so the AI does not greet again', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'assistant', content: 'Oi, Ana! Vi que você respondeu nosso quiz.' },
      { role: 'user', content: 'oi, quero saber o preço' },
    ])
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain(
      'The business already greeted this customer in this conversation: "Oi, Ana! Vi que você respondeu nosso quiz."',
    )
  })

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('drops the reply when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim; the generated reply is not sent —
    // the cap is spent, so the customer gets the handoff notice.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: DEFAULT_HANDOFF_NOTICE }),
    )
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = conv({ assigned_agent_id: 'agent-9' })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = conv({ ai_autoreply_disabled: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  const NOTICE = 'Vou chamar o Marcelo, nosso especialista, para montar sua proposta.'

  it('pauses the bot and tells the customer in the model’s own words', async () => {
    h.generateReply.mockResolvedValue({ text: NOTICE, handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: NOTICE }),
    )
    // The bot's last word on the thread, not another turn: no reply slot.
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'A IA passou a conversa para a equipe',
    )
    // The model's own call — no cap wording.
    expect(h.state.updatePayload?.ai_handoff_summary).not.toContain('limite')
    // No handoff target configured → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it.each([
    ['the bare marker', { text: '', handoff: true }],
    ['an empty answer', { text: '', handoff: false }],
  ])('never hands off in silence — a default notice for %s', async (_, reply) => {
    h.generateReply.mockResolvedValue(reply)
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: DEFAULT_HANDOFF_NOTICE }),
    )
  })

  it('pauses before it sends', async () => {
    h.generateReply.mockResolvedValue({ text: NOTICE, handoff: true })
    let pausedAtSend: unknown = 'not sent'
    h.engineSendText.mockImplementation(async () => {
      pausedAtSend = h.state.updatePayload?.ai_autoreply_disabled
      return { whatsapp_message_id: 'm1' }
    })
    await dispatchInboundToAiReply(ARGS)
    expect(pausedAtSend).toBe(true)
  })

  it('stays quiet when a human took over while the model was thinking', async () => {
    h.generateReply.mockResolvedValue({ text: NOTICE, handoff: true })
    h.state.handoffMatches = false // the guarded pause matched no row
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })

  describe('in agent mode', () => {
    beforeEach(() => {
      h.state.agents = [agentRow()]
    })

    it('records the notice as the run’s output', async () => {
      h.generateReply.mockResolvedValue({ text: NOTICE, handoff: true })
      await dispatchInboundToAiReply(ARGS)
      expect(runOutcomes()).toEqual([{ status: 'handoff', reason: null }])
      expect(h.state.runUpdates[0].output_preview).toBe(NOTICE)
    })

    it('records why the customer got nothing when the notice fails', async () => {
      h.generateReply.mockResolvedValue({ text: '', handoff: true })
      const message = '(#131030) Recipient phone number not in allowed list'
      h.engineSendText.mockRejectedValue(new MetaApiError(message, 131030))
      await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
      // Still paused: the thread belongs to a human either way.
      expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
      expect(runOutcomes()).toEqual([
        { status: 'failed', reason: `whatsapp_not_in_allowed_list: ${message}` },
      ])
    })

    it('records a skip when a human took over mid-generation', async () => {
      h.generateReply.mockResolvedValue({ text: NOTICE, handoff: true })
      h.state.handoffMatches = false
      await dispatchInboundToAiReply(ARGS)
      expect(runOutcomes()).toEqual([{ status: 'skipped', reason: 'handed_off' }])
    })
  })
})

// ------------------------------------------------------------------
// 1. Reply cap → handoff, not silence.
//
// The settings screen promises that at the limit the bot "pausa e
// direciona a conversa com uma nota". It used to log a skip and
// return, leaving the customer unanswered and nobody told.
// ------------------------------------------------------------------
describe('dispatchInboundToAiReply — reply cap hands off', () => {
  it('pauses the bot, leaves a cap note and tells the customer', async () => {
    h.state.conv = conv({ ai_reply_count: 3 })
    let pausedAtSend: unknown = 'not sent'
    h.engineSendText.mockImplementation(async () => {
      pausedAtSend = h.state.updatePayload?.ai_autoreply_disabled
      return { whatsapp_message_id: 'm1' }
    })
    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: DEFAULT_HANDOFF_NOTICE }),
    )
    // Paused first; and the notice is not another turn — no slot.
    expect(pausedAtSend).toBe(true)
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toBe(
      '🤖 A IA passou a conversa para a equipe depois de 3 respostas (limite da conversa). Última mensagem do cliente: “hi”',
    )
    // No target configured → left in the shared queue.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('only writes while the bot is still on, so it hands off once', async () => {
    h.state.conv = conv({ ai_reply_count: 3 })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.convUpdates[0].filters).toEqual(
      expect.arrayContaining([
        ['id', 'conv-1'],
        ['ai_autoreply_disabled', false],
      ]),
    )
  })

  it('routes to the account handoff target at the cap', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'human-7' }))
    h.state.conv = conv({ ai_reply_count: 3 })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'human-7',
    })
  })

  it('never overwrites an existing assignment', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'human-7' }))
    h.state.conv = conv({ ai_reply_count: 3, assigned_agent_id: 'human-1' })
    await dispatchInboundToAiReply(ARGS)
    // A human already owns it: no pause, no reassignment, no reply.
    expect(h.state.convUpdates).toHaveLength(0)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  describe('in agent mode', () => {
    beforeEach(() => {
      h.state.agents = [agentRow({ handoff_agent_id: 'human-2' })]
    })

    it('records the run as a handoff and uses the agent’s target', async () => {
      h.state.conv = conv({ ai_reply_count: 10 })
      await dispatchInboundToAiReply(ARGS)

      expect(h.generateReply).not.toHaveBeenCalled()
      expect(h.state.updatePayload).toMatchObject({
        ai_autoreply_disabled: true,
        assigned_agent_id: 'human-2',
      })
      expect(h.state.updatePayload?.ai_handoff_summary).toContain(
        'depois de 10 respostas (limite da conversa)',
      )
      expect(runOutcomes()).toEqual([
        { status: 'handoff', reason: 'reply_cap_reached' },
      ])
      expect(h.state.runInserts[0].output_preview).toBe(DEFAULT_HANDOFF_NOTICE)
    })

    it('records why the customer got nothing when the cap notice fails', async () => {
      h.state.conv = conv({ ai_reply_count: 10 })
      const message = '(#131030) Recipient phone number not in allowed list'
      h.engineSendText.mockRejectedValue(new MetaApiError(message, 131030))
      await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
      // Still paused: the thread belongs to a human either way.
      expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
      expect(runOutcomes()).toEqual([
        { status: 'failed', reason: `whatsapp_not_in_allowed_list: ${message}` },
      ])
    })

    it('uses the agent’s own cap, not the account’s', async () => {
      // 3 is the account cap; the agent allows 10.
      h.state.conv = conv({ ai_reply_count: 3 })
      await dispatchInboundToAiReply(ARGS)
      expect(h.engineSendText).toHaveBeenCalled()
      expect(h.state.updatePayload).toBeNull()
    })

    it('does not hand off again on the next message', async () => {
      // State after the first handoff: paused, count still at the cap.
      h.state.conv = conv({ ai_reply_count: 10, ai_autoreply_disabled: true })
      await dispatchInboundToAiReply(ARGS)
      expect(h.state.convUpdates).toHaveLength(0)
      expect(runOutcomes()).toEqual([{ status: 'skipped', reason: 'handed_off' }])
    })

    it('records a plain skip when a concurrent inbound handed off first', async () => {
      h.state.conv = conv({ ai_reply_count: 10 })
      h.state.handoffMatches = false // the guarded UPDATE matched no row
      await dispatchInboundToAiReply(ARGS)
      expect(runOutcomes()).toEqual([
        { status: 'skipped', reason: 'reply_cap_reached' },
      ])
      // The handoff that won already told the customer.
      expect(h.engineSendText).not.toHaveBeenCalled()
    })

    it('hands off when the cap is lost at the atomic claim', async () => {
      // Read said 9/10, but another inbound took the last slot while
      // this one was generating.
      h.state.conv = conv({ ai_reply_count: 9 })
      h.state.claim = false
      await dispatchInboundToAiReply(ARGS)

      // The reply it generated is dropped for the handoff notice.
      expect(h.engineSendText).toHaveBeenCalledTimes(1)
      expect(h.engineSendText).toHaveBeenCalledWith(
        expect.objectContaining({ text: DEFAULT_HANDOFF_NOTICE }),
      )
      expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
      expect(h.state.updatePayload?.ai_handoff_summary).toContain(
        'depois de 10 respostas (limite da conversa)',
      )
      expect(runOutcomes()).toEqual([
        { status: 'handoff', reason: 'reply_cap_reached' },
      ])
    })
  })
})

// ------------------------------------------------------------------
// 2. The inbox banner must see agent mode.
//
// With an active agent the dispatcher answers and never reads
// `auto_reply_enabled`; a banner gated on that switch alone hid
// "Assumir" / "Retomar IA" from every team running on agents.
// ------------------------------------------------------------------
describe('auto-reply status for the inbox banner', () => {
  const base = { configured: true, has_key: true, is_active: true }

  it('is on in agent mode even with the single-assistant switch off', async () => {
    h.state.agents = [agentRow()]
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)

    // The dispatcher answers (a thread with no channel is WhatsApp)…
    expect(h.engineSendText).toHaveBeenCalled()
    // …so the banner must show.
    expect(
      autoReplyStatusFromConfig(
        { ...base, auto_reply_enabled: false, agent_channels: ['whatsapp'] },
        undefined,
      ),
    ).toEqual({ autoReplyOn: true, agentMode: true })
  })

  it('is off without agents when the switch is off — and so is the bot', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(
      autoReplyStatusFromConfig(
        { ...base, auto_reply_enabled: false, agent_channels: [] },
        'whatsapp',
      ),
    ).toEqual({ autoReplyOn: false, agentMode: false })
  })

  it('keeps the single-assistant mode on its switch', () => {
    expect(
      autoReplyStatusFromConfig({ ...base, auto_reply_enabled: true }, 'whatsapp'),
    ).toEqual({ autoReplyOn: true, agentMode: false })
  })

  it('is off when AI itself is unavailable, agents or not', () => {
    for (const cfg of [
      null,
      { configured: false, agent_channels: [] },
      { ...base, is_active: false, agent_channels: ['whatsapp'] },
      { ...base, has_key: false, agent_channels: ['whatsapp'] },
    ]) {
      expect(autoReplyStatusFromConfig(cfg, 'whatsapp')).toEqual({
        autoReplyOn: false,
        agentMode: false,
      })
    }
  })
})

// ------------------------------------------------------------------
// 2b. Agents answer only on the channels ticked on them.
//
// Routing used to ignore `agents.channels`, so an agent marked
// WhatsApp-only also answered Instagram DMs. Agent mode is now decided
// per channel, an empty list means the agent talks to no customer, and
// a channel no agent covers falls back to the single assistant and its
// switch. Each case checks the dispatcher and the banner together.
// ------------------------------------------------------------------
describe('dispatchInboundToAiReply — channels', () => {
  const base = { configured: true, has_key: true, is_active: true }

  it('keeps a WhatsApp-only agent off Instagram', async () => {
    h.state.agents = [agentRow({ channels: ['whatsapp'] })]
    h.state.conv = conv({ channel: 'instagram' })
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    // Not even a skipped run: the agent was never a candidate here.
    expect(h.state.runInserts).toHaveLength(0)
    expect(
      autoReplyStatusFromConfig(
        { ...base, auto_reply_enabled: false, agent_channels: ['whatsapp'] },
        'instagram',
      ),
    ).toEqual({ autoReplyOn: false, agentMode: false })
  })

  it('falls back to the single assistant on a channel no agent covers', async () => {
    h.state.agents = [agentRow({ channels: ['whatsapp'] })]
    h.state.conv = conv({ channel: 'instagram' })
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: true }))
    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).toHaveBeenCalled()
    // The account's cap (3), not the agent's (10), and no agent run.
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.state.runInserts).toHaveLength(0)
    // The agent's persona stays out of the prompt.
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).not.toContain('Você atende clientes da Harpium.')
    expect(
      autoReplyStatusFromConfig(
        { ...base, auto_reply_enabled: true, agent_channels: ['whatsapp'] },
        'instagram',
      ),
    ).toEqual({ autoReplyOn: true, agentMode: false })
  })

  it('answers Instagram through an agent that has it ticked', async () => {
    h.state.agents = [agentRow({ channels: ['whatsapp', 'instagram'] })]
    h.state.conv = conv({ channel: 'instagram' })
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).toHaveBeenCalled()
    expect(h.state.runInserts[0]).toMatchObject({ agent_id: 'agent-1' })
    expect(
      autoReplyStatusFromConfig(
        {
          ...base,
          auto_reply_enabled: false,
          agent_channels: ['whatsapp', 'instagram'],
        },
        'instagram',
      ),
    ).toEqual({ autoReplyOn: true, agentMode: true })
  })

  it('never lets an agent with no channels answer a customer', async () => {
    // A fallback agent with an empty list — a researcher, say.
    h.state.agents = [agentRow({ channels: [] })]
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.state.runInserts).toHaveLength(0)
    expect(
      autoReplyStatusFromConfig(
        { ...base, auto_reply_enabled: false, agent_channels: [] },
        'whatsapp',
      ),
    ).toEqual({ autoReplyOn: false, agentMode: false })
  })

  it('re-routes a thread whose owner no longer speaks on its channel', async () => {
    h.state.agents = [
      agentRow({ id: 'agent-wa', channels: ['whatsapp'], is_fallback: false }),
      agentRow({ id: 'agent-ig', channels: ['instagram'], is_fallback: true }),
    ]
    // Stamped before its channels were narrowed to WhatsApp.
    h.state.conv = conv({ channel: 'instagram', agent_id: 'agent-wa' })
    await dispatchInboundToAiReply(ARGS)

    expect(h.state.runInserts[0]).toMatchObject({ agent_id: 'agent-ig' })
    expect(h.state.convUpdates.map((u) => u.payload)).toContainEqual({
      agent_id: 'agent-ig',
    })
  })

  it('keeps a thread with the owner that still speaks on its channel', async () => {
    h.state.agents = [
      agentRow({ id: 'agent-wa', channels: ['whatsapp'], is_fallback: false }),
      agentRow({
        id: 'agent-both',
        channels: ['whatsapp', 'instagram'],
        is_fallback: true,
      }),
    ]
    h.state.conv = conv({ channel: 'whatsapp', agent_id: 'agent-wa' })
    await dispatchInboundToAiReply(ARGS)

    // The fallback would take it on a fresh thread; the owner wins here.
    expect(h.state.runInserts[0]).toMatchObject({ agent_id: 'agent-wa' })
  })
})

// ------------------------------------------------------------------
// 3. A failed reply must be legible from the conversation.
//
// The run's reason now leads with a stable code the inbox translates;
// the raw Meta / provider text follows it for the monitor.
// ------------------------------------------------------------------
describe('dispatchInboundToAiReply — failed replies', () => {
  beforeEach(() => {
    h.state.agents = [agentRow()]
  })

  /** Run one dispatch and return the failed run's parsed reason. */
  async function failedReason() {
    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
    const failed = h.state.runUpdates.filter((r) => r.status === 'failed')
    expect(failed).toHaveLength(1)
    return failed[0].reason as string
  }

  it.each([
    [131030, '(#131030) Recipient phone number not in allowed list', 'whatsapp_not_in_allowed_list'],
    [131047, '(#131047) Re-engagement message', 'whatsapp_window_closed'],
    [133010, '(#133010) Account not registered', 'whatsapp_number_not_registered'],
  ] as const)(
    'classifies Meta %i on send',
    async (metaCode, message, expected) => {
      h.engineSendText.mockRejectedValue(new MetaApiError(message, metaCode))
      const reason = await failedReason()
      expect(reason).toBe(`${expected}: ${message}`)
      expect(parseReplyFailure(reason)).toEqual({ code: expected, detail: message })
    },
  )

  it('classifies a Meta error by its code even when the text lacks it', async () => {
    h.engineSendText.mockRejectedValue(
      new MetaApiError('Recipient not allowed', 131030),
    )
    expect(parseReplyFailure(await failedReason()).code).toBe(
      'whatsapp_not_in_allowed_list',
    )
  })

  it('classifies a rejected AI key', async () => {
    h.generateReply.mockRejectedValue(
      new AiError('OpenAI rejected the API key: Incorrect API key provided', {
        code: 'invalid_key',
        status: 401,
      }),
    )
    expect(parseReplyFailure(await failedReason()).code).toBe('ai_invalid_key')
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it.each([
    'OpenAI rate limit reached: You exceeded your current quota, please check your plan and billing details.',
    'Anthropic API error (400): Your credit balance is too low to access the Anthropic API.',
  ])('classifies an AI account out of credit: %s', async (message) => {
    h.generateReply.mockRejectedValue(
      new AiError(message, { code: 'rate_limited' }),
    )
    expect(parseReplyFailure(await failedReason()).code).toBe('ai_no_credit')
  })

  it('falls back to unknown, keeping the raw detail', async () => {
    h.engineSendText.mockRejectedValue(new Error('socket hang up'))
    expect(parseReplyFailure(await failedReason())).toEqual({
      code: 'unknown',
      detail: 'socket hang up',
    })
  })

  it('never reads a Meta error as an AI billing problem', () => {
    expect(
      classifyReplyFailure(new MetaApiError('(#131042) billing issue', 131042)),
    ).toBe('unknown')
  })

  it('reads reasons stored before the code prefix existed', () => {
    expect(
      parseReplyFailure('(#131030) Recipient phone number not in allowed list'),
    ).toEqual({
      code: 'whatsapp_not_in_allowed_list',
      detail: '(#131030) Recipient phone number not in allowed list',
    })
    expect(parseReplyFailure('claim_slot_failed').code).toBe('unknown')
    expect(parseReplyFailure(null)).toEqual({ code: 'unknown', detail: null })
  })

  it('has a pt and an en notice for every failure code', () => {
    for (const lang of ['pt', 'en']) {
      const messages = JSON.parse(
        readFileSync(new URL(`../../../messages/${lang}.json`, import.meta.url), 'utf8'),
      )
      const failure = messages.Inbox.aiBanner.failure
      expect(failure.title, lang).toBeTruthy()
      for (const code of REPLY_FAILURE_CODES) {
        expect(failure[code], `${lang}: ${code}`).toBeTruthy()
      }
    }
  })
})
