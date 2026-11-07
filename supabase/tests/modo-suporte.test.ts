// ============================================================
// Migration 055 — support mode: the agency inside a client CRM.
// Every write it makes there is audited; leaving takes it back.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'

import { activeAccountOf, asUser, errorCode, sql } from './harness'
import { buildWorld, context, insertContact, U, type World } from './world'

async function actions(db: PGlite, accountId: string, actor: string): Promise<string[]> {
  const rows = await sql<{ action: string }>(
    db,
    `SELECT action FROM agencia_auditoria
     WHERE account_id = $1 AND actor_user_id = $2 ORDER BY created_at, action`,
    [accountId, actor],
  )
  return rows.map((r) => r.action)
}

describe('055 — support mode', () => {
  let w: World
  let agusOwn: string
  beforeAll(async () => {
    w = await buildWorld()
    agusOwn = (await activeAccountOf(w.db, U.agus))!
    await asUser(w.db, U.dave, `SELECT set_agency_access('full')`)
    await asUser(w.db, U.agus, 'SELECT set_active_account($1)', [w.D])
  })

  it('writes by the agency are recorded, table and operation', async () => {
    await insertContact(w.db, U.agus, w.D, '5511944444441')
    await asUser(
      w.db,
      U.agus,
      `UPDATE contacts SET name = 'Duda Souza' WHERE account_id = $1 AND name = 'Duda'`,
      [w.D],
    )
    expect(await actions(w.db, w.D, U.agus)).toEqual([
      'enter_account',
      'contacts_insert',
      'contacts_update',
    ])
  })

  it('a message sent by the agency is recorded against the right CRM', async () => {
    const [{ id: conv }] = await sql<{ id: string }>(
      w.db,
      `INSERT INTO conversations (user_id, account_id, contact_id)
       SELECT $1, $2, id FROM contacts WHERE account_id = $2 LIMIT 1 RETURNING id`,
      [U.dave, w.D],
    )
    await asUser(
      w.db,
      U.agus,
      `INSERT INTO messages (conversation_id, sender_type, sender_id, content_text)
       VALUES ($1, 'agent', auth.uid(), 'Oi, aqui é o suporte')`,
      [conv],
    )
    expect(await actions(w.db, w.D, U.agus)).toContain('messages_insert')
  })

  it('the client’s own writes are never logged', async () => {
    await insertContact(w.db, U.dave, w.D, '5511944444442')
    const rows = await sql(
      w.db,
      'SELECT 1 FROM agencia_auditoria WHERE actor_user_id = $1',
      [U.dave],
    )
    expect(rows).toEqual([])
  })

  it('the owner reads it all in their activity log', async () => {
    const rows = await asUser<{ action: string }>(
      w.db,
      U.dave,
      'SELECT action FROM my_crm_agency_activity()',
    )
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['enter_account', 'contacts_insert', 'messages_insert']),
    )
  })

  it('leaving goes back to the operator’s own CRM, and is recorded', async () => {
    const [{ next }] = await asUser<{ next: string }>(
      w.db,
      U.agus,
      'SELECT leave_agency_session() AS next',
    )
    expect(next).toBe(agusOwn)
    expect(await context(w.db, U.agus)).toMatchObject({ account_id: agusOwn, via_agency: false })
    expect((await actions(w.db, w.D, U.agus)).at(-1)).toBe('leave_account')
  })

  it('outside support mode, leaving changes nothing', async () => {
    const [{ next }] = await asUser<{ next: string }>(
      w.db,
      U.alice,
      'SELECT leave_agency_session() AS next',
    )
    expect(next).toBe(w.A)
    expect(await activeAccountOf(w.db, U.alice)).toBe(w.A)
  })

  it('read-only support cannot write at all', async () => {
    await asUser(w.db, U.agus, 'SELECT set_active_account($1)', [w.A]) // A is 'read'
    expect(await errorCode(insertContact(w.db, U.agus, w.A, '5511944444443'))).toBe('42501')
  })
})
