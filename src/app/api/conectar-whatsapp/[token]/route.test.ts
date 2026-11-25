import { beforeEach, describe, expect, it, vi } from 'vitest'

const find = vi.fn()
const claim = vi.fn()
const release = vi.fn()
const finish = vi.fn()

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}))
vi.mock('@/lib/whatsapp/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { owner_user_id: 'owner-1' } }) }) }),
    }),
  }),
}))
vi.mock('@/lib/whatsapp/connect-links', () => ({
  findUsableConnectLink: (...a: unknown[]) => find(...a),
  claimConnectLink: (...a: unknown[]) => claim(...a),
  releaseConnectLink: (...a: unknown[]) => release(...a),
}))
vi.mock('@/lib/whatsapp/finish-embedded-signup', () => ({
  finishEmbeddedSignup: (...a: unknown[]) => finish(...a),
}))

const { POST } = await import('./route')

function call(body: unknown = { code: 'c' }) {
  return POST(
    new Request('http://localhost/api/conectar-whatsapp/tok', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token: 'tok' }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  find.mockResolvedValue({ id: 'link-1', accountId: 'acc-1', createdBy: 'u-1', crmName: 'Clínica Sol' })
  claim.mockResolvedValue(true)
  finish.mockResolvedValue({ status: 200, saved: true, body: { success: true } })
})

describe('POST /api/conectar-whatsapp/<token>', () => {
  it("connects the link's own CRM, whatever the body says", async () => {
    const res = await call({ code: 'c', account_id: 'other' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, crm_name: 'Clínica Sol' })
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1', userId: 'u-1' }),
    )
    expect(release).not.toHaveBeenCalled()
  })

  it('a dead link connects nothing', async () => {
    find.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(410)
    expect(finish).not.toHaveBeenCalled()
  })

  it('a link another tab just used connects nothing', async () => {
    claim.mockResolvedValue(false)
    expect((await call()).status).toBe(410)
    expect(finish).not.toHaveBeenCalled()
  })

  it('gives the link back when the connection fails', async () => {
    finish.mockResolvedValue({ status: 400, saved: false, body: { error: 'expirou' } })
    const res = await call()
    expect(res.status).toBe(400)
    expect(release).toHaveBeenCalledWith(expect.anything(), 'link-1')
  })

  it('falls back to the owner when whoever made the link is gone', async () => {
    find.mockResolvedValue({ id: 'link-1', accountId: 'acc-1', createdBy: null, crmName: 'X' })
    await call()
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner-1' }))
  })
})
