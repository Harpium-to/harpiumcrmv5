import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------
// A customer message on the unofficial path reaches flows, automations
// and the AI with the same rules as on the Meta webhook (D1).
// ---------------------------------------------------------------------

const h = vi.hoisted(() => ({
  flows: vi.fn(),
  automations: vi.fn(),
  ai: vi.fn(),
  webhook: vi.fn(),
}))

vi.mock('@/lib/flows/engine', () => ({ dispatchInboundToFlows: h.flows }))
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: h.automations }))
vi.mock('@/lib/ai/auto-reply', () => ({ dispatchInboundToAiReply: h.ai }))
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: h.webhook }))
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({}) }))

import { dispatchInboundToEngines, type InboundForEngines } from './inbound-dispatch'

const base: InboundForEngines = {
  accountId: 'acct-1',
  ownerUserId: 'owner-1',
  contactId: 'ct-1',
  conversationId: 'conv-1',
  externalId: 'WA1',
  text: 'quero um orçamento',
  interactiveReplyId: null,
  contentType: 'text',
  isFirstInbound: false,
  contactCreated: false,
}

const triggers = () => h.automations.mock.calls.map((c) => c[0].triggerType)

describe('dispatchInboundToEngines', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.flows.mockResolvedValue({ consumed: false })
    h.automations.mockResolvedValue(undefined)
    h.ai.mockResolvedValue(undefined)
    h.webhook.mockResolvedValue(undefined)
  })

  it('a plain text goes to flows, the content automations and the AI', async () => {
    await dispatchInboundToEngines(base)
    expect(h.flows).toHaveBeenCalledWith(
      expect.objectContaining({
        message: { kind: 'text', text: 'quero um orçamento', meta_message_id: 'WA1' },
        isFirstInboundMessage: false,
      }),
    )
    expect(triggers()).toEqual(['new_message_received', 'keyword_match'])
    expect(h.ai).toHaveBeenCalledWith({
      accountId: 'acct-1',
      conversationId: 'conv-1',
      contactId: 'ct-1',
      configOwnerUserId: 'owner-1',
    })
    expect(h.webhook).toHaveBeenCalledWith(
      {},
      'acct-1',
      'message.received',
      expect.objectContaining({ whatsapp_message_id: 'WA1', text: 'quero um orçamento' }),
    )
  })

  it('a message a flow took suppresses the content triggers and the AI, not who-is-writing', async () => {
    h.flows.mockResolvedValue({ consumed: true })
    await dispatchInboundToEngines({ ...base, isFirstInbound: true, contactCreated: true })
    expect(triggers()).toEqual(['new_contact_created', 'first_inbound_message'])
    expect(h.ai).not.toHaveBeenCalled()
  })

  it('a button tap reaches flows as a reply, fires its trigger, and the AI stays out', async () => {
    await dispatchInboundToEngines({ ...base, text: 'Manhã', interactiveReplyId: 'manha' })
    expect(h.flows).toHaveBeenCalledWith(
      expect.objectContaining({
        message: {
          kind: 'interactive_reply',
          reply_id: 'manha',
          reply_title: 'Manhã',
          meta_message_id: 'WA1',
        },
      }),
    )
    expect(triggers()).toEqual(['new_message_received', 'keyword_match', 'interactive_reply'])
    expect(h.ai).not.toHaveBeenCalled()
  })

  it('a photo without caption gets no AI answer', async () => {
    await dispatchInboundToEngines({ ...base, text: '', contentType: 'image' })
    expect(h.ai).not.toHaveBeenCalled()
  })

  it('a message without an id never collides with another in the flows de-duplication', async () => {
    await dispatchInboundToEngines({ ...base, externalId: null })
    await dispatchInboundToEngines({ ...base, externalId: null })
    const keys = h.flows.mock.calls.map((c) => c[0].message.meta_message_id)
    expect(keys[0]).toMatch(/^sem-id-/)
    expect(keys[0]).not.toBe(keys[1])
  })

  it('a failing flow runner does not stop the rest', async () => {
    h.flows.mockRejectedValue(new Error('boom'))
    await dispatchInboundToEngines(base)
    expect(triggers()).toEqual(['new_message_received', 'keyword_match'])
    expect(h.ai).toHaveBeenCalled()
  })
})
