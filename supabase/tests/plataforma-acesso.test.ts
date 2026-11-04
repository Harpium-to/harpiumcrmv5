// ============================================================
// Migration 049 — platform access foundation.
//
// Every world is built the way production will see it: migrations
// 001–048, users and a shared CRM created under the OLD model, then
// 049 applied twice (idempotency), then new signups under the new
// model. Each describe gets its own world so scenarios can't leak
// state into each other.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'

import {
  activeAccountOf,
  applyMigration,
  applyMigrationsBefore,
  asUser,
  createDb,
  errorCode,
  inviteAndRedeem,
  signUp,
  sql,
} from './harness'

const M049 = '049_plataforma_acesso.sql'

const U = {
  alice: '00000000-0000-4000-8000-0000000000a1', // owner of A
  bob: '00000000-0000-4000-8000-0000000000b2', // agent in A
  carol: '00000000-0000-4000-8000-0000000000c3', // viewer in A
  dave: '00000000-0000-4000-8000-0000000000d4', // owner of D
  agus: '00000000-0000-4000-8000-0000000000a5', // agency super_admin (pre-049)
  eve: '00000000-0000-4000-8000-0000000000e6', // signs up between the two 049 runs
  sara: '00000000-0000-4000-8000-0000000000f7', // agency support
  mel: '00000000-0000-4000-8000-000000000108', // agency manager
  mia: '00000000-0000-4000-8000-000000000119', // member of A and D
  otto: '00000000-0000-4000-8000-00000000012a', // outsider
}

interface World {
  db: PGlite
  A: string
  D: string
  E: string
  miaPersonal: string
}

async function buildWorld(): Promise<World> {
  const db = await createDb()
  await applyMigrationsBefore(db, M049)

  // ---- old model (pre-049) ----
  for (const [name, id] of [
    ['Alice', U.alice],
    ['Bob', U.bob],
    ['Carol', U.carol],
    ['Dave', U.dave],
    ['Agus', U.agus],
  ] as const) {
    await signUp(db, id, name)
  }
  const A = (await activeAccountOf(db, U.alice))!
  const D = (await activeAccountOf(db, U.dave))!
  await inviteAndRedeem(db, A, U.bob, 'agent')
  await inviteAndRedeem(db, A, U.carol, 'viewer')
  await sql(
    db,
    `INSERT INTO contacts (user_id, account_id, phone, name) VALUES
       ($1, $2, '5511900000001', 'Ana'),
       ($3, $4, '5511900000002', 'Duda')`,
    [U.alice, A, U.dave, D],
  )
  await sql(db, `INSERT INTO agencia_membros (user_id, label) VALUES ($1, 'Agus')`, [
    U.agus,
  ])

  // ---- 049, twice, with a signup in between ----
  await applyMigration(db, M049)
  await signUp(db, U.eve, 'Eve')
  const E = (await activeAccountOf(db, U.eve))!
  await applyMigration(db, M049)

  // ---- new model ----
  for (const [name, id] of [
    ['Sara', U.sara],
    ['Mel', U.mel],
    ['Mia', U.mia],
    ['Otto', U.otto],
  ] as const) {
    await signUp(db, id, name)
  }
  await sql(
    db,
    `INSERT INTO agencia_membros (user_id, label, role) VALUES
       ($1, 'Sara', 'support'), ($2, 'Mel', 'manager')`,
    [U.sara, U.mel],
  )
  const miaPersonal = (await activeAccountOf(db, U.mia))!
  await inviteAndRedeem(db, A, U.mia, 'agent')
  await inviteAndRedeem(db, D, U.mia, 'viewer')

  return { db, A, D, E, miaPersonal }
}

async function contactNames(db: PGlite, userId: string): Promise<string[]> {
  const rows = await asUser<{ name: string }>(
    db,
    userId,
    'SELECT name FROM contacts ORDER BY name',
  )
  return rows.map((r) => r.name)
}

function insertContact(db: PGlite, userId: string, accountId: string, phone: string) {
  return asUser(
    db,
    userId,
    `INSERT INTO contacts (user_id, account_id, phone, name)
     VALUES (auth.uid(), $1, $2, 'Novo')`,
    [accountId, phone],
  )
}

