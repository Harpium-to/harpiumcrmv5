// ============================================================
// Migration 051 — the client's side of consent: history of every
// level change, the agency asking for access, the owner answering,
// and the owner reading what the agency did in their CRM.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'

import { asUser, errorCode, sql } from './harness'
import { buildWorld, context, U, type World } from './world'

function requestAccess(
  db: PGlite,
  actor: string,
  accountId: string,
  level: string,
  opts: { reason?: string; hours?: number | null } = {},
) {
  return asUser<{ id: string }>(
    db,
    actor,
    'SELECT agencia_request_access($1, $2, $3, $4) AS id',
    [accountId, level, opts.reason ?? null, opts.hours ?? null],
  )
}

function decide(db: PGlite, actor: string, requestId: string, approve: boolean) {
  return asUser(db, actor, 'SELECT decide_agency_access_request($1, $2)', [
    requestId,
    approve,
  ])
}

async function requestStatuses(db: PGlite, accountId: string): Promise<string[]> {
  const rows = await sql<{ status: string }>(
    db,
    `SELECT status FROM account_agency_access_requests
     WHERE account_id = $1 ORDER BY created_at`,
    [accountId],
  )
  return rows.map((r) => r.status)
}

describe('051 — consent history', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  it('every CRM starts with its current level on record', async () => {
    const rows = await sql<{ account_id: string; level: string }>(
      w.db,
      'SELECT account_id, level FROM account_agency_access_log WHERE account_id = ANY($1)',
      [[w.A, w.D]],
    )
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.level === 'read')).toBe(true)
  })

  it('a change is recorded with who made it', async () => {
    await asUser(w.db, U.dave, `SELECT set_agency_access('full')`)
    const rows = await sql<{ level: string; changed_by: string }>(
      w.db,
      `SELECT level, changed_by FROM account_agency_access_log
       WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [w.D],
    )
    expect(rows).toEqual([{ level: 'full', changed_by: U.dave }])
  })

  it('owner and agency read it; an agent does not', async () => {
    const read = (u: string) =>
      asUser(w.db, u, 'SELECT level FROM account_agency_access_log')
    expect(await read(U.alice)).toHaveLength(1) // A only: her active CRM
    expect(await read(U.bob)).toEqual([])
    expect((await read(U.agus)).length).toBeGreaterThanOrEqual(3)
  })
})

describe('051 — the agency asks, the owner answers', () => {
  let w: World
  let first: string
  beforeAll(async () => {
    w = await buildWorld()
  })

  it('support, and a manager outside their portfolio, cannot ask', async () => {
    expect(await errorCode(requestAccess(w.db, U.sara, w.A, 'full'))).toBe('42501')
    expect(await errorCode(requestAccess(w.db, U.mel, w.A, 'full'))).toBe('42501')
  })

  it('asking for what the CRM already grants is refused', async () => {
    // A is at 'read' since the 049 backfill.
    expect(await errorCode(requestAccess(w.db, U.agus, w.A, 'read'))).toBe('22023')
    expect(await errorCode(requestAccess(w.db, U.agus, w.A, 'tudo'))).toBe('22023')
    expect(
      await errorCode(requestAccess(w.db, U.agus, w.A, 'full', { hours: 500 })),
    ).toBe('22023')
  })

  it('a request notifies the owner, and a newer one replaces it', async () => {
    ;[{ id: first }] = await requestAccess(w.db, U.agus, w.A, 'full', {
      reason: 'Configurar automações',
    })
    const notes = await asUser<{ type: string; title: string; body: string }>(
      w.db,
      U.alice,
      `SELECT type, title, body FROM notifications WHERE type = 'agency_access_request'`,
    )
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toBe('A agência pediu acesso Total')
    expect(notes[0].body).toContain('Configurar automações')
    // Not sent to the agent.
    expect(
      await asUser(w.db, U.bob, `SELECT 1 FROM notifications WHERE type = 'agency_access_request'`),
    ).toEqual([])

    const [{ id: second }] = await requestAccess(w.db, U.agus, w.A, 'full')
    expect(await requestStatuses(w.db, w.A)).toEqual(['cancelled', 'pending'])
    first = second
  })

  it('members see the pending request; only the owner answers it', async () => {
    expect(
      await asUser(
        w.db,
        U.bob,
        `SELECT status FROM account_agency_access_requests ORDER BY created_at`,
      ),
    ).toEqual([{ status: 'cancelled' }, { status: 'pending' }])
    expect(await errorCode(decide(w.db, U.bob, first, true))).toBe('42501')
    // Denying needs the owner too — it doesn't go through
    // set_agency_access, so only decide's own check stops it.
    expect(await errorCode(decide(w.db, U.bob, first, false))).toBe('42501')
    // The owner of another CRM can't reach it.
    expect(await errorCode(decide(w.db, U.dave, first, true))).toBe('22023')
  })

  it('denied: nothing changes', async () => {
    await decide(w.db, U.alice, first, false)
    expect(
      (await sql<{ l: string }>(w.db, 'SELECT agency_access_level($1) AS l', [w.A]))[0].l,
    ).toBe('read')
    expect(await errorCode(decide(w.db, U.alice, first, true))).toBe('22023') // already answered
  })

  it('approved: the level changes and the history says who allowed it', async () => {
    const [{ id }] = await requestAccess(w.db, U.agus, w.A, 'full')
    await decide(w.db, U.alice, id, true)

    expect(
      (await sql<{ l: string }>(w.db, 'SELECT agency_access_level($1) AS l', [w.A]))[0].l,
    ).toBe('full')
    const [last] = await sql<{ level: string; changed_by: string }>(
      w.db,
      `SELECT level, changed_by FROM account_agency_access_log
       WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [w.A],
    )
    expect(last).toEqual({ level: 'full', changed_by: U.alice })

    await asUser(w.db, U.agus, 'SELECT set_active_account($1)', [w.A])
    expect(await context(w.db, U.agus)).toMatchObject({ role: 'admin', via_agency: true })
  })

  it('a temporary request leaves the base level alone', async () => {
    const [{ id }] = await requestAccess(w.db, U.agus, w.E, 'read', { hours: 2 })
    await decide(w.db, U.eve, id, true)

    const [row] = await sql<{ level: string; temp_level: string }>(
      w.db,
      'SELECT level, temp_level FROM account_agency_access WHERE account_id = $1',
      [w.E],
    )
    expect(row).toEqual({ level: 'metrics', temp_level: 'read' })
    await asUser(w.db, U.agus, 'SELECT set_active_account($1)', [w.E])
    expect(await context(w.db, U.agus)).toMatchObject({ role: 'viewer' })
  })

  it('a CRM with no owner yet cannot be asked', async () => {
    const [{ id: x }] = await asUser<{ id: string }>(
      w.db,
      U.agus,
      `SELECT agencia_create_account('Sem dono', 'x@teste.dev', 'tok-x',
         NOW() + INTERVAL '7 days', NULL, 'metrics') AS id`,
    )
    expect(await errorCode(requestAccess(w.db, U.agus, x, 'read'))).toBe('22023')
  })
})

describe('051 — the owner sees what the agency did', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
    await requestAccess(w.db, U.agus, w.A, 'full', { reason: 'Suporte' })
    await asUser(w.db, U.agus, 'SELECT set_active_account($1)', [w.A])
  })

  it('lists the agency’s actions in the active CRM, with the person’s name', async () => {
    const rows = await asUser<{ action: string; actor_name: string }>(
      w.db,
      U.alice,
      'SELECT action, actor_name FROM my_crm_agency_activity()',
    )
    expect(rows.map((r) => r.action).sort()).toEqual(['enter_account', 'request_access'])
    expect(rows.every((r) => r.actor_name === 'Agus')).toBe(true)
  })

  it('agents and viewers cannot read it', async () => {
    expect(
      await errorCode(asUser(w.db, U.bob, 'SELECT * FROM my_crm_agency_activity()')),
    ).toBe('42501')
  })

  it('it only ever shows the active CRM', async () => {
    const rows = await asUser(w.db, U.dave, 'SELECT * FROM my_crm_agency_activity()')
    expect(rows).toEqual([])
  })
})
