// ============================================================
// The Google accounts connected to a CRM (migration 069): saving one
// after the sign-in, and handing out a working access token.
//
// Server only — it reads google_connection_secrets, which no policy
// opens, so the client passed in is always the service role.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt, encrypt } from '@/lib/whatsapp/encryption'

import {
  GoogleAuthError,
  refreshGoogleToken,
  type GoogleIdentity,
  type GoogleOAuthConfig,
  type GoogleTokens,
} from './oauth'

/** A token this close to expiring is refreshed before use. */
const REFRESH_MARGIN_MS = 60_000

export interface TokenDeps {
  refresh: typeof refreshGoogleToken
  encrypt: (text: string) => string
  decrypt: (text: string) => string
  now: () => Date
}

const defaultDeps: TokenDeps = {
  refresh: refreshGoogleToken,
  encrypt,
  decrypt,
  now: () => new Date(),
}

/**
 * Store (or refresh) the account that just signed in. Connecting the
 * same Google account again updates its row, so agendas already
 * pointing at it keep working and a dropped connection comes back.
 */
export async function saveGoogleConnection(
  db: SupabaseClient,
  input: {
    accountId: string
    userId: string | null
    identity: GoogleIdentity
    tokens: GoogleTokens
  },
  deps: Pick<TokenDeps, 'encrypt'> = defaultDeps,
): Promise<string | null> {
  if (!input.tokens.refreshToken) return null
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('google_connections')
    .upsert(
      {
        account_id: input.accountId,
        google_sub: input.identity.sub,
        email: input.identity.email,
        scopes: input.tokens.scopes,
        status: 'connected',
        last_error: null,
        connected_by: input.userId,
        updated_at: now,
      },
      { onConflict: 'account_id,google_sub' },
    )
    .select('id')
    .single()
  if (error || !data) {
    console.error('[google] save connection failed:', error)
    return null
  }
  const connectionId = (data as { id: string }).id
  const { error: secretError } = await db.from('google_connection_secrets').upsert(
    {
      connection_id: connectionId,
      refresh_token: deps.encrypt(input.tokens.refreshToken),
      access_token: deps.encrypt(input.tokens.accessToken),
      access_token_expires_at: input.tokens.expiresAt.toISOString(),
      updated_at: now,
    },
    { onConflict: 'connection_id' },
  )
  if (secretError) {
    console.error('[google] save secret failed:', secretError)
    return null
  }
  return connectionId
}

/**
 * Mark a connection as needing the person to sign in again. Everything
 * that would have gone to Google waits; nothing in the CRM is lost.
 */
export async function markNeedsReconnect(
  db: SupabaseClient,
  connectionId: string,
  reason: string,
): Promise<void> {
  await db
    .from('google_connections')
    .update({ status: 'needs_reconnect', last_error: reason.slice(0, 500), updated_at: new Date().toISOString() })
    .eq('id', connectionId)
}

/**
 * A working access token for the connection: the stored one while it
 * is fresh, a refreshed one otherwise (and stored for the next call).
 *
 * Throws GoogleAuthError. A revoked refresh token also marks the
 * connection 'needs_reconnect', so the screen can say so.
 */
export async function getGoogleAccessToken(
  db: SupabaseClient,
  connectionId: string,
  config: Pick<GoogleOAuthConfig, 'clientId' | 'clientSecret'>,
  deps: TokenDeps = defaultDeps,
): Promise<string> {
  const { data, error } = await db
    .from('google_connection_secrets')
    .select('refresh_token, access_token, access_token_expires_at')
    .eq('connection_id', connectionId)
    .maybeSingle()
  if (error) throw new GoogleAuthError('Não consegui ler a conexão com o Google.', 'db', false)
  const row = data as {
    refresh_token: string
    access_token: string | null
    access_token_expires_at: string | null
  } | null
  if (!row) {
    throw new GoogleAuthError('A conta Google não está mais conectada.', 'missing', true)
  }

  const now = deps.now()
  const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at) : null
  if (row.access_token && expiresAt && expiresAt.getTime() - now.getTime() > REFRESH_MARGIN_MS) {
    try {
      return deps.decrypt(row.access_token)
    } catch {
      // Unreadable (key rotated?): fall through and get a new one.
    }
  }

  let refreshToken: string
  try {
    refreshToken = deps.decrypt(row.refresh_token)
  } catch {
    await markNeedsReconnect(db, connectionId, 'Não consegui ler a autorização guardada. Conecte de novo.')
    throw new GoogleAuthError('Autorização ilegível.', 'decrypt', true)
  }

  let tokens: GoogleTokens
  try {
    tokens = await deps.refresh(config, refreshToken, undefined, now)
  } catch (err) {
    if (err instanceof GoogleAuthError && err.revoked) {
      await markNeedsReconnect(
        db,
        connectionId,
        'O Google recusou o acesso (senha trocada ou acesso removido). Conecte a conta de novo.',
      )
    }
    throw err
  }

  await db
    .from('google_connection_secrets')
    .update({
      access_token: deps.encrypt(tokens.accessToken),
      access_token_expires_at: tokens.expiresAt.toISOString(),
      // Google may rotate the refresh token; keep the newest.
      ...(tokens.refreshToken ? { refresh_token: deps.encrypt(tokens.refreshToken) } : {}),
      updated_at: now.toISOString(),
    })
    .eq('connection_id', connectionId)
  return tokens.accessToken
}

/** The refresh token in clear, to revoke it on disconnect; null if unreadable. */
export async function readRefreshToken(
  db: SupabaseClient,
  connectionId: string,
  deps: Pick<TokenDeps, 'decrypt'> = defaultDeps,
): Promise<string | null> {
  const { data } = await db
    .from('google_connection_secrets')
    .select('refresh_token')
    .eq('connection_id', connectionId)
    .maybeSingle()
  const encrypted = (data as { refresh_token?: string } | null)?.refresh_token
  if (!encrypted) return null
  try {
    return deps.decrypt(encrypted)
  } catch {
    return null
  }
}
