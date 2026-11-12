// ============================================================
// Migration 066 — contacts who asked not to receive automatic messages.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'

import { applyMigration, asUser, sql } from './harness'
import { buildWorld, U, type World } from './world'

describe('066 — opting out', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  const optedOut = (user: string) =>
    asUser<{ name: string }>(w.db, user, 'SELECT name FROM contacts WHERE opted_out_at IS NOT NULL ORDER BY name').then(
      (rows) => rows.map((r) => r.name),
    )

  it('an agent marks a contact, and the team sees it', async () => {
    const done = await asUser(
      w.db,
      U.bob,
      "UPDATE contacts SET opted_out_at = NOW() WHERE name = 'Ana' RETURNING id",
    )
    expect(done).toHaveLength(1)
    expect(await optedOut(U.alice)).toEqual(['Ana'])
    expect(await optedOut(U.carol)).toEqual(['Ana'])
  })

  it('a viewer cannot change it, nor another CRM', async () => {
    expect(await asUser(w.db, U.carol, 'UPDATE contacts SET opted_out_at = NULL RETURNING id')).toEqual([])
    expect(await asUser(w.db, U.dave, "UPDATE contacts SET opted_out_at = NULL WHERE name = 'Ana' RETURNING id")).toEqual([])
    expect(await optedOut(U.alice)).toEqual(['Ana'])
  })

  it('is safe to run again', async () => {
    await applyMigration(w.db, '066_descadastro.sql')
    const rows = await sql<{ n: number }>(w.db, 'SELECT count(*)::int AS n FROM contacts WHERE opted_out_at IS NOT NULL')
    expect(rows[0].n).toBe(1)
  })
})
