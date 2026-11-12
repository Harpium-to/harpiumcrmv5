import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeDb, type Row } from './fake-db.test-helper'
import { normalizeLead } from './parse'

const h = vi.hoisted(() => ({
  runs: [] as unknown[],
  webhooks: [] as unknown[],
  conversations: [] as string[],
  noWhatsApp: false,
}))

vi.mock('@/lib/automations/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/automations/engine')>()),
  runAutomationsForTrigger: async (input: unknown) => {
    h.runs.push(input)
  },
}))
vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: async (_db: unknown, accountId: string, event: string, data: unknown) => {
    h.webhooks.push({ accountId, event, data })
  },
}))
vi.mock('@/lib/whatsapp/resolve-conversation', () => ({
  resolveConversationByPhone: async (_db: unknown, _acc: string, phone: string) => {
    if (h.noWhatsApp) throw new Error('WhatsApp não configurado')
    h.conversations.push(phone)
    return { conversationId: 'conv-1', contactId: 'c1', contactCreated: false }
  },
}))

const { dispatchLeadReceived } = await import('./events')

const ACC = 'acc-1'

const quizLead = (over: Record<string, unknown> = {}) =>
  normalizeLead({
    versao: '1',
    origem: 'quiz-planejados',
    contato: { nome: 'Ana', telefone: '+5563999990000' },
    qualificacao: { rota: 'A' },
    etiquetas: ['verba-baixa'],
    ...over,
  })

function world(contact: Row = {}, automations: Row[] = []): Record<string, Row[]> {
  return {
    contacts: [{ id: 'c1', account_id: ACC, phone: '+5563999990000', name: 'Ana', opted_out_at: null, ...contact }],
    automations,
  }
}

const auto = (cfg: Row, over: Row = {}): Row => ({
  id: `a-${Math.random()}`,
  account_id: ACC,
  trigger_type: 'lead_received',
  trigger_config: cfg,
  is_active: true,
  ...over,
})

beforeEach(() => {
  h.runs = []
  h.webhooks = []
  h.conversations = []
  h.noWhatsApp = false
})

describe('dispatchLeadReceived', () => {
  it('fires the webhook and the matching automations with an open conversation', async () => {
    const db = fakeDb(world({}, [auto({ rota: 'A', origens: ['quiz-planejados'] })]))
    await dispatchLeadReceived(db, { accountId: ACC, leadId: 'l1', contactId: 'c1', lead: quizLead() })

    expect(h.webhooks).toEqual([
      expect.objectContaining({
        event: 'lead.received',
        data: expect.objectContaining({ lead_id: 'l1', origem: 'quiz-planejados', rota: 'A' }),
      }),
    ])
    expect(h.conversations).toEqual(['+5563999990000'])
    expect(h.runs).toEqual([
      expect.objectContaining({
        accountId: ACC,
        triggerType: 'lead_received',
        contactId: 'c1',
        context: expect.objectContaining({
          conversation_id: 'conv-1',
          lead: expect.objectContaining({ lead_id: 'l1', etiquetas: ['verba-baixa', 'rota-a'] }),
          vars: expect.objectContaining({ primeiro_nome: 'Ana' }),
        }),
      }),
    ])
  })

  it('opens no conversation when no automation wants the lead', async () => {
    const db = fakeDb(world({}, [auto({ rota: 'B' }), auto({}, { is_active: false })]))
    await dispatchLeadReceived(db, { accountId: ACC, leadId: 'l1', contactId: 'c1', lead: quizLead() })
    expect(h.webhooks).toHaveLength(1)
    expect(h.conversations).toHaveLength(0)
    expect(h.runs).toHaveLength(0)
  })

  it('never runs flows for a contact who opted out, or a lead that refused consent', async () => {
    const optedOut = fakeDb(world({ opted_out_at: '2026-11-01T00:00:00Z' }, [auto({})]))
    await dispatchLeadReceived(optedOut, { accountId: ACC, leadId: 'l1', contactId: 'c1', lead: quizLead() })

    const refused = fakeDb(world({}, [auto({})]))
    await dispatchLeadReceived(refused, {
      accountId: ACC,
      leadId: 'l2',
      contactId: 'c1',
      lead: quizLead({ consentimento: { aceito: false } }),
    })
    expect(h.runs).toHaveLength(0)
    expect(h.webhooks).toHaveLength(2)
  })

  it('still runs the automation without WhatsApp (its non-message steps work)', async () => {
    h.noWhatsApp = true
    const db = fakeDb(world({}, [auto({})]))
    await dispatchLeadReceived(db, { accountId: ACC, leadId: 'l1', contactId: 'c1', lead: quizLead() })
    expect(h.runs).toHaveLength(1)
    expect((h.runs[0] as { context: { conversation_id?: string } }).context.conversation_id).toBeUndefined()
  })

  it('a lead without a contact only fires the webhook', async () => {
    const db = fakeDb(world({}, [auto({})]))
    await dispatchLeadReceived(db, { accountId: ACC, leadId: 'l1', contactId: null, lead: quizLead() })
    expect(h.webhooks).toHaveLength(1)
    expect(h.runs).toHaveLength(0)
  })
})