async function context(db: PGlite, userId: string) {
  const rows = await asUser<{ ctx: Record<string, unknown> | null }>(
    db,
    userId,
    'SELECT current_account_context() AS ctx',
  )
  return rows[0].ctx
}

// ------------------------------------------------------------

describe('049 — backfill from the old model', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  it('copies every pre-049 membership into account_members', async () => {
    const rows = await sql<{ user_id: string; account_id: string; role: string }>(
      w.db,
      `SELECT user_id, account_id, role FROM account_members
       WHERE user_id = ANY($1) ORDER BY role, user_id`,
      [[U.alice, U.bob, U.carol, U.dave]],
    )
    expect(rows).toEqual([
      { user_id: U.alice, account_id: w.A, role: 'owner' },
      { user_id: U.dave, account_id: w.D, role: 'owner' },
      { user_id: U.bob, account_id: w.A, role: 'agent' },
      { user_id: U.carol, account_id: w.A, role: 'viewer' },
    ])
  })

  it('keeps every member able to see their CRM exactly as before', async () => {
    expect(await contactNames(w.db, U.alice)).toEqual(['Ana'])
    expect(await contactNames(w.db, U.bob)).toEqual(['Ana'])
    expect(await contactNames(w.db, U.carol)).toEqual(['Ana'])
    expect(await contactNames(w.db, U.dave)).toEqual(['Duda'])
  })

  it('grants read to CRMs that existed before 049, and only to those', async () => {
    const rows = await sql<{ account_id: string; level: string }>(
      w.db,
      'SELECT account_id, level FROM account_agency_access',
    )
    const byAccount = Object.fromEntries(rows.map((r) => [r.account_id, r.level]))
    expect(byAccount[w.A]).toBe('read')
    expect(byAccount[w.D]).toBe('read')
    // Eve signed up between the two runs: re-running must not grant.
    expect(byAccount[w.E]).toBeUndefined()
    expect(
      (await sql<{ l: string }>(w.db, 'SELECT agency_access_level($1) AS l', [w.E]))[0].l,
    ).toBe('metrics')
  })

  it('makes existing agency members super_admin and new ones support by default', async () => {
    const rows = await sql<{ user_id: string; role: string }>(
      w.db,
      'SELECT user_id, role FROM agencia_membros ORDER BY label',
    )
    expect(rows).toEqual([
      { user_id: U.agus, role: 'super_admin' },
      { user_id: U.mel, role: 'manager' },
      { user_id: U.sara, role: 'support' },
    ])
    expect(
      (
        await sql<{ d: string }>(
          w.db,
          `SELECT column_default AS d FROM information_schema.columns
           WHERE table_name = 'agencia_membros' AND column_name = 'role'`,
        )
      )[0].d,
    ).toContain('support')
  })

  it('still gives a new signup a personal CRM it owns', async () => {
    const ctx = await context(w.db, U.otto)
    expect(ctx).toMatchObject({ role: 'owner', via_agency: false })
  })
})

