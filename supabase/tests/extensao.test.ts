// ============================================================
// Migration 054 — personal keys for the Chrome extension.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'

import { asUser, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

const create = (db: PGlite, user: string, n: number) =>
  asUser<{ id: string }>(
    db,
    user,
    'SELECT create_extension_key($1, $2) AS id',
    [`hash-${user}-${n}`, `wacrm_live_${n}`],
  ).then((r) => r[0].id)

const activeKeys = (db: PGlite, user: string) =>
  sql<{ id: string; scopes: string[]; kind: string; name: string }>(
    db,
    `SELECT id, scopes, kind, name FROM api_keys
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [user],
  )

describe('054 — extension keys', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  it('an agent mints their own key, with exactly the extension’s scopes', async () => {
    await create(w.db, U.bob, 1)
    const keys = await activeKeys(w.db, U.bob)
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatchObject({
      kind: 'extension',
      scopes: ['contacts:read', 'contacts:write', 'deals:read', 'deals:write'],
      name: 'Extensão do Chrome · Bob',
    })
  })

  it('a new key replaces the old one', async () => {
    const second = await create(w.db, U.bob, 2)
    const keys = await activeKeys(w.db, U.bob)
    expect(keys.map((k) => k.id)).toEqual([second])
  })

  it('reports and revokes its own key', async () => {
    const [{ k }] = await asUser<{ k: Record<string, unknown> }>(
      w.db,
      U.bob,
      'SELECT my_extension_key() AS k',
    )
    expect(k).toMatchObject({ prefix: 'wacrm_live_2', last_used_at: null })
    await asUser(w.db, U.bob, 'SELECT revoke_my_extension_key()')
    expect(await activeKeys(w.db, U.bob)).toEqual([])
    const [{ k: none }] = await asUser<{ k: unknown }>(w.db, U.bob, 'SELECT my_extension_key() AS k')
    expect(none).toBeNull()
  })

  it('a viewer cannot have one, and neither can the agency inside a client CRM', async () => {
    expect(await errorCode(create(w.db, U.carol, 1))).toBe('42501')
    await asUser(w.db, U.dave, `SELECT set_agency_access('full')`)
    await asUser(w.db, U.agus, 'SELECT set_active_account($1)', [w.D])
    expect(await errorCode(create(w.db, U.agus, 1))).toBe('42501')
  })

  it('becoming a viewer revokes it', async () => {
    await create(w.db, U.bob, 3)
    await asUser(w.db, U.alice, `SELECT set_member_role($1, 'viewer')`, [U.bob])
    expect(await activeKeys(w.db, U.bob)).toEqual([])
    await asUser(w.db, U.alice, `SELECT set_member_role($1, 'agent')`, [U.bob])
  })

  it('leaving the CRM revokes it — only in that CRM', async () => {
    // Mia is an agent in A (and a viewer in D).
    await asUser(w.db, U.mia, 'SELECT set_active_account($1)', [w.A])
    await create(w.db, U.mia, 1)
    await asUser(w.db, U.alice, 'SELECT remove_account_member($1)', [U.mia])
    expect(await activeKeys(w.db, U.mia)).toEqual([])
  })

  it('leaves the CRM’s regular API keys alone', async () => {
    await sql(
      w.db,
      `INSERT INTO api_keys (account_id, created_by, name, key_prefix, key_hash, scopes)
       VALUES ($1, $2, 'Integração', 'wacrm_live_int', 'hash-int', ARRAY['contacts:read'])`,
      [w.A, U.alice],
    )
    await create(w.db, U.bob, 4)
    await asUser(w.db, U.alice, 'SELECT remove_account_member($1)', [U.bob])
    const [row] = await sql<{ revoked_at: string | null; kind: string }>(
      w.db,
      `SELECT revoked_at, kind FROM api_keys WHERE key_hash = 'hash-int'`,
    )
    expect(row).toEqual({ revoked_at: null, kind: 'api' })
  })
})
