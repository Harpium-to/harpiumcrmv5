// ============================================================
// Migration 059 — the WhatsApp path a CRM chose.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'

import { applyMigration, asUser, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

const M059 = '059_whatsapp_caminho.sql'

describe('059 — WhatsApp path', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  it('runs twice and starts every CRM with no path chosen', async () => {
    await applyMigration(w.db, M059)
    const rows = await sql<{ whatsapp_path: string | null }>(
      w.db,
      'SELECT whatsapp_path FROM accounts',
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.whatsapp_path === null)).toBe(true)
  })

  it('accepts only the two paths', async () => {
    expect(
      await errorCode(
        sql(w.db, `UPDATE accounts SET whatsapp_path = 'outro' WHERE id = $1`, [w.A]),
      ),
    ).toBe('23514')
    await sql(w.db, `UPDATE accounts SET whatsapp_path = 'nao_oficial' WHERE id = $1`, [w.A])
    const [row] = await sql<{ whatsapp_path: string }>(
      w.db,
      'SELECT whatsapp_path FROM accounts WHERE id = $1',
      [w.A],
    )
    expect(row.whatsapp_path).toBe('nao_oficial')
  })

  it('an admin of the CRM cannot flip the path directly, but can still rename it', async () => {
    expect(
      await errorCode(
        asUser(w.db, U.alice, `UPDATE accounts SET whatsapp_path = 'oficial' WHERE id = $1`, [
          w.A,
        ]),
      ),
    ).toBe('42501')
    await asUser(w.db, U.alice, `UPDATE accounts SET name = 'CRM da Alice' WHERE id = $1`, [w.A])
    const [row] = await sql<{ name: string; whatsapp_path: string }>(
      w.db,
      'SELECT name, whatsapp_path FROM accounts WHERE id = $1',
      [w.A],
    )
    expect(row).toEqual({ name: 'CRM da Alice', whatsapp_path: 'nao_oficial' })
  })

  it('the log refuses the unofficial path without the accepted risk text', async () => {
    expect(
      await errorCode(
        sql(
          w.db,
          `INSERT INTO whatsapp_path_log (account_id, path, chosen_by) VALUES ($1, 'nao_oficial', $2)`,
          [w.A, U.alice],
        ),
      ),
    ).toBe('23514')
    await sql(
      w.db,
      `INSERT INTO whatsapp_path_log (account_id, path, chosen_by, risk_terms_version)
       VALUES ($1, 'nao_oficial', $2, '2026-11-09')`,
      [w.A, U.alice],
    )
    await sql(
      w.db,
      `INSERT INTO whatsapp_path_log (account_id, path, previous_path, chosen_by)
       VALUES ($1, 'oficial', 'nao_oficial', $2)`,
      [w.A, U.alice],
    )
  })

  it('members read their own CRM’s history and nobody else’s', async () => {
    const bob = await asUser<{ path: string }>(
      w.db,
      U.bob,
      'SELECT path FROM whatsapp_path_log ORDER BY created_at',
    )
    expect(bob.map((r) => r.path).sort()).toEqual(['nao_oficial', 'oficial'])
    const dave = await asUser(w.db, U.dave, 'SELECT path FROM whatsapp_path_log')
    expect(dave).toEqual([])
  })

  it('members cannot write the history', async () => {
    expect(
      await errorCode(
        asUser(
          w.db,
          U.alice,
          `INSERT INTO whatsapp_path_log (account_id, path, chosen_by) VALUES ($1, 'oficial', $2)`,
          [w.A, U.alice],
        ),
      ),
    ).toBe('42501')
    const deleted = await asUser(w.db, U.alice, 'DELETE FROM whatsapp_path_log RETURNING id')
    expect(deleted).toEqual([])
  })
})
