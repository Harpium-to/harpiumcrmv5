import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { memoryDb, type MemoryDb } from '@/lib/testing/memory-supabase'

// ---------------------------------------------------------------------------
// WhatsApp Cloud API inbound → a new contact lands in the funnel.
//
// Drives the real POST handler end to end against an in-memory database
// that enforces the production unique indexes (one conversation per
// contact). Only the side channels that would reach the network or other
// engines are stubbed: flows, AI reply, outbound webhooks, automations.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  db: null as MemoryDb | null,
  /** Work handed to `after()`, awaited by `deliver`. */
  pending: [] as Promise<unknown>[],
  /** How many deals existed each time an automation was dispatched. */
  dealsSeenByAutomations: [] as number[],
}))

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (fn: () => unknown) => {
      h.pending.push(Promise.resolve().then(fn))
    },
  }
})

// The route caches its admin client at module level, so hand it a thin
// proxy that always reads the current test's database.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => h.db!.client.from(t),
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}))

vi.mock('@/lib/whatsapp/encryption', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/whatsapp/encryption')>()),
  decrypt: () => 'access-token',
}))
vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: vi.fn(async () => ({ consumed: false })),
}))
vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: vi.fn(async () => {}),
}))
vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: vi.fn(async () => {}),
}))
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: vi.fn(async () => {
    h.dealsSeenByAutomations.push(h.db!.rows('deals').length)
  }),
}))

import { POST } from './route'

const ACC = 'acc-1'
const OWNER = 'owner-1'
const PHONE = '5511977776666'

function setup(extra: Record<string, Record<string, unknown>[]> = {}) {
  h.db = memoryDb({
    seed: {
      whatsapp_config: [
        { account_id: ACC, user_id: OWNER, phone_number_id: 'PNID-1', access_token: 'enc' },
      ],
      accounts: [{ id: ACC, default_currency: 'BRL' }],
      pipelines: [{ id: 'p1', account_id: ACC, name: 'Vendas' }],
      pipeline_stages: [
        { id: 's-second', pipeline_id: 'p1', name: 'Qualificado', position: 1 },
        { id: 's-first', pipeline_id: 'p1', name: 'Primeiro contato', position: 0 },
      ],
      ...extra,
    },
  })
  return h.db
}

type Msg = Record<string, unknown>

function payload(messages: Msg[], name = 'Carla') {
  return {
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '551130000000', phone_number_id: 'PNID-1' },
              contacts: [{ profile: { name }, wa_id: PHONE }],
              messages: messages.map((m) => ({
                from: PHONE,
                timestamp: '1767225600',
                type: 'text',
                text: { body: 'Olá, tudo bem?' },
                ...m,
              })),
            },
          },
        ],
      },
    ],
  }
}

function signed(body: unknown): Request {
  const raw = JSON.stringify(body)
  const sig = 'sha256=' + createHmac('sha256', process.env.META_APP_SECRET!).update(raw).digest('hex')
  return new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    body: raw,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
  })
}

/** POST one or more deliveries concurrently and wait for their after() work. */
async function deliver(...bodies: unknown[]) {
  const responses = await Promise.all(bodies.map((b) => POST(signed(b))))
  for (const r of responses) expect(r.status).toBe(200)
  await Promise.all(h.pending.splice(0))
}

beforeEach(() => {
  h.pending = []
  h.dealsSeenByAutomations = []
})

describe('WhatsApp webhook → first-contact deal', () => {
  it("a new contact's first message opens a deal at the funnel's first stage", async () => {
    const db = setup()

    await deliver(payload([{ id: 'wamid.1' }]))

    expect(db.rows('deals')).toHaveLength(1)
    expect(db.rows('deals')[0]).toMatchObject({
      account_id: ACC,
      user_id: OWNER,
      pipeline_id: 'p1',
      stage_id: 's-first',
      contact_id: db.rows('contacts')[0].id,
      conversation_id: db.rows('conversations')[0].id,
      title: 'Carla',
      currency: 'BRL',
      status: 'open',
    })
  })

  it('the deal exists before automations run, so a "create deal" automation can skip it', async () => {
    setup()

    await deliver(payload([{ id: 'wamid.1' }]))

    expect(h.dealsSeenByAutomations.length).toBeGreaterThan(0)
    expect(h.dealsSeenByAutomations.every((n) => n === 1)).toBe(true)
  })

  it('later messages from the same contact add no deal', async () => {
    const db = setup()

    await deliver(payload([{ id: 'wamid.1' }]))
    await deliver(payload([{ id: 'wamid.2' }]))
    await deliver(payload([{ id: 'wamid.3' }, { id: 'wamid.4' }]))

    expect(db.rows('messages')).toHaveLength(4)
    expect(db.rows('deals')).toHaveLength(1)
  })

  it('two deliveries arriving at once from a new contact make one deal', async () => {
    const db = setup()

    await deliver(payload([{ id: 'wamid.a' }]), payload([{ id: 'wamid.b' }]))

    expect(db.rows('conversations')).toHaveLength(1)
    expect(db.rows('deals')).toHaveLength(1)
  })

  it('a contact the team already has a conversation with gets no deal', async () => {
    const db = setup({
      contacts: [{ id: 'c1', account_id: ACC, name: 'Carla', phone: PHONE }],
      conversations: [{ id: 'conv1', account_id: ACC, contact_id: 'c1' }],
    })

    await deliver(payload([{ id: 'wamid.1' }]))

    expect(db.rows('deals')).toHaveLength(0)
  })

  it('a contact that already has an open deal gets no second one', async () => {
    const db = setup({
      contacts: [{ id: 'c1', account_id: ACC, name: 'Carla', phone: PHONE }],
      deals: [
        { account_id: ACC, contact_id: 'c1', pipeline_id: 'p1', stage_id: 's-second', status: 'open', title: 'Carla' },
      ],
    })

    await deliver(payload([{ id: 'wamid.1' }]))

    expect(db.rows('deals')).toHaveLength(1)
    expect(db.rows('deals')[0].stage_id).toBe('s-second')
  })

  it('a reaction is not someone reaching out', async () => {
    const db = setup()

    await deliver(
      payload([{ id: 'wamid.r', type: 'reaction', text: undefined, reaction: { message_id: 'x', emoji: '👍' } }]),
    )

    expect(db.rows('deals')).toHaveLength(0)
  })
})
