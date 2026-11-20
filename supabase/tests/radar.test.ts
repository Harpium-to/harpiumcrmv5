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

// ------------------------------------------------------------
// 080 — alerts, settings, digests, win probability
// ------------------------------------------------------------

describe('080 — what the Radar stores', () => {
  let w: World
  let alertId: string
  beforeAll(async () => {
    w = await buildWorld()
    const [{ id }] = await sql<{ id: string }>(
      w.db,
      `INSERT INTO radar_alerts (account_id, metric, period, period_start, period_end, value, expected,
                                 direction, tone, severity, title, href)
       VALUES ($1, 'leads', 'dia', '2026-11-17', '2026-11-17', 8, 18, 'queda', 'ruim', 'alta',
               'Leads novos caíram 56%', '/contacts') RETURNING id`,
      [w.A],
    )
    alertId = id
  })

  it('one alert per metric and period: the scheduler running twice never repeats it', async () => {
    expect(
      await errorCode(
        sql(
          w.db,
          `INSERT INTO radar_alerts (account_id, metric, period, period_start, period_end, value, expected,
                                     direction, tone, severity, title)
           VALUES ($1, 'leads', 'dia', '2026-11-17', '2026-11-17', 7, 18, 'queda', 'ruim', 'alta', 'x')`,
          [w.A],
        ),
      ),
    ).toBe('23505')
  })

  it('people read their CRM alerts and change only the status', async () => {
    expect(await asUser(w.db, U.carol, 'SELECT id FROM radar_alerts WHERE id = $1', [alertId])).toHaveLength(1)
    expect(await asUser(w.db, U.dave, 'SELECT id FROM radar_alerts WHERE id = $1', [alertId])).toHaveLength(0)
    await asUser(w.db, U.bob, `SELECT radar_set_alert_status($1, 'visto')`, [alertId])
    const [row] = await sql<{ status: string }>(w.db, 'SELECT status FROM radar_alerts WHERE id = $1', [alertId])
    expect(row.status).toBe('visto')
    // Ignoring speaks for the whole CRM: admins only. Viewers change nothing.
    expect(await errorCode(asUser(w.db, U.bob, `SELECT radar_set_alert_status($1, 'ignorado')`, [alertId]))).toBe('42501')
    expect(await errorCode(asUser(w.db, U.carol, `SELECT radar_set_alert_status($1, 'visto')`, [alertId]))).toBe('42501')
    await asUser(w.db, U.alice, `SELECT radar_set_alert_status($1, 'ignorado')`, [alertId])
    expect(
      await errorCode(asUser(w.db, U.alice, `UPDATE radar_alerts SET title = 'outro' WHERE id = $1`, [alertId])),
    ).toBe('42501')
  })

  it('settings: members read, admins write, values checked', async () => {
    await asUser(w.db, U.alice, `INSERT INTO radar_settings (account_id, sensitivity) VALUES ($1, 'alta')`, [w.A])
    expect(await asUser(w.db, U.bob, 'SELECT sensitivity FROM radar_settings WHERE account_id = $1', [w.A])).toEqual([
      { sensitivity: 'alta' },
    ])
    const updated = await asUser(w.db, U.bob, `UPDATE radar_settings SET enabled = false WHERE account_id = $1 RETURNING 1`, [w.A])
    expect(updated).toHaveLength(0)
    expect(
      await errorCode(asUser(w.db, U.alice, `UPDATE radar_settings SET sensitivity = 'maxima' WHERE account_id = $1`, [w.A])),
    ).toBe('23514')
  })

  it('a deal chance is a number between 0 and 1 with its basis', async () => {
    expect(
      await errorCode(sql(w.db, `UPDATE deals SET win_probability = 1.5 WHERE account_id = $1`, [w.A]).then(async () => {
        // No deals in A yet: create one and try again.
        const [{ id: pipe }] = await sql<{ id: string }>(w.db, `INSERT INTO pipelines (user_id, account_id, name) VALUES ($1, $2, 'P') RETURNING id`, [U.alice, w.A])
        const [{ id: stage }] = await sql<{ id: string }>(w.db, `INSERT INTO pipeline_stages (pipeline_id, name, position) VALUES ($1, 'S', 0) RETURNING id`, [pipe])
        await sql(w.db, `INSERT INTO deals (user_id, account_id, pipeline_id, stage_id, title) VALUES ($1, $2, $3, $4, 'D')`, [U.alice, w.A, pipe, stage])
        await sql(w.db, `UPDATE deals SET win_probability = 1.5 WHERE account_id = $1`, [w.A])
      })),
    ).toBe('23514')
    await sql(w.db, `UPDATE deals SET win_probability = 0.42, win_probability_basis = 'historico' WHERE account_id = $1`, [w.A])
  })

  it("notifications accept 'radar' and keep the older types", async () => {
    const [{ def }] = await sql<{ def: string }>(
      w.db,
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'notifications_type_check'`,
    )
    for (const t of ['radar', 'team_queue', 'conversation_overdue', 'assistente', 'conversation_assigned']) {
      expect(def).toContain(`'${t}'`)
    }
  })
})

describe('080 — chances and cooling leads in the database', () => {
  let w: World
  let pipe: string
  let s1: string
  let s2: string
  beforeAll(async () => {
    w = await buildWorld()
    ;[{ id: pipe }] = await sql<{ id: string }>(w.db, `INSERT INTO pipelines (user_id, account_id, name) VALUES ($1, $2, 'Vendas') RETURNING id`, [U.alice, w.A])
    ;[{ id: s1 }] = await sql<{ id: string }>(w.db, `INSERT INTO pipeline_stages (pipeline_id, name, position) VALUES ($1, 'Novo', 0) RETURNING id`, [pipe])
    ;[{ id: s2 }] = await sql<{ id: string }>(w.db, `INSERT INTO pipeline_stages (pipeline_id, name, position) VALUES ($1, 'Proposta', 1) RETURNING id`, [pipe])
    await sql(
      w.db,
      `INSERT INTO radar_stage_rates (stage_id, account_id, pipeline_id, rate, typical_days, basis) VALUES
         ($1, $3, $4, 0.2, 20, 'historico'), ($2, $3, $4, 0.6, 20, 'historico')`,
      [s1, s2, w.A, pipe],
    )
  })

  it('moving a deal gives it the new stage chance at once', async () => {
    const [{ id }] = await sql<{ id: string }>(
      w.db,
      `INSERT INTO deals (user_id, account_id, pipeline_id, stage_id, title, win_probability) VALUES ($1, $2, $3, $4, 'D', 0.2) RETURNING id`,
      [U.alice, w.A, pipe, s1],
    )
    await asUser(w.db, U.bob, 'UPDATE deals SET stage_id = $2 WHERE id = $1', [id, s2])
    const [row] = await sql<{ win_probability: string; win_probability_basis: string }>(
      w.db,
      'SELECT win_probability, win_probability_basis FROM deals WHERE id = $1',
      [id],
    )
    expect(Number(row.win_probability)).toBe(0.6)
    expect(row.win_probability_basis).toBe('historico')
  })

  it('the night run writes every chance, only in its own CRM', async () => {
    const [{ id: mine }] = await sql<{ id: string }>(
      w.db,
      `INSERT INTO deals (user_id, account_id, pipeline_id, stage_id, title) VALUES ($1, $2, $3, $4, 'M') RETURNING id`,
      [U.alice, w.A, pipe, s1],
    )
    const [{ n }] = await sql<{ n: number }>(
      w.db,
      `SELECT radar_set_win_probabilities($1, $2::jsonb) AS n`,
      [w.D, JSON.stringify([{ id: mine, p: 0.9, basis: 'historico' }])],
    )
    expect(n).toBe(0)
    await sql(w.db, `SELECT radar_set_win_probabilities($1, $2::jsonb)`, [w.A, JSON.stringify([{ id: mine, p: 0.37, basis: 'fraca' }])])
    const [row] = await sql<{ win_probability: string }>(w.db, 'SELECT win_probability FROM deals WHERE id = $1', [mine])
    expect(Number(row.win_probability)).toBe(0.37)
    expect(await errorCode(asUser(w.db, U.alice, `SELECT radar_set_win_probabilities($1, '[]'::jsonb)`, [w.A]))).toBe('42501')
  })

  it('cooling leads: hot waiting 3 h shows, warm waiting 3 h does not, answered does not', async () => {
    const mk = async (temperature: string, lastFrom: string, minutesAgo: number) => {
      seq++
      const [{ id: c }] = await sql<{ id: string }>(
        w.db,
        `INSERT INTO contacts (user_id, account_id, phone, name, temperature) VALUES ($1, $2, '55119500' || lpad($3::text, 5, '0'), 'Lead ' || $3, $4) RETURNING id`,
        [U.alice, w.A, seq, temperature],
      )
      const [{ id: v }] = await sql<{ id: string }>(
        w.db,
        `INSERT INTO conversations (user_id, account_id, contact_id, status, last_message_at) VALUES ($1, $2, $3, 'open', now() - make_interval(mins => $4)) RETURNING id`,
        [U.alice, w.A, c, minutesAgo],
      )
      await sql(
        w.db,
        `INSERT INTO messages (conversation_id, sender_type, content_text, created_at) VALUES ($1, $2, 'oi', now() - make_interval(mins => $3))`,
        [v, lastFrom, minutesAgo],
      )
      return v
    }
    const hotWaiting = await mk('hot', 'customer', 180)
    await mk('warm', 'customer', 180)
    await mk('hot', 'agent', 180)
    const rows = await sql<{ conversation_id: string; temperature: string }>(w.db, 'SELECT * FROM radar_cooling_leads($1, 30)', [w.A])
    expect(rows.map((r) => r.conversation_id)).toEqual([hotWaiting])
  })
})
