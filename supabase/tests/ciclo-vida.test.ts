// ============================================================
// Migration 050 — CRM lifecycle: the agency creates CRMs and invites
// their owners, platform fields only the agency can change, status
// enforced by the access rules, managers' portfolios.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'

import { activeAccountOf, asUser, errorCode, inviteAndRedeem, signUp, sql } from './harness'
import { buildWorld, contactNames, context, insertContact, U, type World } from './world'

const NOVA = '00000000-0000-4000-8000-00000000014c' // nova@teste.dev

function createCrm(
  db: PGlite,
  actor: string,
  opts: {
    name?: string
    email?: string
    token?: string
    level?: string
    niche?: string | null
    manager?: string | null
  } = {},
) {
  return asUser<{ id: string }>(
    db,
    actor,
    `SELECT agencia_create_account(
       $1, $2, $3, NOW() + INTERVAL '7 days', $4, $5, $6
     ) AS id`,
    [
      opts.name ?? 'Clínica Sol',
      opts.email ?? 'nova@teste.dev',
      opts.token ?? `tok-${Math.random()}`,
      opts.niche ?? 'medical_clinic',
      opts.level ?? 'read',
      opts.manager ?? null,
    ],
  )
}

function updateCrm(db: PGlite, actor: string, accountId: string, patch: object) {
  return asUser(db, actor, 'SELECT agencia_update_account($1, $2::jsonb)', [
    accountId,
    JSON.stringify(patch),
  ])
}

async function auditActions(db: PGlite, accountId: string): Promise<string[]> {
  const rows = await sql<{ action: string }>(
    db,
    'SELECT action FROM agencia_auditoria WHERE account_id = $1 ORDER BY created_at, action',
    [accountId],
  )
  return rows.map((r) => r.action)
}

// ------------------------------------------------------------

