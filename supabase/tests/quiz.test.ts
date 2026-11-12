// ============================================================
// Migration 072 — Ferramentas › Quiz e formulários.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'

import { applyMigration, asUser, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

describe('072 — quizzes and their visits', () => {
  let w: World
  let quizA: string
  let quizD: string

  beforeAll(async () => {
    w = await buildWorld()
    const rows = await sql<{ id: string; slug: string }>(
      w.db,
      `INSERT INTO quizzes (account_id, name, slug, status) VALUES
         ('${w.A}', 'Quiz da A', 'quiz-da-a', 'published'),
         ('${w.D}', 'Quiz da D', 'quiz-da-d', 'draft')
       RETURNING id, slug`,
    )
    quizA = rows.find((r) => r.slug === 'quiz-da-a')!.id
    quizD = rows.find((r) => r.slug === 'quiz-da-d')!.id
    await sql(
      w.db,
      `INSERT INTO quiz_sessions (account_id, quiz_id, sid, started_at, completed_at, contact) VALUES
         ('${w.A}', '${quizA}', 'visita-0001', NULL, NULL, '{}'),
         ('${w.A}', '${quizA}', 'visita-0002', NOW(), NULL, '{"name":"Ana"}'),
         ('${w.A}', '${quizA}', 'visita-0003', NOW(), NOW(), '{"name":"Bia","phone":"+5511900000009"}'),
         ('${w.D}', '${quizD}', 'visita-0001', NOW(), NOW(), '{"name":"Duda"}')`,
    )
    await sql(
      w.db,
      `INSERT INTO quiz_secrets (quiz_id, account_id, capi_token) VALUES ('${quizA}', '${w.A}', 'cifrado')`,
    )
    await sql(
      w.db,
      `INSERT INTO quiz_templates (name, definition) VALUES ('Modelo da agência', '{"steps":[]}')`,
    )
  })

  it('members read their CRM only', async () => {
    const names = (u: string) =>
      asUser<{ name: string }>(w.db, u, 'SELECT name FROM quizzes ORDER BY name').then((r) => r.map((x) => x.name))
    expect(await names(U.carol)).toEqual(['Quiz da A'])
    expect(await names(U.dave)).toEqual(['Quiz da D'])
    expect(await names(U.otto)).toEqual([])

    const visits = await asUser<{ sid: string }>(w.db, U.bob, 'SELECT sid FROM quiz_sessions ORDER BY sid')
    expect(visits.map((v) => v.sid)).toEqual(['visita-0001', 'visita-0002', 'visita-0003'])
    expect(await asUser(w.db, U.otto, 'SELECT sid FROM quiz_sessions')).toEqual([])
  })

  it('the totals follow the same walls', async () => {
    const totals = (u: string) =>
      asUser<{ visits: number; started: number; completed: number; leads: number }>(
        w.db,
        u,
        'SELECT visits, started, completed, leads FROM quiz_session_totals',
      )
    expect(await totals(U.alice)).toEqual([{ visits: 3, started: 2, completed: 1, leads: 0 }])
    expect(await totals(U.dave)).toEqual([{ visits: 1, started: 1, completed: 1, leads: 0 }])
    expect(await totals(U.otto)).toEqual([])
  })

  it('nobody writes from a session, not even the owner (service role only)', async () => {
    expect(
      await errorCode(
        asUser(w.db, U.alice, `INSERT INTO quizzes (account_id, name, slug) VALUES ('${w.A}', 'Outro', 'outro-quiz')`),
      ),
    ).toBe('42501')
    expect(await asUser(w.db, U.alice, "UPDATE quizzes SET status = 'paused' RETURNING id")).toEqual([])
    expect(await asUser(w.db, U.alice, 'DELETE FROM quiz_sessions RETURNING id')).toEqual([])
    expect(
      await errorCode(
        asUser(
          w.db,
          U.alice,
          `INSERT INTO quiz_sessions (account_id, quiz_id, sid) VALUES ('${w.A}', '${quizA}', 'forjada-0001')`,
        ),
      ),
    ).toBe('42501')
  })

  it('keeps the Conversions API token out of every session', async () => {
    expect(await errorCode(asUser(w.db, U.alice, 'SELECT capi_token FROM quiz_secrets'))).toBe('42501')
    expect(await errorCode(asUser(w.db, U.agus, 'SELECT capi_token FROM quiz_secrets'))).toBe('42501')
  })

  it('shows the agency models to the agency only', async () => {
    const models = (u: string) =>
      asUser<{ name: string }>(w.db, u, 'SELECT name FROM quiz_templates').then((r) => r.map((x) => x.name))
    expect(await models(U.agus)).toEqual(['Modelo da agência'])
    expect(await models(U.alice)).toEqual([])
  })

  it('gives each address to one quiz, across every CRM', async () => {
    expect(
      await errorCode(
        sql(w.db, `INSERT INTO quizzes (account_id, name, slug) VALUES ('${w.D}', 'Cópia', 'quiz-da-a')`),
      ),
    ).toBe('23505')
  })

  it('refuses an address that is not lowercase letters, digits and hyphens', async () => {
    for (const slug of ['Quiz', 'a', '-abc', 'abc-', 'a b', '../x', 'q/x']) {
      expect(
        await errorCode(
          sql(w.db, `INSERT INTO quizzes (account_id, name, slug) VALUES ('${w.A}', 'X', $1)`, [slug]),
        ),
        slug,
      ).toBe('23514')
    }
  })

  it('counts one visit per browser id per quiz', async () => {
    expect(
      await errorCode(
        sql(w.db, `INSERT INTO quiz_sessions (account_id, quiz_id, sid) VALUES ('${w.A}', '${quizA}', 'visita-0001')`),
      ),
    ).toBe('23505')
  })

  it('a visit outlives the lead it became', async () => {
    const [lead] = await sql<{ id: string }>(
      w.db,
      `INSERT INTO leads (account_id, source) VALUES ('${w.A}', 'quiz-da-a') RETURNING id`,
    )
    await sql(w.db, `UPDATE quiz_sessions SET lead_id = '${lead.id}' WHERE sid = 'visita-0003' AND quiz_id = '${quizA}'`)
    await sql(w.db, `DELETE FROM leads WHERE id = '${lead.id}'`)
    const rows = await sql<{ lead_id: string | null }>(
      w.db,
      `SELECT lead_id FROM quiz_sessions WHERE sid = 'visita-0003' AND quiz_id = '${quizA}'`,
    )
    expect(rows).toEqual([{ lead_id: null }])
  })

  it('is safe to run again', async () => {
    await applyMigration(w.db, '072_ferramentas_quiz.sql')
    const rows = await sql<{ n: number }>(w.db, 'SELECT count(*)::int AS n FROM quiz_sessions')
    expect(rows[0].n).toBe(4)
  })

  it('deleting a quiz takes its visits and its token with it', async () => {
    await sql(w.db, `DELETE FROM quizzes WHERE id = '${quizA}'`)
    const visits = await sql<{ n: number }>(w.db, 'SELECT count(*)::int AS n FROM quiz_sessions')
    const secrets = await sql<{ n: number }>(w.db, 'SELECT count(*)::int AS n FROM quiz_secrets')
    expect(visits[0].n).toBe(1)
    expect(secrets[0].n).toBe(0)
  })
})
