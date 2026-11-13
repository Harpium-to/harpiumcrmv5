// ============================================================
// Automations belong to the CRM, not to whoever created them (017).
//
// GET /api/automations/[id] reads the automation through the caller's
// RLS client, filtered by the CRM `current_account_context()` names.
// This pins the database half of that: anyone in the active CRM — the
// agency included, by the owner's consent — reads an automation
// someone else created; nobody outside the active CRM does; changing
// it needs agent or above, the same minimum the route enforces.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'

import { asUser, sql } from './harness'
import { buildWorld, context, U, type World } from './world'

describe('017 — an automation is the CRM’s, not its author’s', () => {
  let w: World
  let automation: string

  beforeAll(async () => {
    w = await buildWorld()
    // Alice (owner of A) creates it; A lets the agency operate it.
    const rows = await sql<{ id: string }>(
      w.db,
      `INSERT INTO automations (user_id, account_id, name, trigger_type, trigger_config, is_active)
       VALUES ($1, $2, 'SDR dos leads do quiz', 'lead_received', '{}', true)
       RETURNING id`,
      [U.alice, w.A],
    )
    automation = rows[0].id
    await asUser(w.db, U.alice, `SELECT set_agency_access('full')`)
  })

  const reads = async (userId: string) =>
    (
      await asUser<{ id: string }>(
        w.db,
        userId,
        'SELECT id FROM automations WHERE id = $1 AND account_id = $2',
        [automation, w.A],
      )
    ).length

  const renames = async (userId: string, name: string) =>
    (
      await asUser<{ id: string }>(
        w.db,
        userId,
        'UPDATE automations SET name = $2 WHERE id = $1 RETURNING id',
        [automation, name],
      )
    ).length

  it('members who did not create it read it, whatever their role', async () => {
    expect(await reads(U.alice)).toBe(1)
    expect(await reads(U.bob)).toBe(1) // agent
    expect(await reads(U.carol)).toBe(1) // viewer
  })

  it('the agency reads it once inside the CRM, as admin', async () => {
    expect(await reads(U.agus)).toBe(0)
    await asUser(w.db, U.agus, 'SELECT set_active_account($1)', [w.A])
    expect(await context(w.db, U.agus)).toMatchObject({
      account_id: w.A,
      role: 'admin',
      via_agency: true,
    })
    expect(await reads(U.agus)).toBe(1)
  })

  it('another CRM does not, even its owner', async () => {
    expect(await reads(U.dave)).toBe(0)
    expect(await reads(U.otto)).toBe(0)
  })

  it('only the active CRM counts for someone in two', async () => {
    await asUser(w.db, U.mia, 'SELECT set_active_account($1)', [w.D])
    expect(await reads(U.mia)).toBe(0)
    await asUser(w.db, U.mia, 'SELECT set_active_account($1)', [w.A])
    expect(await reads(U.mia)).toBe(1)
  })

  it('changing it takes agent or above — not who created it', async () => {
    expect(await renames(U.carol, 'do leitor')).toBe(0)
    expect(await renames(U.dave, 'de outro CRM')).toBe(0)
    expect(await renames(U.bob, 'do agente')).toBe(1)
    expect(await renames(U.agus, 'da agência')).toBe(1)
    const [row] = await sql<{ name: string }>(w.db, 'SELECT name FROM automations WHERE id = $1', [
      automation,
    ])
    expect(row.name).toBe('da agência')
  })
})