describe('049 — several CRMs per user', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  it('joining a second CRM keeps the first; the untouched personal CRM is removed', async () => {
    const rows = await asUser<{ account_id: string; role: string; is_active: boolean }>(
      w.db,
      U.mia,
      'SELECT account_id, role, is_active FROM list_my_accounts() ORDER BY role',
    )
    expect(rows).toEqual([
      { account_id: w.A, role: 'agent', is_active: false },
      { account_id: w.D, role: 'viewer', is_active: true },
    ])
    expect(
      await sql(w.db, 'SELECT 1 FROM accounts WHERE id = $1', [w.miaPersonal]),
    ).toEqual([])
  })

  it('only ever exposes the active CRM, even to a query without an account filter', async () => {
    expect(await contactNames(w.db, U.mia)).toEqual(['Duda'])
    await asUser(w.db, U.mia, 'SELECT set_active_account($1)', [w.A])
    expect(await contactNames(w.db, U.mia)).toEqual(['Ana'])
    expect(await context(w.db, U.mia)).toMatchObject({
      account_id: w.A,
      role: 'agent',
      via_agency: false,
    })
  })

  it('mirrors the active role into profiles.account_role for the client UI', async () => {
    await asUser(w.db, U.mia, 'SELECT set_active_account($1)', [w.D])
    const [p] = await sql<{ account_role: string }>(
      w.db,
      'SELECT account_role FROM profiles WHERE user_id = $1',
      [U.mia],
    )
    expect(p.account_role).toBe('viewer')
  })

  it('refuses to switch into a CRM you are not in', async () => {
    expect(
      await errorCode(asUser(w.db, U.otto, 'SELECT set_active_account($1)', [w.A])),
    ).toBe('42501')
  })

  it('shows teammates of the active CRM only', async () => {
    const names = async () =>
      (
        await asUser<{ full_name: string }>(
          w.db,
          U.mia,
          'SELECT full_name FROM profiles ORDER BY full_name',
        )
      ).map((r) => r.full_name)

    await asUser(w.db, U.mia, 'SELECT set_active_account($1)', [w.A])
    expect(await names()).toEqual(['Alice', 'Bob', 'Carol', 'Mia'])
    await asUser(w.db, U.mia, 'SELECT set_active_account($1)', [w.D])
    expect(await names()).toEqual(['Dave', 'Mia'])
  })

  it('a viewer still cannot write', async () => {
    expect(await errorCode(insertContact(w.db, U.carol, w.A, '5511911111111'))).toBe(
      '42501',
    )
    await insertContact(w.db, U.bob, w.A, '5511911111112')
  })
})

describe('049 — agency access follows the CRM owner’s consent', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
    // A stays at the backfilled 'read'; Dave grants 'full' to D.
    await asUser(w.db, U.dave, `SELECT set_agency_access('full')`)
  })

  it('sees nothing of a client CRM while their own CRM is active', async () => {
    expect(await contactNames(w.db, U.agus)).toEqual([])
  })

  it('read: can enter, read, not write — and the entry is audited', async () => {
    await asUser(w.db, U.agus, 'SELECT set_active_account($1)', [w.A])
    expect(await contactNames(w.db, U.agus)).toEqual(['Ana'])
    expect(await errorCode(insertContact(w.db, U.agus, w.A, '5511922222221'))).toBe(
      '42501',
    )
    expect(await context(w.db, U.agus)).toMatchObject({
      account_id: w.A,
      role: 'viewer',
      via_agency: true,
    })
    const audit = await sql<{ action: string; account_id: string }>(
      w.db,
      'SELECT action, account_id FROM agencia_auditoria WHERE actor_user_id = $1',
      [U.agus],
    )
    expect(audit).toEqual([{ action: 'enter_account', account_id: w.A }])
  })

  it('full: super_admin and manager operate as admin, support stays read-only', async () => {
    await asUser(w.db, U.agus, 'SELECT set_active_account($1)', [w.D])
    expect(await context(w.db, U.agus)).toMatchObject({ role: 'admin' })
    await insertContact(w.db, U.agus, w.D, '5511922222222')

    await asUser(w.db, U.mel, 'SELECT set_active_account($1)', [w.D])
    expect(await context(w.db, U.mel)).toMatchObject({ role: 'admin' })

    await asUser(w.db, U.sara, 'SELECT set_active_account($1)', [w.D])
    expect(await context(w.db, U.sara)).toMatchObject({ role: 'viewer' })
    expect(await errorCode(insertContact(w.db, U.sara, w.D, '5511922222223'))).toBe(
      '42501',
    )
  })

  it('metrics: the agency cannot enter at all', async () => {
    expect(
      await errorCode(asUser(w.db, U.agus, 'SELECT set_active_account($1)', [w.E])),
    ).toBe('42501')
  })

  it('a non-agency user cannot use the agency path', async () => {
    expect(
      await errorCode(asUser(w.db, U.otto, 'SELECT set_active_account($1)', [w.D])),
    ).toBe('42501')
  })

  it('only the owner — not an admin, not the agency — sets the level', async () => {
    expect(
      await errorCode(asUser(w.db, U.bob, `SELECT set_agency_access('full')`)),
    ).toBe('42501')
    await asUser(w.db, U.agus, 'SELECT set_active_account($1)', [w.D])
    expect(
      await errorCode(asUser(w.db, U.agus, `SELECT set_agency_access('full')`)),
    ).toBe('42501')
    expect(
      await errorCode(asUser(w.db, U.dave, `SELECT set_agency_access('tudo')`)),
    ).toBe('22023')
    expect(
      await errorCode(asUser(w.db, U.dave, `SELECT set_agency_access('read', 'full')`)),
    ).toBe('22023')
  })

  it('revoking consent cuts off an agency session already inside', async () => {
    await asUser(w.db, U.mel, 'SELECT set_active_account($1)', [w.D])
    expect(await contactNames(w.db, U.mel)).toContain('Duda')
    await asUser(w.db, U.dave, `SELECT set_agency_access('metrics')`)
    expect(await contactNames(w.db, U.mel)).toEqual([])
    expect(await context(w.db, U.mel)).toBeNull()
  })

  it('a temporary grant works, then lapses by itself', async () => {
    await asUser(w.db, U.eve, `SELECT set_agency_access('metrics', 'full', 2)`)
    await asUser(w.db, U.agus, 'SELECT set_active_account($1)', [w.E])
    expect(await context(w.db, U.agus)).toMatchObject({ role: 'admin', via_agency: true })

    await sql(
      w.db,
      `UPDATE account_agency_access SET temp_until = NOW() - INTERVAL '1 minute'
       WHERE account_id = $1`,
      [w.E],
    )
    expect(await context(w.db, U.agus)).toBeNull()
    expect(
      await asUser(w.db, U.agus, 'SELECT is_account_member($1) AS ok', [w.E]),
    ).toEqual([{ ok: false }])
  })
})

