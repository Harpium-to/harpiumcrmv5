// ============================================================
// 082 — agents that start work on their own: rounds, the engine's
// pulse, the token cap and the proactive-send log.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'

import { asUser, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

describe('082 — agentes ativos', () => {
  let w: World
  let agent: string

  beforeAll(async () => {
    w = await buildWorld()
    const [row] = await sql<{ id: string }>(
      w.db,
      `INSERT INTO agents (account_id, name, system_prompt, role) VALUES ($1, 'Fê', 'Você é a SDR.', 'sdr') RETURNING id`,
      [w.A],
    )
    agent = row.id
  })

  it('gives every agent a daily token cap, inside its range', async () => {
    const [row] = await sql<{ daily_token_cap: number }>(w.db, 'SELECT daily_token_cap FROM agents WHERE id = $1', [agent])
    expect(row.daily_token_cap).toBe(300000)
    expect(await errorCode(sql(w.db, 'UPDATE agents SET daily_token_cap = 5 WHERE id = $1', [agent]))).toBe('23514')
  })

  it('lets admins create rounds and members read them, not write them', async () => {
    const insert = `INSERT INTO agent_rondas (account_id, agent_id, name, check_kind, every_minutes)
                    VALUES ($1, $2, 'Lead novo', 'lead_sem_contato', 15) RETURNING id`
    // Bob is an attendant (agent role): reads, cannot create.
    expect(await errorCode(asUser(w.db, U.bob, insert, [w.A, agent]))).toBe('42501')
    const [created] = await asUser<{ id: string }>(w.db, U.alice, insert, [w.A, agent])
    expect(created.id).toBeTruthy()
    const seen = await asUser(w.db, U.carol, 'SELECT id FROM agent_rondas WHERE account_id = $1', [w.A])
    expect(seen).toHaveLength(1)
    // Another CRM sees nothing.
    expect(await asUser(w.db, U.dave, 'SELECT id FROM agent_rondas', [])).toHaveLength(0)
  })

  it('refuses a round without a schedule, an unknown kind, or a too-short interval', async () => {
    const base = `INSERT INTO agent_rondas (account_id, agent_id, name, check_kind, every_minutes, run_at) VALUES ($1, $2, 'x', $3, $4, $5)`
    expect(await errorCode(sql(w.db, base, [w.A, agent, 'lead_sem_contato', null, null]))).toBe('23514')
    expect(await errorCode(sql(w.db, base, [w.A, agent, 'qualquer_coisa', 30, null]))).toBe('23514')
    expect(await errorCode(sql(w.db, base, [w.A, agent, 'pos_venda', 5, null]))).toBe('23514')
    expect(await errorCode(sql(w.db, base, [w.A, agent, 'pos_venda', null, '10:00']))).toBe('resolved')
  })

  it('keeps one engine row that every signed-in user can read', async () => {
    await sql(w.db, `UPDATE agent_engine_state SET last_tick_at = now() WHERE id = 1`)
    const rows = await asUser<{ last_tick_at: string }>(w.db, U.carol, 'SELECT last_tick_at FROM agent_engine_state', [])
    expect(rows).toHaveLength(1)
    expect(rows[0].last_tick_at).toBeTruthy()
    expect(await errorCode(sql(w.db, 'INSERT INTO agent_engine_state (id) VALUES (2)'))).toBe('23514')
  })

  it('logs proactive sends per contact, readable only inside the CRM', async () => {
    const [ana] = await sql<{ id: string }>(w.db, `SELECT id FROM contacts WHERE account_id = $1 AND name = 'Ana'`, [w.A])
    await sql(w.db, `INSERT INTO agent_proactive_sends (account_id, contact_id, agent_id) VALUES ($1, $2, $3)`, [w.A, ana.id, agent])
    expect(await asUser(w.db, U.bob, 'SELECT id FROM agent_proactive_sends', [])).toHaveLength(1)
    expect(await asUser(w.db, U.dave, 'SELECT id FROM agent_proactive_sends', [])).toHaveLength(0)
    // Written by the engine only.
    expect(
      await errorCode(
        asUser(w.db, U.alice, `INSERT INTO agent_proactive_sends (account_id, contact_id) VALUES ($1, $2)`, [w.A, ana.id]),
      ),
    ).toBe('42501')
  })

  it('is idempotent', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const file = readFileSync(join(__dirname, '..', 'migrations', '082_agentes_ativos.sql'), 'utf8')
    expect(await errorCode(w.db.exec(file))).toBe('resolved')
  })
})
