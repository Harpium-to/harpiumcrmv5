// ============================================================
// Migration 070 — custom fields a lead creates.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'

import { applyMigration, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

describe('070 — campos do lead', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  const insert = (account: string, name: string, key: string | null, from: string | null = 'lead') =>
    sql(
      w.db,
      `INSERT INTO custom_fields (account_id, user_id, field_name, field_type, field_key, created_from)
       VALUES ($1, $2, $3, 'text', $4, $5) RETURNING id`,
      [account, U.alice, name, key, from],
    )

  it('one field per folded name and account, among those that carry a key', async () => {
    await insert(w.A, 'Faturamento mensal', 'faturamento_mensal')
    // The second lead of the same form, arriving together, is refused…
    expect(await errorCode(insert(w.A, 'Faturamento Mensal', 'faturamento_mensal'))).toBe('23505')
    // …but another account has its own.
    await insert(w.D, 'Faturamento mensal', 'faturamento_mensal')
  })

  it('leaves fields created by hand (no key) as they were', async () => {
    await insert(w.A, 'Cidade', null, null)
    await insert(w.A, 'Cidade', null, null)
    const rows = await sql<{ n: number }>(
      w.db,
      `SELECT count(*)::int AS n FROM custom_fields WHERE account_id = $1 AND field_name = 'Cidade'`,
      [w.A],
    )
    expect(rows[0].n).toBe(2)
  })

  it('accepts only "lead" as an origin', async () => {
    expect(await errorCode(insert(w.A, 'Outro', 'outro', 'robo'))).toBe('23514')
  })

  it('applies twice without error', async () => {
    await applyMigration(w.db, '070_campos_do_lead.sql')
  })
})