describe('049 — member management on account_members', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  it('changes a role and mirrors it into the active profile', async () => {
    await asUser(w.db, U.alice, `SELECT set_member_role($1, 'viewer')`, [U.bob])
    const [p] = await sql<{ account_role: string }>(
      w.db,
      'SELECT account_role FROM profiles WHERE user_id = $1',
      [U.bob],
    )
    expect(p.account_role).toBe('viewer')
    await asUser(w.db, U.alice, `SELECT set_member_role($1, 'agent')`, [U.bob])
  })

  it('keeps the old guards', async () => {
    expect(
      await errorCode(asUser(w.db, U.carol, `SELECT set_member_role($1, 'admin')`, [U.bob])),
    ).toBe('42501')
    expect(
      await errorCode(asUser(w.db, U.alice, `SELECT set_member_role($1, 'admin')`, [U.alice])),
    ).toBe('22023')
    expect(
      await errorCode(asUser(w.db, U.alice, `SELECT set_member_role($1, 'owner')`, [U.bob])),
    ).toBe('22023')
    expect(
      await errorCode(asUser(w.db, U.alice, `SELECT set_member_role($1, 'agent')`, [U.dave])),
    ).toBe('22023')
  })

  it('removing someone from their last CRM gives them a fresh personal one', async () => {
    const [{ id }] = await asUser<{ id: string }>(
      w.db,
      U.alice,
      'SELECT remove_account_member($1) AS id',
      [U.carol],
    )
    expect(id).not.toBe(w.A)
    expect(await activeAccountOf(w.db, U.carol)).toBe(id)
    expect(await contactNames(w.db, U.carol)).toEqual([])
  })

  it('removing someone from their active CRM moves them to another one', async () => {
    await asUser(w.db, U.mia, 'SELECT set_active_account($1)', [w.A])
    await asUser(w.db, U.alice, 'SELECT remove_account_member($1)', [U.mia])
    expect(await activeAccountOf(w.db, U.mia)).toBe(w.D)
  })

  it('transfers ownership: one owner, owner_user_id follows', async () => {
    await asUser(w.db, U.alice, 'SELECT transfer_account_ownership($1)', [U.bob])
    const rows = await sql<{ user_id: string; role: string }>(
      w.db,
      `SELECT user_id, role FROM account_members
       WHERE account_id = $1 AND role IN ('owner', 'admin') ORDER BY role`,
      [w.A],
    )
    expect(rows).toEqual([
      { user_id: U.bob, role: 'owner' },
      { user_id: U.alice, role: 'admin' },
    ])
    const [acc] = await sql<{ owner_user_id: string }>(
      w.db,
      'SELECT owner_user_id FROM accounts WHERE id = $1',
      [w.A],
    )
    expect(acc.owner_user_id).toBe(U.bob)
  })

  it('an agency session with full access is an admin, never the owner', async () => {
    await asUser(w.db, U.dave, `SELECT set_agency_access('full')`)
    await asUser(w.db, U.agus, 'SELECT set_active_account($1)', [w.D])
    expect(
      await errorCode(asUser(w.db, U.agus, 'SELECT transfer_account_ownership($1)', [U.mia])),
    ).toBe('42501')
  })
})

