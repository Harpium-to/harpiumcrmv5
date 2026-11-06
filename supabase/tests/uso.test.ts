// ============================================================
// Migration 052 — usage signals for the platform panel: activity days
// written by the presence heartbeat, and the per-CRM aggregate the
// console reads.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'

import { asUser, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

interface UsageRow {
  account_id: string
  members_total: number
  active_users_7d: number
  active_users_prev_7d: number
  last_activity_at: string | null
  msgs_w0: number
  msgs_w1: number
  msgs_w2: number
  msgs_in_7d: number
  msgs_out_7d: number
  open_conversations: number
  open_unassigned: number
  unanswered_24h: number
  channel_connected: boolean
  automations_active: number
}

describe('052 — activity days from the heartbeat', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  const days = (accountId: string) =>
    sql<{ user_id: string }>(
      w.db,
      'SELECT user_id FROM account_activity_days WHERE account_id = $1 ORDER BY user_id',
      [accountId],
    )

  it('a member online in their CRM marks today as a day of use', async () => {
    await asUser(w.db, U.alice, `SELECT touch_presence('online')`)
    await asUser(w.db, U.alice, `SELECT touch_presence('online')`) // idempotent
    expect(await days(w.A)).toEqual([{ user_id: U.alice }])
  })

  it('a background tab (away) is not use', async () => {
    await asUser(w.db, U.bob, `SELECT touch_presence('away')`)
    expect((await days(w.A)).map((r) => r.user_id)).not.toContain(U.bob)
  })

  it('the agency inside a client CRM does not count as the client using it', async () => {
    await asUser(w.db, U.agus, 'SELECT set_active_account($1)', [w.A])
    await asUser(w.db, U.agus, `SELECT touch_presence('online')`)
    expect((await days(w.A)).map((r) => r.user_id)).not.toContain(U.agus)
  })

  it('clients cannot read the activity table; the agency can', async () => {
    expect(await asUser(w.db, U.alice, 'SELECT * FROM account_activity_days')).toEqual([])
    expect(
      (await asUser(w.db, U.agus, 'SELECT * FROM account_activity_days')).length,
    ).toBeGreaterThan(0)
  })
})

describe('052 — agencia_platform_usage', () => {
  let w: World
  let rows: Map<string, UsageRow>

  beforeAll(async () => {
    w = await buildWorld()

    // A: one open, unassigned conversation. Messages spread over the
    // weeks; the last one is the customer's, two days old.
    const [{ id: conv }] = await sql<{ id: string }>(
      w.db,
      `INSERT INTO conversations (user_id, account_id, contact_id, status)
       SELECT $1, $2, id, 'open' FROM contacts WHERE name = 'Ana'
       RETURNING id`,
      [U.alice, w.A],
    )
    const msg = (daysAgo: number, sender: string) =>
      sql(
        w.db,
        `INSERT INTO messages (conversation_id, sender_type, content_text, created_at)
         VALUES ($1, $2, 'x', NOW() - make_interval(days => $3))`,
        [conv, sender, daysAgo],
      )
    for (let i = 0; i < 10; i++) await msg(9, 'customer') // w1
    for (let i = 0; i < 4; i++) await msg(16, 'agent') // w2
    await msg(5, 'agent') // w0
    await msg(2, 'customer') // w0, last, unanswered

    await sql(
      w.db,
      `INSERT INTO evolution_config (account_id, webhook_token, enabled) VALUES ($1, 'wh-a', TRUE)`,
      [w.A],
    )
    await sql(
      w.db,
      `INSERT INTO automations (user_id, account_id, name, trigger_type, is_active)
       VALUES ($1, $2, 'Boas-vindas', 'new_contact_created', TRUE)`,
      [U.alice, w.A],
    )
    await asUser(w.db, U.alice, `SELECT touch_presence('online')`)
    await asUser(w.db, U.bob, `SELECT touch_presence('online')`)
    // Bob was also around last week.
    await sql(
      w.db,
      `INSERT INTO account_activity_days (account_id, user_id, day)
       VALUES ($1, $2, (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 9)`,
      [w.A, U.bob],
    )

    const all = await sql<UsageRow>(w.db, 'SELECT * FROM agencia_platform_usage()')
    rows = new Map(all.map((r) => [r.account_id, r]))
  })

  it('counts members and who was active this week and last', () => {
    const a = rows.get(w.A)!
    expect(a.members_total).toBe(4) // alice, bob, carol, mia
    expect(a.active_users_7d).toBe(2)
    expect(a.active_users_prev_7d).toBe(1)
    expect(a.last_activity_at).not.toBeNull()
  })

  it('splits messages by week and direction', () => {
    const a = rows.get(w.A)!
    expect([a.msgs_w0, a.msgs_w1, a.msgs_w2]).toEqual([2, 10, 4])
    expect([a.msgs_in_7d, a.msgs_out_7d]).toEqual([1, 1])
  })

  it('sees the queue: open, unassigned, waiting on a reply for 24h+', () => {
    const a = rows.get(w.A)!
    expect([a.open_conversations, a.open_unassigned, a.unanswered_24h]).toEqual([1, 1, 1])
  })

  it('knows a channel is connected and an automation is on', () => {
    const a = rows.get(w.A)!
    expect(a.channel_connected).toBe(true)
    expect(a.automations_active).toBe(1)
    expect(rows.get(w.D)!.channel_connected).toBe(false)
  })

  it('a CRM nobody uses comes back as zeros, not missing', () => {
    const d = rows.get(w.D)!
    expect(d.active_users_7d).toBe(0)
    expect(d.msgs_w0).toBe(0)
    expect(d.last_activity_at).toBeNull()
  })

  it('archived CRMs are left out', async () => {
    await asUser(w.db, U.agus, `SELECT agencia_update_account($1, '{"status":"archived"}')`, [
      w.D,
    ])
    const ids = (
      await sql<{ account_id: string }>(w.db, 'SELECT account_id FROM agencia_platform_usage()')
    ).map((r) => r.account_id)
    expect(ids).not.toContain(w.D)
  })

  it('is not callable from a session', async () => {
    expect(
      await errorCode(asUser(w.db, U.agus, 'SELECT * FROM agencia_platform_usage()')),
    ).toBe('42501')
  })
})
