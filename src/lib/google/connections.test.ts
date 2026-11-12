import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { getGoogleAccessToken, type TokenDeps } from './connections'
import { GoogleAuthError } from './oauth'

const NOW = new Date('2030-01-07T10:00:00Z')
const config = { clientId: 'cid', clientSecret: 'secret' }

/** The two tables getGoogleAccessToken touches, in memory. */
function fakeDb(secret: Record<string, unknown> | null) {
  const secretUpdates: Record<string, unknown>[] = []
  const connectionUpdates: Record<string, unknown>[] = []
  const from = (table: string) => {
    let values: Record<string, unknown> = {}
    const chain = {
      select: () => chain,
      update: (v: Record<string, unknown>) => {
        values = v
        return chain
      },
      eq: () => {
        if (table === 'google_connection_secrets' && Object.keys(values).length) secretUpdates.push(values)
        if (table === 'google_connections') connectionUpdates.push(values)
        return Object.assign(Promise.resolve({ error: null }), chain)
      },
      maybeSingle: () => Promise.resolve({ data: secret, error: null }),
    }
    return chain
  }
  return { db: { from } as unknown as SupabaseClient, secretUpdates, connectionUpdates }
}

function deps(patch: Partial<TokenDeps> = {}): TokenDeps {
  return {
    refresh: vi.fn(async () => ({
      accessToken: 'new-access',
      refreshToken: null,
      expiresAt: new Date(NOW.getTime() + 3600_000),
      scopes: [],
      idToken: null,
    })),
    encrypt: (t) => `enc(${t})`,
    decrypt: (t) => t.replace(/^enc\((.*)\)$/, '$1'),
    now: () => NOW,
    ...patch,
  }
}

describe('getGoogleAccessToken', () => {
  it('uses the stored token while it is fresh', async () => {
    const world = fakeDb({
      refresh_token: 'enc(rt)',
      access_token: 'enc(stored)',
      access_token_expires_at: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
    })
    const d = deps()
    expect(await getGoogleAccessToken(world.db, 'conn', config, d)).toBe('stored')
    expect(d.refresh).not.toHaveBeenCalled()
  })

  it('refreshes one about to expire, and keeps the new one (encrypted)', async () => {
    const world = fakeDb({
      refresh_token: 'enc(rt)',
      access_token: 'enc(stored)',
      access_token_expires_at: new Date(NOW.getTime() + 30_000).toISOString(),
    })
    const d = deps()
    expect(await getGoogleAccessToken(world.db, 'conn', config, d)).toBe('new-access')
    expect(d.refresh).toHaveBeenCalledWith(config, 'rt', undefined, NOW)
    expect(world.secretUpdates[0]).toMatchObject({ access_token: 'enc(new-access)' })
    expect(world.secretUpdates[0]).not.toHaveProperty('refresh_token')
  })

  it('a revoked access marks the account "needs_reconnect" and says so', async () => {
    const world = fakeDb({ refresh_token: 'enc(rt)', access_token: null, access_token_expires_at: null })
    const d = deps({
      refresh: vi.fn(async () => {
        throw new GoogleAuthError('no', 'invalid_grant', true)
      }),
    })
    const error = await getGoogleAccessToken(world.db, 'conn', config, d).catch((e) => e)
    expect(error.revoked).toBe(true)
    expect(world.connectionUpdates[0]).toMatchObject({ status: 'needs_reconnect' })
  })

  it('Google merely busy: nothing is marked, the caller retries', async () => {
    const world = fakeDb({ refresh_token: 'enc(rt)', access_token: null, access_token_expires_at: null })
    const d = deps({
      refresh: vi.fn(async () => {
        throw new GoogleAuthError('busy', 'http_503', false)
      }),
    })
    await expect(getGoogleAccessToken(world.db, 'conn', config, d)).rejects.toBeInstanceOf(GoogleAuthError)
    expect(world.connectionUpdates).toEqual([])
  })

  it('a connection removed meanwhile counts as revoked', async () => {
    const error = await getGoogleAccessToken(fakeDb(null).db, 'conn', config, deps()).catch((e) => e)
    expect(error.revoked).toBe(true)
  })
})