describe('049 — owner invitations', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  it('a client session cannot mint an owner invitation', async () => {
    const insert = (role: string, token: string) =>
      asUser(
        w.db,
        U.alice,
        `INSERT INTO account_invitations (account_id, token_hash, role, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '1 day')`,
        [w.A, token, role],
      )
    expect(await errorCode(insert('owner', 'evil'))).toBe('42501')
    expect(await errorCode(insert('agent', 'fine'))).toBe('resolved')
  })

  it('redeeming one makes the redeemer the only owner', async () => {
    await inviteAndRedeem(w.db, w.A, U.otto, 'owner')
    const rows = await sql<{ user_id: string; role: string }>(
      w.db,
      `SELECT user_id, role FROM account_members
       WHERE account_id = $1 AND role IN ('owner', 'admin') ORDER BY role`,
      [w.A],
    )
    expect(rows).toEqual([
      { user_id: U.otto, role: 'owner' },
      { user_id: U.alice, role: 'admin' },
    ])
    expect(await contactNames(w.db, U.otto)).toEqual(['Ana'])
  })

  it('a regular invitation to a CRM you are already in is refused', async () => {
    expect(await errorCode(inviteAndRedeem(w.db, w.A, U.bob, 'viewer'))).toBe('23505')
  })
})

describe('049 — lifecycle and storage', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  it('deleting a CRM no longer deletes the profiles inside it', async () => {
    // Mia is active in D (her last join); Dave only has D.
    await sql(w.db, 'DELETE FROM accounts WHERE id = $1', [w.D])
    expect(await activeAccountOf(w.db, U.dave)).toBeNull()
    expect(await activeAccountOf(w.db, U.mia)).toBe(w.A)
    expect(
      await sql(w.db, 'SELECT 1 FROM profiles WHERE user_id = $1', [U.dave]),
    ).toHaveLength(1)
    expect(await context(w.db, U.dave)).toBeNull()
  })

  it('create_personal_account is not callable from a session', async () => {
    expect(
      await errorCode(
        asUser(w.db, U.otto, 'SELECT create_personal_account($1)', [U.alice]),
      ),
    ).toBe('42501')
  })

  it('with the platform flag off, signup creates a profile and no CRM', async () => {
    await sql(w.db, 'UPDATE platform_settings SET auto_personal_account = FALSE')
    const nova = '00000000-0000-4000-8000-00000000013b'
    await signUp(w.db, nova, 'Nova')
    expect(await activeAccountOf(w.db, nova)).toBeNull()
    expect(await context(w.db, nova)).toBeNull()
    expect(await contactNames(w.db, nova)).toEqual([])
    await sql(w.db, 'UPDATE platform_settings SET auto_personal_account = TRUE')
  })

  it('chat-media uploads need agent or above on the active CRM', async () => {
    const upload = (userId: string, n: number) =>
      asUser(
        w.db,
        userId,
        `INSERT INTO storage.objects (bucket_id, name, owner)
         VALUES ('chat-media', $1, auth.uid())`,
        [`account-${w.A}/f${n}.png`],
      )
    expect(await errorCode(upload(U.bob, 1))).toBe('resolved')
    expect(await errorCode(upload(U.carol, 2))).toBe('42501')
    // Read-only agency session inside A.
    await asUser(w.db, U.agus, 'SELECT set_active_account($1)', [w.A])
    expect(await errorCode(upload(U.agus, 3))).toBe('42501')
  })
})
