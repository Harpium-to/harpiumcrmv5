import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(),
  toErrorResponse: (err: unknown) =>
    new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { send: { limit: 60, windowMs: 60_000 } },
}))
vi.mock('@/lib/whatsapp/admin-client', () => ({ supabaseAdmin: () => ({ admin: true }) }))
vi.mock('@/lib/whatsapp/connect', () => ({ saveWhatsAppConnection: vi.fn() }))
vi.mock('@/lib/whatsapp/embedded-signup', () => ({
  getEmbeddedSignupSettings: vi.fn(),
  exchangeCodeForBusinessToken: vi.fn(),
  discoverWabaAndPhone: vi.fn(),
  deriveRegistrationPin: (id: string) => `pin-for-${id}`,
}))

import { requireRole } from '@/lib/auth/account'
import { saveWhatsAppConnection } from '@/lib/whatsapp/connect'
import {
  discoverWabaAndPhone,
  exchangeCodeForBusinessToken,
  getEmbeddedSignupSettings,
} from '@/lib/whatsapp/embedded-signup'
import { GET, POST } from './route'

const requireRoleMock = vi.mocked(requireRole)
const saveMock = vi.mocked(saveWhatsAppConnection)
const settingsMock = vi.mocked(getEmbeddedSignupSettings)
const exchangeMock = vi.mocked(exchangeCodeForBusinessToken)
const discoverMock = vi.mocked(discoverWabaAndPhone)

const SETTINGS = { appId: 'APP', configId: 'CFG', graphVersion: 'v21.0' }

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/whatsapp/embedded-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  vi.stubEnv('META_APP_SECRET', 'SECRET')
  requireRoleMock.mockReset().mockResolvedValue({
    supabase: { rls: true },
    accountId: 'acct-1',
    userId: 'user-1',
    role: 'admin',
  } as never)
  settingsMock.mockReset().mockReturnValue(SETTINGS)
  exchangeMock.mockReset().mockResolvedValue('BIZ_TOKEN')
  discoverMock.mockReset()
  saveMock.mockReset().mockResolvedValue({
    ok: true,
    registered: true,
    registrationSkipped: false,
    registrationError: null,
    phoneInfo: { id: '111', display_phone_number: '+55 63 3333-0000', verified_name: 'Cliente' },
  })
})

describe('GET /api/whatsapp/embedded-signup', () => {
  it('returns the public settings and whether the caller can manage', async () => {
    requireRoleMock.mockResolvedValue({ role: 'agent' } as never)
    const res = await GET()
    expect(await res.json()).toEqual({
      enabled: true,
      app_id: 'APP',
      config_id: 'CFG',
      graph_version: 'v21.0',
      can_manage: false,
    })
  })

  it('says disabled when the server lacks the settings', async () => {
    settingsMock.mockReturnValue(null)
    const res = await GET()
    expect(await res.json()).toMatchObject({ enabled: false, app_id: null })
  })
})

describe('POST /api/whatsapp/embedded-signup', () => {
  it('requires an admin', async () => {
    await post({ code: 'C', waba_id: '22222', phone_number_id: '11111' })
    expect(requireRoleMock).toHaveBeenCalledWith('admin')
  })

  it('exchanges the code, then saves with the popup ids and the derived PIN', async () => {
    const res = await post({ code: 'C', waba_id: '22222', phone_number_id: '11111' })
    expect(res.status).toBe(200)
    expect(exchangeMock).toHaveBeenCalledWith({ code: 'C', appId: 'APP', appSecret: 'SECRET' })
    expect(discoverMock).not.toHaveBeenCalled()
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        userId: 'user-1',
        phoneNumberId: '11111',
        wabaId: '22222',
        accessToken: 'BIZ_TOKEN',
        pin: 'pin-for-11111',
      }),
    )
    expect(await res.json()).toMatchObject({ success: true, registered: true })
  })

  it('looks the ids up when the popup message never arrived', async () => {
    discoverMock.mockResolvedValue({ wabaId: '33333', phoneNumberId: '44444' })
    await post({ code: 'C' })
    expect(discoverMock).toHaveBeenCalledWith({ accessToken: 'BIZ_TOKEN', appId: 'APP', appSecret: 'SECRET' })
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumberId: '44444', wabaId: '33333', pin: 'pin-for-44444' }),
    )
  })

  it('ignores ids that are not Meta ids', async () => {
    discoverMock.mockResolvedValue({ wabaId: '33333', phoneNumberId: '44444' })
    await post({ code: 'C', waba_id: '../evil', phone_number_id: 'abc' })
    expect(discoverMock).toHaveBeenCalled()
  })

  it('refuses without a code', async () => {
    const res = await post({ waba_id: '22222' })
    expect(res.status).toBe(400)
    expect(exchangeMock).not.toHaveBeenCalled()
  })

  it('answers 503 when the server is not configured', async () => {
    settingsMock.mockReturnValue(null)
    const res = await post({ code: 'C' })
    expect(res.status).toBe(503)
    expect(exchangeMock).not.toHaveBeenCalled()
  })

  it('explains an expired or refused code', async () => {
    exchangeMock.mockRejectedValue(new Error('This authorization code has expired.'))
    const res = await post({ code: 'OLD', waba_id: '22222', phone_number_id: '11111' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/expirou ou foi recusada/)
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('passes a save refusal through with its status', async () => {
    saveMock.mockResolvedValue({ ok: false, status: 409, error: 'já está ligado a outra conta' })
    const res = await post({ code: 'C', waba_id: '22222', phone_number_id: '11111' })
    expect(res.status).toBe(409)
  })

  it('reports a registration problem without failing the request', async () => {
    saveMock.mockResolvedValue({
      ok: true,
      registered: false,
      registrationSkipped: false,
      registrationError: 'PIN mismatch',
      phoneInfo: { id: '111', display_phone_number: '+55' },
    })
    const res = await post({ code: 'C', waba_id: '22222', phone_number_id: '11111' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      success: false,
      registered: false,
      registration_error: 'PIN mismatch',
    })
  })
})
