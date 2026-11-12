// ============================================================
// Migration 071 — what is in Google Agenda shows in the CRM (G2), and
// the finishing touches (G3): busy times per agenda, notices when the
// CRM's own events are changed in Google, a dropped connection, and
// the professional's connect link.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'

import { asUser, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

async function connection(w: World, account: string, sub: string) {
  const [row] = await sql<{ id: string }>(
    w.db,
    `INSERT INTO google_connections (account_id, google_sub, email) VALUES ($1, $2, $2 || '@x.com') RETURNING id`,
    [account, sub],
  )
  return row.id
}

const newCalendar = async (w: World, account: string, name: string) =>
  (
    await sql<{ id: string }>(w.db, `INSERT INTO calendars (account_id, name) VALUES ($1, $2) RETURNING id`, [
      account,
      name,
    ])
  )[0].id

const link = (w: World, calendar: string, conn: string, googleCalendar = 'dr@clinica.com') =>
  sql(
    w.db,
    `UPDATE calendars SET google_connection_id = $2, google_calendar_id = $3, google_busy_calendar_ids = ARRAY[$3]
     WHERE id = $1`,
    [calendar, conn, googleCalendar],
  )

const replaceBusy = (w: World, account: string, conn: string, rows: unknown[], googleCalendar = 'dr@clinica.com') =>
  sql(w.db, 'SELECT replace_google_busy($1, $2, $3, $4::jsonb)', [account, conn, googleCalendar, JSON.stringify(rows)])

const busyFor = (w: World, user: string) =>
  asUser<{ s: string }>(
    w.db,
    user,
    `SELECT to_char(starts_at AT TIME ZONE 'UTC', 'DD HH24:MI') AS s FROM calendar_google_busy ORDER BY starts_at`,
  ).then((rows) => rows.map((r) => r.s))

describe('071 — Google busy times per agenda', () => {
  let w: World
  let conn: string
  let cal: string
  beforeAll(async () => {
    w = await buildWorld()
    conn = await connection(w, w.A, 'sub-a')
    cal = await newCalendar(w, w.A, 'Dr. João')
    await link(w, cal, conn)
    await replaceBusy(w, w.A, conn, [
      { google_event_id: 'g1', starts_at: '2030-01-08T15:00:00Z', ends_at: '2030-01-08T16:00:00Z' },
      { google_event_id: 'g2', starts_at: '2030-01-09T15:00:00Z', ends_at: '2030-01-09T16:00:00Z' },
    ])
  })

  it('the whole team sees them on the agenda; another CRM does not', async () => {
    expect(await busyFor(w, U.bob)).toEqual(['08 15:00', '09 15:00'])
    expect(await busyFor(w, U.carol)).toEqual(['08 15:00', '09 15:00'])
    expect(await busyFor(w, U.dave)).toEqual([])
  })

  it('a fresh read replaces the old one', async () => {
    await replaceBusy(w, w.A, conn, [
      { google_event_id: 'g3', starts_at: '2030-01-10T15:00:00Z', ends_at: '2030-01-10T16:00:00Z' },
    ])
    expect(await busyFor(w, U.bob)).toEqual(['10 15:00'])
  })

  it('"Mostrar os compromissos do Google" off: nothing shows', async () => {
    await asUser(w.db, U.alice, 'UPDATE calendars SET google_show_busy = FALSE WHERE id = $1', [cal])
    expect(await busyFor(w, U.bob)).toEqual([])
    await asUser(w.db, U.alice, 'UPDATE calendars SET google_show_busy = TRUE WHERE id = $1', [cal])
    expect(await busyFor(w, U.bob)).toEqual(['10 15:00'])
  })

  it('only the Google calendars the agenda reads count', async () => {
    await replaceBusy(
      w,
      w.A,
      conn,
      [{ google_event_id: 'p1', starts_at: '2030-01-11T15:00:00Z', ends_at: '2030-01-11T16:00:00Z' }],
      'pessoal@group',
    )
    expect(await busyFor(w, U.bob)).toEqual(['10 15:00'])
    await sql(w.db, `UPDATE calendars SET google_busy_calendar_ids = ARRAY['dr@clinica.com', 'pessoal@group'] WHERE id = $1`, [cal])
    expect(await busyFor(w, U.bob)).toEqual(['10 15:00', '11 15:00'])
  })

  it('only the server writes them, and only with the CRM’s own connection', async () => {
    expect(
      await errorCode(asUser(w.db, U.alice, 'SELECT replace_google_busy($1, $2, $3, $4::jsonb)', [w.A, conn, 'x', '[]'])),
    ).toBe('42501')
    // No write policy: a signed-in user's delete touches nothing.
    expect(await asUser(w.db, U.alice, 'DELETE FROM google_busy RETURNING id')).toEqual([])
    expect(await busyFor(w, U.bob)).not.toEqual([])
    expect(await errorCode(replaceBusy(w, w.D, conn, []))).toBe('23503')
  })
})

describe('071 — appointments changed directly in Google', () => {
  let w: World
  let conn: string
  let cal: string
  let event: string
  beforeAll(async () => {
    w = await buildWorld()
    conn = await connection(w, w.A, 'sub-a')
    cal = await newCalendar(w, w.A, 'Dr. João')
    await link(w, cal, conn)
    ;[{ id: event }] = await sql<{ id: string }>(
      w.db,
      `INSERT INTO calendar_events (account_id, calendar_id, starts_at, ends_at, title)
       VALUES ($1, $2, '2030-01-08T13:00:00Z', '2030-01-08T13:30:00Z', 'Consulta') RETURNING id`,
      [w.A, cal],
    )
    // As if the sender had put it in Google.
    await sql(
      w.db,
      `UPDATE calendar_events SET google_event_id = 'hc1', google_calendar_id = 'dr@clinica.com',
         google_connection_id = $2, google_sync_state = 'synced' WHERE id = $1`,
      [event, conn],
    )
  })

  const note = (own: unknown[]) =>
    sql<{ n: number }>(
      w.db,
      `SELECT note_google_remote_changes($1, 'dr@clinica.com', $2::jsonb, '2030-01-01'::timestamptz, '2030-03-01'::timestamptz) AS n`,
      [conn, JSON.stringify(own)],
    ).then((rows) => rows[0].n)
  const notice = async () =>
    (await sql<{ n: string | null }>(w.db, 'SELECT google_remote_notice AS n FROM calendar_events WHERE id = $1', [event]))[0].n
  const bells = (user: string) =>
    sql<{ c: number }>(
      w.db,
      `SELECT count(*)::int AS c FROM notifications WHERE user_id = $1 AND type = 'agenda_google'`,
      [user],
    ).then((rows) => rows[0].c)

  it('as the CRM has it: nothing to say', async () => {
    expect(await note([{ google_event_id: 'hc1', starts_at: '2030-01-08T13:00:00Z', ends_at: '2030-01-08T13:30:00Z' }])).toBe(0)
    expect(await notice()).toBeNull()
  })

  it('moved in Google: a notice, and the bell of whoever books — once', async () => {
    const moved = [{ google_event_id: 'hc1', starts_at: '2030-01-08T18:00:00Z', ends_at: '2030-01-08T18:30:00Z' }]
    expect(await note(moved)).toBe(1)
    // On the agenda's own clock (São Paulo, UTC−3).
    expect(await notice()).toBe('Movido no Google Agenda para 08/01 às 15:00.')
    expect(await bells(U.alice)).toBe(1)
    expect(await bells(U.bob)).toBe(1)
    expect(await bells(U.carol)).toBe(0) // a viewer cannot act on it
    expect(await note(moved)).toBe(0)
    expect(await bells(U.bob)).toBe(1)
  })

  it('deleted in Google: says so', async () => {
    expect(await note([])).toBe(1)
    expect(await notice()).toBe('Apagado no Google Agenda.')
  })

  it('an edit in the CRM clears the notice and sends it to Google again', async () => {
    await asUser(w.db, U.bob, `UPDATE calendar_events SET notes = 'remarcado' WHERE id = $1`, [event])
    const [row] = await sql<{ n: string | null; s: string }>(
      w.db,
      'SELECT google_remote_notice AS n, google_sync_state AS s FROM calendar_events WHERE id = $1',
      [event],
    )
    expect(row).toEqual({ n: null, s: 'pending' })
  })
})

describe('071 — G3', () => {
  let w: World
  let conn: string
  beforeAll(async () => {
    w = await buildWorld()
    conn = await connection(w, w.A, 'sub-a')
  })

  it('a dropped connection is marked once, and only owner and admins hear about it', async () => {
    const drop = () =>
      sql<{ r: boolean }>(w.db, `SELECT google_connection_dropped($1, 'senha trocada') AS r`, [conn]).then(
        (rows) => rows[0].r,
      )
    expect(await drop()).toBe(true)
    expect(await drop()).toBe(false)
    const [row] = await sql<{ s: string }>(w.db, 'SELECT status AS s FROM google_connections WHERE id = $1', [conn])
    expect(row.s).toBe('needs_reconnect')
    const who = await sql<{ user_id: string }>(
      w.db,
      `SELECT user_id FROM notifications WHERE type = 'agenda_google' ORDER BY user_id`,
    )
    expect(who.map((r) => r.user_id)).toContain(U.alice)
    expect(who.map((r) => r.user_id)).not.toContain(U.bob)
    expect(who).toHaveLength(new Set(who.map((r) => r.user_id)).size)
  })

  it('connect links and reads are the server’s only', async () => {
    for (const table of ['google_connect_links', 'google_calendar_reads']) {
      expect(await errorCode(asUser(w.db, U.alice, `SELECT * FROM ${table}`))).toBe('42501')
    }
    expect(
      await errorCode(asUser(w.db, U.alice, `SELECT google_connection_dropped($1, 'x')`, [conn])),
    ).toBe('42501')
  })
})
