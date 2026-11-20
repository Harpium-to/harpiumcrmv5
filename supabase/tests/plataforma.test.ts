// ============================================================
// Migration 075 — the platform API's view of who may see what.
//
// platform_effective_role(user, account) must answer exactly what
// effective_role_in(account) answers inside that user's session, for
// every person × CRM × consent level: it is the rule the Agency OS
// reads the CRM through, and a drift would open (or close) client data.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'

import { applyMigration, asUser, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

const M075 = '075_integracao_agency_os.sql'

async function setLevel(w: World, accountId: string, level: string) {
  await sql(
    w.db,
    `INSERT INTO account_agency_access (account_id, level) VALUES ($1, $2)
     ON CONFLICT (account_id) DO UPDATE SET level = EXCLUDED.level,
       temp_level = NULL, temp_until = NULL`,
    [accountId, level],
  )
}

describe('075 — platform_effective_role mirrors effective_role_in', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
    // Mel (manager) runs A's portfolio, not D's.
    await sql(w.db, 'UPDATE accounts SET manager_user_id = $1 WHERE id = $2', [U.mel, w.A])
  })

  for (const level of ['metrics', 'read', 'full']) {
    it(`agrees for every person and CRM at level ${level}`, async () => {
      const accounts = (await sql<{ id: string }>(w.db, 'SELECT id FROM accounts ORDER BY id')).map(
        (r) => r.id,
      )
      expect(accounts.length).toBeGreaterThanOrEqual(2)
      for (const a of accounts) await setLevel(w, a, level)

      for (const [name, user] of Object.entries(U)) {
        for (const a of accounts) {
          const [{ role: platform }] = await sql<{ role: string | null }>(
            w.db,
            'SELECT platform_effective_role($1, $2)::text AS role',
            [user, a],
          )
          const [{ role: session }] = await asUser<{ role: string | null }>(
            w.db,
            user,
            'SELECT effective_role_in($1)::text AS role',
            [a],
          )
          expect({ name, a, role: platform }).toEqual({ name, a, role: session })
        }
      }
    })
  }

  it('the agency super_admin sees a full CRM as admin, a read one as viewer', async () => {
    await setLevel(w, w.D, 'full')
    const full = await sql<{ role: string }>(
      w.db,
      'SELECT platform_effective_role($1, $2)::text AS role',
      [U.agus, w.D],
    )
    expect(full[0].role).toBe('admin')
    await setLevel(w, w.D, 'read')
    const read = await sql<{ role: string }>(
      w.db,
      'SELECT platform_effective_role($1, $2)::text AS role',
      [U.agus, w.D],
    )
    expect(read[0].role).toBe('viewer')
  })

  it('nobody, or no CRM, gives null', async () => {
    const rows = await sql<{ a: string | null; b: string | null; c: string | null }>(
      w.db,
      `SELECT platform_effective_role($1, $2)::text AS a,
              platform_effective_role(NULL, $2)::text AS b,
              platform_effective_role($1, NULL)::text AS c`,
      [U.otto, w.A],
    )
    expect(rows[0]).toEqual({ a: null, b: null, c: null })
  })
})

describe('075 — e-mail lookup, keys and audit columns', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  it('runs twice without error', async () => {
    await applyMigration(w.db, M075)
    await applyMigration(w.db, M075)
  })

  it('finds a person by e-mail, ignoring case and spaces', async () => {
    const rows = await sql<{ id: string | null; none: string | null }>(
      w.db,
      `SELECT platform_user_id_by_email('  ALICE@Teste.dev ') AS id,
              platform_user_id_by_email('ninguem@teste.dev') AS none`,
    )
    expect(rows[0]).toEqual({ id: U.alice, none: null })
  })

  it('a pattern is not a wildcard', async () => {
    const rows = await sql<{ id: string | null }>(
      w.db,
      `SELECT platform_user_id_by_email('%@teste.dev') AS id`,
    )
    expect(rows[0].id).toBeNull()
  })

  it('signed-in users cannot call the platform functions nor read the keys', async () => {
    expect(
      await errorCode(
        asUser(w.db, U.agus, `SELECT platform_user_id_by_email('alice@teste.dev')`),
      ),
    ).toBe('42501')
    expect(
      await errorCode(
        asUser(w.db, U.agus, 'SELECT platform_effective_role($1, $2)', [U.agus, w.A]),
      ),
    ).toBe('42501')
    await sql(
      w.db,
      `INSERT INTO platform_api_keys (name, key_prefix, key_hash, scopes)
       VALUES ('Agency OS', 'hpk_live_abc', 'hash-1', '{crms:read}')`,
    )
    expect(await errorCode(asUser(w.db, U.agus, 'SELECT * FROM platform_api_keys'))).toBe(
      '42501',
    )
  })

  it('the audit log records where an access came from', async () => {
    await sql(
      w.db,
      `INSERT INTO agencia_auditoria (actor_user_id, account_id, action, origem, detalhe)
       VALUES ($1, $2, 'api_view_summary', 'agency_os', '30 dias')`,
      [U.agus, w.A],
    )
    const rows = await sql<{ origem: string; detalhe: string }>(
      w.db,
      `SELECT origem, detalhe FROM agencia_auditoria WHERE action = 'api_view_summary'`,
    )
    expect(rows).toEqual([{ origem: 'agency_os', detalhe: '30 dias' }])
    const old = await sql<{ origem: string }>(
      w.db,
      `INSERT INTO agencia_auditoria (actor_user_id, account_id, action)
       VALUES ($1, $2, 'view_account') RETURNING origem`,
      [U.agus, w.A],
    )
    expect(old[0].origem).toBe('crm')
    expect(
      await errorCode(
        sql(
          w.db,
          `INSERT INTO agencia_auditoria (actor_user_id, action, origem)
           VALUES ($1, 'x', 'outro')`,
          [U.agus],
        ),
      ),
    ).toBe('23514')
  })
})
