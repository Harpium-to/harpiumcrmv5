// ============================================================
// Migration 068 — named lead tokens and the "de/para" per origin.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'

import { applyMigration, asUser, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

describe('068 — lead tokens and de/para', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
    await sql(
      w.db,
      `INSERT INTO lead_ingest_tokens (account_id, name, token) VALUES
         ('${w.A}', 'Quiz planejados', 'tok-a'),
         ('${w.D}', 'Zapier', 'tok-d')`,
    )
    await sql(
      w.db,
      `INSERT INTO lead_field_mappings (account_id, source, field_key, target) VALUES
         ('${w.A}', 'quiz-planejados', 'faturamento', 'note'),
         ('${w.D}', 'zapier', 'verba', 'ignore')`,
    )
  })

  it('members read their CRM only', async () => {
    const tokens = (u: string) =>
      asUser<{ name: string }>(w.db, u, 'SELECT name FROM lead_ingest_tokens ORDER BY name').then((r) =>
        r.map((x) => x.name),
      )
    expect(await tokens(U.carol)).toEqual(['Quiz planejados'])
    expect(await tokens(U.dave)).toEqual(['Zapier'])
    expect(await tokens(U.otto)).toEqual([])

    const maps = await asUser<{ field_key: string }>(w.db, U.bob, 'SELECT field_key FROM lead_field_mappings')
    expect(maps.map((m) => m.field_key)).toEqual(['faturamento'])
  })

  it('nobody writes through the API key of a session (service role only)', async () => {
    expect(
      await asUser(w.db, U.alice, "UPDATE lead_ingest_tokens SET revoked_at = NOW() RETURNING id"),
    ).toEqual([])
    expect(
      await errorCode(
        asUser(w.db, U.alice, `INSERT INTO lead_field_mappings (account_id, source, field_key, target) VALUES ('${w.A}', 'x', 'y', 'note')`),
      ),
    ).toBe('42501')
  })

  it('refuses a target outside the vocabulary', async () => {
    expect(
      await errorCode(
        sql(w.db, `INSERT INTO lead_field_mappings (account_id, source, field_key, target) VALUES ('${w.A}', 'x', 'y', 'drop table')`),
      ),
    ).toBe('23514')
    await sql(
      w.db,
      `INSERT INTO lead_field_mappings (account_id, source, field_key, target) VALUES
         ('${w.A}', 'x', 'site', 'contact:website'),
         ('${w.A}', 'x', 'verba', 'custom:11111111-1111-4111-8111-111111111111')`,
    )
  })

  it('a lead keeps its row when its token is deleted', async () => {
    const [tok] = await sql<{ id: string }>(w.db, "SELECT id FROM lead_ingest_tokens WHERE token = 'tok-a'")
    await sql(
      w.db,
      `INSERT INTO leads (account_id, source, ingest_token_id) VALUES ('${w.A}', 'quiz-planejados', '${tok.id}')`,
    )
    await sql(w.db, `DELETE FROM lead_ingest_tokens WHERE id = '${tok.id}'`)
    const rows = await sql<{ ingest_token_id: string | null }>(
      w.db,
      "SELECT ingest_token_id FROM leads WHERE source = 'quiz-planejados'",
    )
    expect(rows).toEqual([{ ingest_token_id: null }])
  })

  it('is safe to run again', async () => {
    await applyMigration(w.db, '068_leads_tokens_depara.sql')
    const rows = await sql<{ n: number }>(w.db, 'SELECT count(*)::int AS n FROM lead_field_mappings')
    expect(rows[0].n).toBe(4)
  })
})
