import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deriveRegistrationPin,
  discoverWabaAndPhone,
  exchangeCodeForBusinessToken,
  getEmbeddedSignupSettings,
} from './embedded-signup'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('getEmbeddedSignupSettings', () => {
  it('returns the public settings when app id, config id and secret are set', () => {
    expect(
      getEmbeddedSignupSettings({
        META_APP_ID: ' 123 ',
        META_EMBEDDED_SIGNUP_CONFIG_ID: '456',
        META_APP_SECRET: 'shh',
      }),
    ).toEqual({ appId: '123', configId: '456', graphVersion: 'v21.0' })
  })

  it('never exposes the app secret', () => {
    const settings = getEmbeddedSignupSettings({
      META_APP_ID: '123',
      META_EMBEDDED_SIGNUP_CONFIG_ID: '456',
      META_APP_SECRET: 'shh',
    })
    expect(JSON.stringify(settings)).not.toContain('shh')
  })

  it.each([
    [{ META_EMBEDDED_SIGNUP_CONFIG_ID: '456', META_APP_SECRET: 's' }],
    [{ META_APP_ID: '123', META_APP_SECRET: 's' }],
    [{ META_APP_ID: '123', META_EMBEDDED_SIGNUP_CONFIG_ID: '456' }],
    [{ META_APP_ID: '123', META_EMBEDDED_SIGNUP_CONFIG_ID: '  ', META_APP_SECRET: 's' }],
  ])('is off when a piece is missing (%o)', (env) => {
    expect(getEmbeddedSignupSettings(env)).toBeNull()
  })
})

describe('exchangeCodeForBusinessToken', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('GETs oauth/access_token with client id, secret and code — no redirect_uri', async () => {
    fetchMock.mockResolvedValue(json({ access_token: 'BIZ_TOKEN', token_type: 'bearer' }))
    const token = await exchangeCodeForBusinessToken({
      code: 'CODE',
      appId: 'APP',
      appSecret: 'SECRET',
    })
    expect(token).toBe('BIZ_TOKEN')
    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.pathname).toBe('/v21.0/oauth/access_token')
    expect(url.searchParams.get('client_id')).toBe('APP')
    expect(url.searchParams.get('client_secret')).toBe('SECRET')
    expect(url.searchParams.get('code')).toBe('CODE')
    expect(url.searchParams.has('redirect_uri')).toBe(false)
  })

  it("surfaces Meta's error message", async () => {
    fetchMock.mockResolvedValue(
      json({ error: { message: 'This authorization code has expired.' } }, 400),
    )
    await expect(
      exchangeCodeForBusinessToken({ code: 'OLD', appId: 'APP', appSecret: 'S' }),
    ).rejects.toThrow('This authorization code has expired.')
  })

  it('fails loudly when Meta answers 200 without a token', async () => {
    fetchMock.mockResolvedValue(json({}))
    await expect(
      exchangeCodeForBusinessToken({ code: 'C', appId: 'APP', appSecret: 'S' }),
    ).rejects.toThrow(/não devolveu/)
  })
})

describe('discoverWabaAndPhone', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('reads the WABA from the token scopes, then its first number', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          data: {
            granular_scopes: [
              { scope: 'business_management', target_ids: ['BIZ'] },
              { scope: 'whatsapp_business_management', target_ids: ['WABA_1'] },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(json({ data: [{ id: 'PHONE_1', display_phone_number: '+55 63' }] }))

    const found = await discoverWabaAndPhone({
      accessToken: 'BIZ_TOKEN',
      appId: 'APP',
      appSecret: 'SECRET',
    })
    expect(found).toEqual({ wabaId: 'WABA_1', phoneNumberId: 'PHONE_1' })

    const [debugUrl, debugInit] = fetchMock.mock.calls[0]
    expect(debugUrl).toContain('/debug_token?input_token=BIZ_TOKEN')
    // The app token rides in the header, never in the URL.
    expect(debugUrl).not.toContain('SECRET')
    expect(debugInit.headers.Authorization).toBe('Bearer APP|SECRET')

    const [phonesUrl, phonesInit] = fetchMock.mock.calls[1]
    expect(phonesUrl).toContain('/WABA_1/phone_numbers')
    expect(phonesInit.headers.Authorization).toBe('Bearer BIZ_TOKEN')
  })

  it('falls back to the messaging scope', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ data: { granular_scopes: [{ scope: 'whatsapp_business_messaging', target_ids: ['WABA_2'] }] } }),
      )
      .mockResolvedValueOnce(json({ data: [{ id: 'PHONE_2' }] }))
    const found = await discoverWabaAndPhone({ accessToken: 'T', appId: 'A', appSecret: 'S' })
    expect(found.wabaId).toBe('WABA_2')
  })

  it('explains when no WhatsApp account was granted', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: { granular_scopes: [] } }))
    await expect(
      discoverWabaAndPhone({ accessToken: 'T', appId: 'A', appSecret: 'S' }),
    ).rejects.toThrow(/conta do WhatsApp autorizada/)
  })

  it('explains when the account has no number', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ data: { granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['W'] }] } }),
      )
      .mockResolvedValueOnce(json({ data: [] }))
    await expect(
      discoverWabaAndPhone({ accessToken: 'T', appId: 'A', appSecret: 'S' }),
    ).rejects.toThrow(/não tem número/)
  })
})

describe('deriveRegistrationPin', () => {
  const KEY = 'a'.repeat(64)

  it('is always six digits', () => {
    for (const id of ['1', '419046891292994', '999999999999999', 'x']) {
      expect(deriveRegistrationPin(id, KEY)).toMatch(/^\d{6}$/)
    }
  })

  it('is stable for the same number and key, so it can be recomputed', () => {
    expect(deriveRegistrationPin('123', KEY)).toBe(deriveRegistrationPin('123', KEY))
  })

  it('differs across numbers and across keys', () => {
    expect(deriveRegistrationPin('123', KEY)).not.toBe(deriveRegistrationPin('124', KEY))
    expect(deriveRegistrationPin('123', KEY)).not.toBe(deriveRegistrationPin('123', 'b'.repeat(64)))
  })

  it('refuses to run without a key', () => {
    expect(() => deriveRegistrationPin('123', '')).toThrow(/ENCRYPTION_KEY/)
  })
})
