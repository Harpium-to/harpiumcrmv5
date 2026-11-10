// ============================================================
// Migration 065 — bulk sends through the QR-code number.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'

import { applyMigration, asUser, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

const M065 = '065_disparos_qr.sql'

const create = (w: World, user: string, account: string, name: string, text: string | null) =>
  asUser<{ id: string }>(
    w.db,
    user,
    `INSERT INTO bulk_sends (account_id, created_by, name, content_text, total, risk_accepted_at)
     VALUES ($1, auth.uid(), $2, $3, 0, NOW()) RETURNING id`,
    [account, name, text],
  )

describe('065 — who sees and starts bulk sends', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  const names = (user: string) =>
    asUser<{ name: string }>(w.db, user, 'SELECT name FROM bulk_sends ORDER BY name').then((rows) =>
      rows.map((r) => r.name),
    )

  it('an admin starts one and the whole team sees it', async () => {
    await create(w, U.alice, w.A, 'Promoção de novembro', 'Oi! Temos novidade.')
    expect(await names(U.bob)).toEqual(['Promoção de novembro'])
    expect(await names(U.carol)).toEqual(['Promoção de novembro'])
  })

  it('an agent or a viewer cannot start or stop one', async () => {
    expect(await errorCode(create(w, U.bob, w.A, 'Do atendente', 'x'))).toBe('42501')
    expect(await errorCode(create(w, U.carol, w.A, 'Do leitor', 'x'))).toBe('42501')
    expect(
      await asUser(w.db, U.bob, 'UPDATE bulk_sends SET stopped_at = NOW() RETURNING id'),
    ).toEqual([])
  })

  it('another CRM sees nothing and cannot write into this one', async () => {
    expect(await names(U.dave)).toEqual([])
    expect(await errorCode(create(w, U.dave, w.A, 'De fora', 'x'))).toBe('42501')
  })

  it('needs a name, and something to send', async () => {
    expect(await errorCode(create(w, U.alice, w.A, '  ', 'x'))).toBe('23514')
    expect(await errorCode(create(w, U.alice, w.A, 'Vazio', '  '))).toBe('23514')
  })

  it('needs the risk accepted', async () => {
    expect(
      await errorCode(
        asUser(
          w.db,
          U.alice,
          `INSERT INTO bulk_sends (account_id, created_by, name, content_text)
           VALUES ($1, auth.uid(), 'Sem aceite', 'x')`,
          [w.A],
        ),
      ),
    ).toBe('23502')
  })

  it('ties scheduled messages to their bulk send', async () => {
    const [bulk] = await sql<{ id: string }>(w.db, "SELECT id FROM bulk_sends WHERE name = 'Promoção de novembro'")
    const [ana] = await sql<{ id: string }>(w.db, "SELECT id FROM contacts WHERE name = 'Ana'")
    await sql(
      w.db,
      `INSERT INTO scheduled_messages (account_id, contact_id, content_text, send_at, bulk_send_id)
       VALUES ($1, $2, 'Oi, Ana!', NOW() + INTERVAL '1 minute', $3)`,
      [w.A, ana.id, bulk.id],
    )
    const rows = await sql<{ n: number }>(
      w.db,
      'SELECT count(*)::int AS n FROM scheduled_messages WHERE bulk_send_id = $1',
      [bulk.id],
    )
    expect(rows[0].n).toBe(1)
  })

  it('is safe to run again', async () => {
    await applyMigration(w.db, M065)
    expect(await names(U.alice)).toEqual(['Promoção de novembro'])
  })
})
