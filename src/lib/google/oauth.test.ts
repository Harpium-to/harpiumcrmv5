import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  GoogleAuthError,
  googleOAuthConfig,
  missingScopes,
  readIdToken,
  refreshGoogleToken,
  SCOPE_CALENDAR_LIST,
  SCOPE_EVENTS,
} from './oauth'

const config = { clientId: 'cid', clientSecret: 'secret', redirectUri: 'https://harpium.com.br/google/retorno' }
const NOW = new Date('2030-01-07T10:00:00Z')

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function idToken(payload: Record<string, unknown>) {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${part({ alg: 'RS256' })}.${part(payload)}.sig`
}

describe('googleOAuthConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is null until the server has both credentials', () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'x')
    expect(googleOAuthConfig('https://crm.test')).toBeNull()
  })

  it('uses the configured return address, or this CRM’s own one', () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret')
    vi.stubEnv('GOOGLE_OAUTH_REDIRECT_URI', '')
    expect(googleOAuthConfig('http://localhost:3000')?.redirectUri).toBe(
      'http://localhost:3000/api/google/oauth/callback',
    )
    vi.stubEnv('GOOGLE_OAUTH_REDIRECT_URI', 'https://harpium.com.br/google/retorno')
    expect(googleOAuthConfig('http://localhost:3000')?.redirectUri).toBe(
      'https://harpium.com.br/google/retorno',
    )
  })
})

describe('buildGoogleAuthUrl', () => {
  it('asks for offline access, the agenda scopes and carries the state', () => {
    const url = new URL(buildGoogleAuthUrl(config, 'abc'))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toContain('consent')
    expect(url.searchParams.get('state')).toBe('abc')
    const scopes = url.searchParams.get('scope')?.split(' ')
    expect(scopes).toEqual(['openid', 'email', SCOPE_EVENTS, SCOPE_CALENDAR_LIST])
  })
})

describe('exchangeGoogleCode / refreshGoogleToken', () => {
  it('trades the code with the exact return address and reads the answer', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3599,
        scope: `openid ${SCOPE_EVENTS}`,
        id_token: 'x.y.z',
      }),
    )
    const tokens = await exchangeGoogleCode(config, 'the-code', fetchImpl as typeof fetch, NOW)
    expect(tokens).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: new Date(NOW.getTime() + 3599_000),
      scopes: ['openid', SCOPE_EVENTS],
      idToken: 'x.y.z',
    })
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const sent = new URLSearchParams(String(init.body))
    expect(sent.get('code')).toBe('the-code')
    expect(sent.get('redirect_uri')).toBe(config.redirectUri)
    expect(sent.get('grant_type')).toBe('authorization_code')
  })

  it('a refused refresh token is "revoked": only reconnecting fixes it', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, { error: 'invalid_grant' }))
    const error = await refreshGoogleToken(config, 'rt', fetchImpl as typeof fetch).catch((e) => e)
    expect(error).toBeInstanceOf(GoogleAuthError)
    expect(error.revoked).toBe(true)
  })

  it('anything else is not revoked, and a network failure neither', async () => {
    const busy = vi.fn(async () => jsonResponse(500, { error: 'backend_error' }))
    expect((await refreshGoogleToken(config, 'rt', busy as typeof fetch).catch((e) => e)).revoked).toBe(false)
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const error = await refreshGoogleToken(config, 'rt', down as typeof fetch).catch((e) => e)
    expect(error.code).toBe('network')
    expect(error.revoked).toBe(false)
  })
})

describe('missingScopes / readIdToken', () => {
  it('flags an unticked events permission', () => {
    expect(missingScopes(['openid', SCOPE_CALENDAR_LIST])).toEqual([SCOPE_EVENTS])
    expect(missingScopes(['openid', SCOPE_EVENTS])).toEqual([])
  })

  it('reads who signed in, and nothing from a broken token', () => {
    expect(readIdToken(idToken({ sub: '123', email: 'dr@clinica.com' }))).toEqual({
      sub: '123',
      email: 'dr@clinica.com',
    })
    expect(readIdToken(idToken({ sub: '123' }))).toBeNull()
    expect(readIdToken('garbage')).toBeNull()
    expect(readIdToken(null)).toBeNull()
  })
})
