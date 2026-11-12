// ============================================================
// Google sign-in for the Agenda (docs/plano-google-agenda.md, G1).
//
// One Google Cloud app ("Harpium CRM") serves every CRM, like the Meta
// app does: each professional authorises their own account and the
// CRM keeps the refresh token, encrypted. Plain fetch against Google's
// OAuth endpoints — the `googleapis` package would be most of a
// megabyte for four calls.
//
// The return address is fixed in the Google console. In production it
// is https://harpium.com.br/google/retorno, which forwards (query and
// all) to this CRM's /api/google/oauth/callback: Google only accepts a
// return address on a domain we verified, and *.netlify.app is not
// ours. GOOGLE_OAUTH_REDIRECT_URI says which one is in use; the token
// exchange must send exactly the same string.
// ============================================================

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

/** Create, move and delete events on the calendars the account owns. */
export const SCOPE_EVENTS = 'https://www.googleapis.com/auth/calendar.events.owned'
/** List the account's calendars, to pick where events go. */
export const SCOPE_CALENDAR_LIST = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'
export const SCOPE_EMAIL = 'https://www.googleapis.com/auth/userinfo.email'

/** Asked for, in this order. `openid email` names the account. */
export const GOOGLE_SCOPES = ['openid', 'email', SCOPE_EVENTS, SCOPE_CALENDAR_LIST] as const

/** Without these the connection is useless, so it is refused. */
export const REQUIRED_SCOPES = [SCOPE_EVENTS] as const

const TIMEOUT_MS = 10_000

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

/**
 * The app's credentials, or null when the server is not set up for
 * Google yet. `origin` is this CRM's own address, the fallback return
 * address for local development.
 */
export function googleOAuthConfig(origin: string): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || `${origin}/api/google/oauth/callback`
  return { clientId, clientSecret, redirectUri }
}

/** Where to send the person to sign in and allow the agenda. */
export function buildGoogleAuthUrl(config: GoogleOAuthConfig, state: string): string {
  const url = new URL(AUTH_URL)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '))
  // A refresh token, every time: the CRM works while nobody is signed in.
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent select_account')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', state)
  return url.toString()
}

/** Google's token answer, the parts the CRM uses. */
export interface GoogleTokens {
  accessToken: string
  /** Absent when refreshing; always present on the first exchange with prompt=consent. */
  refreshToken: string | null
  expiresAt: Date
  scopes: string[]
  idToken: string | null
}

/**
 * Something Google said no to. `revoked` is the one that matters: the
 * refresh token no longer works (password changed, access removed in
 * the Google account), and only reconnecting fixes it.
 */
export class GoogleAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly revoked: boolean,
  ) {
    super(message)
    this.name = 'GoogleAuthError'
  }
}

type FetchLike = typeof fetch

function parseTokens(body: Record<string, unknown>, now: Date): GoogleTokens {
  const accessToken = typeof body.access_token === 'string' ? body.access_token : ''
  if (!accessToken) throw new GoogleAuthError('O Google não devolveu o acesso.', 'no_token', false)
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600
  return {
    accessToken,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    expiresAt: new Date(now.getTime() + expiresIn * 1000),
    scopes: typeof body.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean) : [],
    idToken: typeof body.id_token === 'string' ? body.id_token : null,
  }
}

async function postToken(
  params: Record<string, string>,
  fetchImpl: FetchLike,
  now: Date,
): Promise<GoogleTokens> {
  let response: Response
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new GoogleAuthError('Não consegui falar com o Google.', 'network', false)
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const code = typeof body.error === 'string' ? body.error : `http_${response.status}`
    // invalid_grant on a refresh: the token was revoked or expired for good.
    const revoked = code === 'invalid_grant'
    throw new GoogleAuthError(
      revoked
        ? 'O Google recusou o acesso: a conta precisa ser conectada de novo.'
        : 'O Google recusou o pedido de acesso.',
      code,
      revoked,
    )
  }
  return parseTokens(body, now)
}

/** Trade the code from the return address for tokens. */
export function exchangeGoogleCode(
  config: GoogleOAuthConfig,
  code: string,
  fetchImpl: FetchLike = fetch,
  now: Date = new Date(),
): Promise<GoogleTokens> {
  return postToken(
    {
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    },
    fetchImpl,
    now,
  )
}

/** A fresh access token from the stored refresh token. */
export function refreshGoogleToken(
  config: Pick<GoogleOAuthConfig, 'clientId' | 'clientSecret'>,
  refreshToken: string,
  fetchImpl: FetchLike = fetch,
  now: Date = new Date(),
): Promise<GoogleTokens> {
  return postToken(
    {
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
    },
    fetchImpl,
    now,
  )
}

/**
 * Tell Google to forget the CRM's access. Best effort: the token may
 * already be dead, which is the same outcome.
 */
export async function revokeGoogleToken(token: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return response.ok || response.status === 400
  } catch {
    return false
  }
}

/** Required scopes the person did not allow (Google lets them untick). */
export function missingScopes(granted: readonly string[]): string[] {
  const have = new Set(granted)
  return REQUIRED_SCOPES.filter((scope) => !have.has(scope))
}

export interface GoogleIdentity {
  /** Google's stable account id. */
  sub: string
  email: string
}

/**
 * Who signed in, read from the id_token. It came straight from Google's
 * token endpoint over TLS, so its signature need not be checked again
 * (OpenID Connect Core 3.1.3.7).
 */
export function readIdToken(idToken: string | null): GoogleIdentity | null {
  if (!idToken) return null
  const payload = idToken.split('.')[1]
  if (!payload) return null
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    const sub = typeof json.sub === 'string' ? json.sub : ''
    const email = typeof json.email === 'string' ? json.email : ''
    return sub && email ? { sub, email } : null
  } catch {
    return null
  }
}
