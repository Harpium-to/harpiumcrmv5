// ============================================================
// Radar — 079 (the daily ledger) and, below, 080 (alerts, settings,
// win probability).
// ============================================================

import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

import { asUser, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

const TZ = 'America/Sao_Paulo' // UTC-3 all year since 2019

async function metric(
  db: PGlite,
  account: string,
  name: string,
  day: string,
  dimension = '',
): Promise<number | null> {
  const rows = await sql<{ value: string }>(
    db,
    'SELECT value FROM metric_daily WHERE account_id = $1 AND metric = $2 AND dimension = $3 AND day = $4',
    [account, name, dimension, day],
  )
  return rows.length ? Number(rows[0].value) : null
}

let seq = 0
async function contact(db: PGlite, account: string, createdAt: string, source: string | null = null): Promise<string> {
  seq++
  const [{ id }] = await sql<{ id: string }>(
    db,
    `INSERT INTO contacts (user_id, account_id, phone, name, source, created_at)
     VALUES ($1, $2, '55119600' || lpad($3::text, 5, '0'), 'Pessoa ' || $3, $4, $5) RETURNING id`,
    [U.alice, account, seq, source, createdAt],
  )
  return id
}

describe('079 — radar_compute_days', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
    const A = w.A
    // Two leads on Nov 9 (local), one at 23:30 local = 02:30 UTC on the 10th.
    await contact(w.db, A, '2026-11-09T13:00:00Z', 'instagram')
    await contact(w.db, A, '2026-11-10T02:30:00Z', 'instagram')
    // One on Nov 10, from Google.
    const ana = await contact(w.db, A, '2026-11-10T15:00:00Z', 'google')

    // A conversation on Nov 10 with a customer message answered in 10 min.
    const [{ id: conv }] = await sql<{ id: string }>(
      w.db,
      `INSERT INTO conversations (user_id, account_id, contact_id, status, created_at)
       VALUES ($1, $2, $3, 'open', '2026-11-10T15:00:00Z') RETURNING id`,
      [U.alice, A, ana],
    )
    await sql(
      w.db,
      `INSERT INTO messages (conversation_id, sender_type, content_text, created_at) VALUES
         ($1, 'customer', 'oi', '2026-11-10T15:00:00Z'),
         ($1, 'agent', 'olá!', '2026-11-10T15:10:00Z')`,
      [conv],
    )

    // Deals: one created and won on Nov 10, one lost on Nov 9.
    const [{ id: pipe }] = await sql<{ id: string }>(
      w.db,
      `INSERT INTO pipelines (user_id, account_id, name) VALUES ($1, $2, 'Vendas') RETURNING id`,
      [U.alice, A],
    )
    const [{ id: stage }] = await sql<{ id: string }>(
      w.db,
      `INSERT INTO pipeline_stages (pipeline_id, name, position) VALUES ($1, 'Novo', 0) RETURNING id`,
      [pipe],
    )
    await sql(
      w.db,
      `INSERT INTO deals (user_id, account_id, pipeline_id, stage_id, title, value, status, created_at, closed_at) VALUES
         ($1, $2, $3, $4, 'Implante', 5000, 'won',  '2026-11-10T12:00:00Z', '2026-11-10T18:00:00Z'),
         ($1, $2, $3, $4, 'Clareamento', 800, 'lost', '2026-11-01T12:00:00Z', '2026-11-09T20:00:00Z')`,
      [U.alice, A, pipe, stage],
    )

    // Agenda: one done and one no-show on Nov 10.
    const [{ id: cal }] = await sql<{ id: string }>(
      w.db,
      `INSERT INTO calendars (account_id, name) VALUES ($1, 'Consultas') RETURNING id`,
      [A],
    )
    await sql(
      w.db,
      `INSERT INTO calendar_events (account_id, calendar_id, starts_at, ends_at, status, created_at) VALUES
         ($1, $2, '2026-11-10T12:00:00Z', '2026-11-10T12:30:00Z', 'done', '2026-11-08T12:00:00Z'),
         ($1, $2, '2026-11-10T13:00:00Z', '2026-11-10T13:30:00Z', 'no_show', '2026-11-08T13:00:00Z')`,
      [A, cal],
    )

    await sql(w.db, `SELECT radar_compute_days($1, '2026-11-07', '2026-11-11', $2)`, [A, TZ])
  })

  it('cuts days in the CRM time zone', async () => {
    expect(await metric(w.db, w.A, 'leads', '2026-11-09')).toBe(2)
    expect(await metric(w.db, w.A, 'leads', '2026-11-10')).toBe(1)
    expect(await metric(w.db, w.A, 'leads', '2026-11-09', 'instagram')).toBe(2)
    expect(await metric(w.db, w.A, 'leads', '2026-11-10', 'google')).toBe(1)
  })

  it('counts what happened, and zero on quiet days', async () => {
    expect(await metric(w.db, w.A, 'conversas_novas', '2026-11-10')).toBe(1)
    expect(await metric(w.db, w.A, 'mensagens_recebidas', '2026-11-10')).toBe(1)
    expect(await metric(w.db, w.A, 'negocios_criados', '2026-11-10')).toBe(1)
    expect(await metric(w.db, w.A, 'negocios_ganhos', '2026-11-10')).toBe(1)
    expect(await metric(w.db, w.A, 'negocios_ganhos_valor', '2026-11-10')).toBe(5000)
    expect(await metric(w.db, w.A, 'negocios_perdidos', '2026-11-09')).toBe(1)
    expect(await metric(w.db, w.A, 'consultas_marcadas', '2026-11-08')).toBe(2)
    expect(await metric(w.db, w.A, 'consultas_realizadas', '2026-11-10')).toBe(1)
    expect(await metric(w.db, w.A, 'faltas', '2026-11-10')).toBe(1)
    // A quiet day has its zero; a breakdown has no row.
    expect(await metric(w.db, w.A, 'leads', '2026-11-07')).toBe(0)
    expect(await metric(w.db, w.A, 'leads', '2026-11-07', 'instagram')).toBeNull()
  })

  it('first response: the median where there is one, nothing where there is not', async () => {
    expect(await metric(w.db, w.A, 'primeira_resposta_min', '2026-11-10')).toBe(10)
    expect(await metric(w.db, w.A, 'primeira_resposta_n', '2026-11-10')).toBe(1)
    expect(await metric(w.db, w.A, 'primeira_resposta_min', '2026-11-08')).toBeNull()
  })

  it('running it again changes nothing', async () => {
    const [before] = await sql<{ n: number }>(w.db, 'SELECT count(*)::int AS n FROM metric_daily WHERE account_id = $1', [w.A])
    await sql(w.db, `SELECT radar_compute_days($1, '2026-11-07', '2026-11-11', $2)`, [w.A, TZ])
    const [after] = await sql<{ n: number }>(w.db, 'SELECT count(*)::int AS n FROM metric_daily WHERE account_id = $1', [w.A])
    expect(after.n).toBe(before.n)
    expect(await metric(w.db, w.A, 'leads', '2026-11-09')).toBe(2)
  })

  it('only the scheduler computes; members read their own CRM only', async () => {
    expect(
      await errorCode(asUser(w.db, U.alice, `SELECT radar_compute_days($1, '2026-11-07', '2026-11-08')`, [w.A])),
    ).toBe('42501')
    expect(
      (await asUser(w.db, U.bob, 'SELECT 1 FROM metric_daily WHERE account_id = $1 LIMIT 1', [w.A])).length,
    ).toBe(1)
    expect(
      (await asUser(w.db, U.dave, 'SELECT 1 FROM metric_daily WHERE account_id = $1 LIMIT 1', [w.A])).length,
    ).toBe(0)
    expect(
      await errorCode(
        asUser(w.db, U.alice, `INSERT INTO metric_daily (account_id, day, metric) VALUES ($1, '2026-11-01', 'x')`, [w.A]),
      ),
    ).toBe('42501')
  })
})
