// ============================================================
// Migration 056 — the console's totals are counted in SQL, so they
// are exact past PostgREST's 1000-row cap.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'

import { asUser, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

describe('056 — agency totals in SQL', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
    // 1500 more contacts in A, 1200 messages over two UTC days.
    await sql(
      w.db,
      `INSERT INTO contacts (user_id, account_id, phone, name)
       SELECT $1, $2, '55219' || lpad(g::text, 8, '0'), 'C' || g
       FROM generate_series(1, 1500) g`,
      [U.alice, w.A],
    )
    const [{ id: conv }] = await sql<{ id: string }>(
      w.db,
      `INSERT INTO conversations (user_id, account_id, contact_id, status)
       SELECT $1, $2, id, 'open' FROM contacts WHERE name = 'Ana' RETURNING id`,
      [U.alice, w.A],
    )
    await sql(
      w.db,
      `INSERT INTO messages (conversation_id, sender_type, content_text, created_at)
       SELECT $1, CASE WHEN g % 3 = 0 THEN 'agent' ELSE 'customer' END, 'x',
              date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                - CASE WHEN g <= 700 THEN INTERVAL '0 hours' ELSE INTERVAL '1 day' END
                + INTERVAL '1 minute'
       FROM generate_series(1, 1200) g`,
      [conv],
    )
  })

  it('counts every contact and open conversation, well past 1000', async () => {
    const [{ t }] = await sql<{ t: Array<Record<string, number | string>> }>(
      w.db,
      'SELECT agencia_account_totals() AS t',
    )
    const a = t.find((r) => r.account_id === w.A)!
    expect(a.contacts).toBe(1501) // Ana + 1500
    expect(a.open_conversations).toBe(1)
    expect(a.open_unassigned).toBe(1)
    const d = t.find((r) => r.account_id === w.D)!
    expect(d.contacts).toBe(1)
  })

  it('counts messages per day and per CRM', async () => {
    const [{ s }] = await sql<{
      s: {
        daily: Array<{ day: string; incoming: number; outgoing: number }>
        by_account: Array<{ account_id: string; messages: number }>
      }
    }>(w.db, `SELECT agencia_message_stats(NOW() - INTERVAL '30 days') AS s`)
    const total = s.daily.reduce((n, d) => n + d.incoming + d.outgoing, 0)
    expect(total).toBe(1200)
    expect(s.daily).toHaveLength(2)
    expect(s.daily[1]).toEqual({ day: expect.any(String), incoming: 467, outgoing: 233 })
    expect(s.by_account).toEqual([
      expect.objectContaining({ account_id: w.A, messages: 1200 }),
    ])
  })

  it('can count a shorter window and filter one CRM', async () => {
    const [{ s }] = await sql<{ s: { by_account: Array<{ messages: number }> } }>(
      w.db,
      `SELECT agencia_message_stats(NOW() - INTERVAL '30 days', $1,
         date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS s`,
      [w.A],
    )
    expect(s.by_account[0].messages).toBe(700)
    const [{ none }] = await sql<{ none: { by_account: unknown[] } }>(
      w.db,
      `SELECT agencia_message_stats(NOW() - INTERVAL '30 days', $1) AS none`,
      [w.D],
    )
    expect(none.by_account).toEqual([])
  })

  it('is not callable from a session', async () => {
    expect(await errorCode(asUser(w.db, U.agus, 'SELECT agencia_account_totals()'))).toBe('42501')
    expect(
      await errorCode(asUser(w.db, U.agus, `SELECT agencia_message_stats(NOW())`)),
    ).toBe('42501')
  })
})