describe('050 — the agency creates a CRM and invites its owner', () => {
  let w: World
  let sol: string
  beforeAll(async () => {
    w = await buildWorld()
  })

  it('support and outsiders cannot create', async () => {
    expect(await errorCode(createCrm(w.db, U.sara))).toBe('42501')
    expect(await errorCode(createCrm(w.db, U.otto))).toBe('42501')
  })

  it('validates what it is given', async () => {
    expect(await errorCode(createCrm(w.db, U.agus, { name: '  ' }))).toBe('22023')
    expect(await errorCode(createCrm(w.db, U.agus, { email: 'sem-arroba' }))).toBe('22023')
    expect(await errorCode(createCrm(w.db, U.agus, { level: 'tudo' }))).toBe('22023')
    expect(
      await errorCode(createCrm(w.db, U.agus, { manager: U.sara })),
    ).toBe('22023') // support can't be the responsible manager
  })

  it('a manager creates it in onboarding, in their own portfolio', async () => {
    const [{ id }] = await createCrm(w.db, U.mel, {
      token: 'tok-sol',
      manager: U.agus, // ignored: a manager's CRM is theirs
    })
    sol = id
    const [acc] = await sql<Record<string, unknown>>(
      w.db,
      `SELECT status, niche, manager_user_id, created_by, owner_user_id
       FROM accounts WHERE id = $1`,
      [sol],
    )
    expect(acc).toEqual({
      status: 'onboarding',
      niche: 'medical_clinic',
      manager_user_id: U.mel,
      created_by: U.mel,
      owner_user_id: U.mel, // placeholder until the client accepts
    })
    expect(
      (await sql<{ l: string }>(w.db, 'SELECT agency_access_level($1) AS l', [sol]))[0].l,
    ).toBe('read')
    expect(await auditActions(w.db, sol)).toEqual(['create_account'])
  })

  it('the placeholder owner is a pointer, not a membership', async () => {
    expect(
      await sql(w.db, 'SELECT 1 FROM account_members WHERE account_id = $1', [sol]),
    ).toEqual([])
  })

  it('the link shows who it is for and what the agency will see', async () => {
    const [{ peek }] = await sql<{ peek: Record<string, unknown> }>(
      w.db,
      `SELECT peek_invitation('tok-sol') AS peek`,
    )
    expect(peek).toMatchObject({
      ok: true,
      account_name: 'Clínica Sol',
      role: 'owner',
      email_hint: 'no***@teste.dev',
      agency_level: 'read',
    })
  })

  it('someone else holding the link cannot take the CRM', async () => {
    expect(
      await errorCode(asUser(w.db, U.otto, `SELECT redeem_invitation('tok-sol')`)),
    ).toBe('42501')
  })

  it('the right person sees it in the app and accepts without the link', async () => {
    await signUp(w.db, NOVA, 'Nova')
    const personal = await activeAccountOf(w.db, NOVA)

    const pending = await asUser<{ invitation_id: string; account_name: string; agency_level: string }>(
      w.db,
      NOVA,
      'SELECT invitation_id, account_name, agency_level FROM my_pending_invitations()',
    )
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ account_name: 'Clínica Sol', agency_level: 'read' })

    // Nobody else sees it, or can accept it by id.
    expect(
      await asUser(w.db, U.otto, 'SELECT * FROM my_pending_invitations()'),
    ).toEqual([])
    expect(
      await errorCode(
        asUser(w.db, U.otto, 'SELECT accept_my_invitation($1)', [pending[0].invitation_id]),
      ),
    ).toBe('22023')

    await asUser(w.db, NOVA, 'SELECT accept_my_invitation($1)', [pending[0].invitation_id])

    expect(await context(w.db, NOVA)).toMatchObject({
      account_id: sol,
      role: 'owner',
      status: 'onboarding',
    })
    const [acc] = await sql<{ owner_user_id: string }>(
      w.db,
      'SELECT owner_user_id FROM accounts WHERE id = $1',
      [sol],
    )
    expect(acc.owner_user_id).toBe(NOVA)
    // Her untouched personal CRM from signup is gone.
    expect(await sql(w.db, 'SELECT 1 FROM accounts WHERE id = $1', [personal])).toEqual([])
    expect(await asUser(w.db, NOVA, 'SELECT * FROM my_pending_invitations()')).toEqual([])
  })

  it('re-inviting an owner closes the earlier open invitation', async () => {
    const res = (token: string) =>
      asUser(
        w.db,
        U.agus,
        `SELECT agencia_invite_owner($1, 'otto@teste.dev', $2, NOW() + INTERVAL '7 days')`,
        [w.D, token],
      )
    await res('tok-d-1')
    await res('tok-d-2')
    const [{ peek }] = await sql<{ peek: Record<string, unknown> }>(
      w.db,
      `SELECT peek_invitation('tok-d-1') AS peek`,
    )
    expect(peek).toMatchObject({ ok: false, reason: 'expired' })

    await asUser(w.db, U.otto, `SELECT redeem_invitation('tok-d-2')`)
    const rows = await sql<{ user_id: string; role: string }>(
      w.db,
      `SELECT user_id, role FROM account_members
       WHERE account_id = $1 AND role IN ('owner', 'admin') ORDER BY role`,
      [w.D],
    )
    expect(rows).toEqual([
      { user_id: U.otto, role: 'owner' },
      { user_id: U.dave, role: 'admin' },
    ])
  })

  it('a manager cannot re-invite the owner of a CRM outside their portfolio', async () => {
    expect(
      await errorCode(
        asUser(
          w.db,
          U.mel,
          `SELECT agencia_invite_owner($1, 'x@teste.dev', 'tok-x', NOW() + INTERVAL '1 day')`,
          [w.A],
        ),
      ),
    ).toBe('42501')
  })
})

