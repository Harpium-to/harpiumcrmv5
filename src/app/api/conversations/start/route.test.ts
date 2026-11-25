import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------
// The route adds the gate (agent+), the account from the session and
// the "goes to whoever opened it" step to lib/inbox/start-conversation,
// which has its own tests.
// ---------------------------------------------------------------------

class Forbidden extends Error {
  status = 403
}

let role: 'agent' | 'viewer' = 'agent'
const start = vi.fn()
const transfer = vi.fn()

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => {
    if (role === 'viewer') throw new Forbidden('Sem permissão')
    return { supabase: 'user-client', accountId: 'acc-1', userId: 'user-1' }
  }),
  toErrorResponse: (err: unknown) =>
    new Response(JSON.stringify({ error: String(err) }), {
      status: err instanceof Forbidden ? 403 : 500,
    }),
}))
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => 'admin-client' }))
vi.mock('@/lib/atendimento/transferir', () => ({
  transferirConversa: (...a: unknown[]) => transfer(...a),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { send: {} },
}))
vi.mock('@/lib/inbox/start-conversation', async (orig) => {
  const real = await orig<typeof import('@/lib/inbox/start-conversation')>()
  return { ...real, startConversation: (...a: unknown[]) => start(...a) }
})

const { POST } = await import('./route')
const { StartConversationError } = await import('@/lib/inbox/start-conversation')

function call(body: unknown) {
  return POST(
    new Request('http://localhost/api/conversations/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  role = 'agent'
  start.mockResolvedValue({ conversationId: 'conv-1', contactId: 'ct-1', contactCreated: true, provider: 'meta' })
  transfer.mockResolvedValue({ ok: true })
})

describe('POST /api/conversations/start', () => {
  it('opens the conversation in the caller\'s CRM and gives it to them if nobody has it', async () => {
    const res = await call({ phone: '63 99208-5436', name: 'Ana', account_id: 'other' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ conversation_id: 'conv-1', contact_created: true, provider: 'meta' })
    expect(start).toHaveBeenCalledWith('admin-client', { accountId: 'acc-1', phone: '63 99208-5436', name: 'Ana' })
    expect(transfer).toHaveBeenCalledWith('user-client', {
      conversationId: 'conv-1',
      target: { kind: 'pessoa', userId: 'user-1' },
      source: 'manual',
      note: null,
      onlyIfUnassigned: true,
    })
  })

  it('still answers when taking it fails', async () => {
    transfer.mockRejectedValue(new Error('boom'))
    const res = await call({ phone: '63992085436' })
    expect(res.status).toBe(200)
  })

  it('needs a number', async () => {
    const res = await call({ name: 'Ana' })
    expect(res.status).toBe(400)
    expect(start).not.toHaveBeenCalled()
  })

  it('passes on the reason a number was refused', async () => {
    start.mockRejectedValue(new StartConversationError('Esse número não tem WhatsApp.', 422, 'no_whatsapp'))
    const res = await call({ phone: '63992085436' })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Esse número não tem WhatsApp.', code: 'no_whatsapp' })
  })

  it('refuses someone who can only look', async () => {
    role = 'viewer'
    const res = await call({ phone: '63992085436' })
    expect(res.status).toBe(403)
    expect(start).not.toHaveBeenCalled()
  })
})