describe('050 — platform fields and status', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  it('a CRM’s own owner cannot change its platform fields, only its name', async () => {
    expect(
      await errorCode(
        asUser(w.db, U.alice, `UPDATE accounts SET status = 'suspended' WHERE id = $1`, [w.A]),
      ),
    ).toBe('42501')
    expect(
      await errorCode(
        asUser(w.db, U.alice, 'UPDATE accounts SET owner_user_id = $1 WHERE id = $2', [
          U.bob,
          w.A,
        ]),
      ),
    ).toBe('42501')
    await asUser(w.db, U.alice, `UPDATE accounts SET name = 'Alfa' WHERE id = $1`, [w.A])
  })

  it('suspended: everyone reads, nobody writes', async () => {
    await updateCrm(w.db, U.agus, w.A, { status: 'suspended' })
    expect(await contactNames(w.db, U.alice)).toEqual(['Ana'])
    expect(await errorCode(insertContact(w.db, U.alice, w.A, '5511933333331'))).toBe('42501')
    expect(await errorCode(insertContact(w.db, U.bob, w.A, '5511933333332'))).toBe('42501')
    expect(await context(w.db, U.alice)).toMatchObject({ role: 'owner', status: 'suspended' })

    await updateCrm(w.db, U.agus, w.A, { status: 'active' })
    await insertContact(w.db, U.bob, w.A, '5511933333333')
    expect(await auditActions(w.db, w.A)).toEqual(['status_suspended', 'status_active'])
  })

  it('a manager acts only on their portfolio, and never archives or reassigns', async () => {
    expect(await errorCode(updateCrm(w.db, U.mel, w.A, { status: 'suspended' }))).toBe('42501')

    await updateCrm(w.db, U.agus, w.A, { manager_user_id: U.mel })
    await updateCrm(w.db, U.mel, w.A, { niche: 'gym', notes: 'Plano anual' })
    expect(await errorCode(updateCrm(w.db, U.mel, w.A, { status: 'archived' }))).toBe('42501')
    expect(
      await errorCode(updateCrm(w.db, U.mel, w.A, { manager_user_id: U.agus })),
    ).toBe('42501')
    expect(await errorCode(updateCrm(w.db, U.agus, w.A, { status: 'deleted' }))).toBe('22023')

    const [acc] = await sql<Record<string, unknown>>(
      w.db,
      'SELECT niche, notes, manager_user_id FROM accounts WHERE id = $1',
      [w.A],
    )
    expect(acc).toEqual({ niche: 'gym', notes: 'Plano anual', manager_user_id: U.mel })
  })

  it('a manager operates a full-access CRM only when it is theirs', async () => {
    await asUser(w.db, U.dave, `SELECT set_agency_access('full')`)
    await asUser(w.db, U.mel, 'SELECT set_active_account($1)', [w.D])
    expect(await context(w.db, U.mel)).toMatchObject({ role: 'viewer', via_agency: true })

    await updateCrm(w.db, U.agus, w.D, { manager_user_id: U.mel })
    expect(await context(w.db, U.mel)).toMatchObject({ role: 'admin' })
  })

  it('archived: invisible to everyone, and people inside are moved out', async () => {
    await asUser(w.db, U.mia, 'SELECT set_active_account($1)', [w.A])
    await updateCrm(w.db, U.agus, w.A, { status: 'archived' })

    expect(await activeAccountOf(w.db, U.mia)).toBe(w.D)
    expect(await activeAccountOf(w.db, U.alice)).toBeNull() // A was her only CRM
    expect(await context(w.db, U.alice)).toBeNull()
    expect(
      await errorCode(asUser(w.db, U.alice, 'SELECT set_active_account($1)', [w.A])),
    ).toBe('42501')
    const mine = await asUser<{ account_id: string }>(
      w.db,
      U.mia,
      'SELECT account_id FROM list_my_accounts()',
    )
    expect(mine.map((r) => r.account_id)).toEqual([w.D])
  })

  it('an archived CRM’s open invitations stop working', async () => {
    await sql(
      w.db,
      `INSERT INTO account_invitations (account_id, token_hash, role, expires_at)
       VALUES ($1, 'tok-archived', 'agent', NOW() + INTERVAL '1 day')`,
      [w.A],
    )
    const [{ peek }] = await sql<{ peek: Record<string, unknown> }>(
      w.db,
      `SELECT peek_invitation('tok-archived') AS peek`,
    )
    expect(peek).toMatchObject({ ok: false, reason: 'not_found' })
    expect(
      await errorCode(asUser(w.db, U.otto, `SELECT redeem_invitation('tok-archived')`)),
    ).toBe('22023')
  })

  it('a super admin can restore it', async () => {
    await updateCrm(w.db, U.agus, w.A, { status: 'active' })
    await asUser(w.db, U.alice, 'SELECT set_active_account($1)', [w.A])
    expect(await contactNames(w.db, U.alice)).toContain('Ana')
  })
})

describe('050 — redeeming never discards a CRM the caller only stands in for', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  it('keeps an agency-created CRM the agency is looking at', async () => {
    const [{ id: x }] = await createCrm(w.db, U.agus, { level: 'full', email: 'x@teste.dev' })
    // agus is the placeholder owner of X, and has it open via the
    // agency path. Under 049's rule X looked like his empty CRM.
    await asUser(w.db, U.agus, 'SELECT set_active_account($1)', [x])
    await inviteAndRedeem(w.db, w.A, U.agus, 'viewer')

    expect(await sql(w.db, 'SELECT 1 FROM accounts WHERE id = $1', [x])).toHaveLength(1)
  })
})
