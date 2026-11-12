// ============================================================
// Migration 069 — an agenda writes its events into Google Agenda:
// who sees the connected accounts (and who never sees their secrets),
// which events get queued, and how the sender claims and settles them.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'

import { asUser, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

const FUTURE = '2030-01-08T13:00:00Z'
const FUTURE_END = '2030-01-08T13:30:00Z'

async function connection(w: World, account: string, sub: string, email: string) {
  const [row] = await sql<{ id: string }>(
    w.db,
    `INSERT INTO google_connections (account_id, google_sub, email, scopes)
     VALUES ($1, $2, $3, ARRAY['https://www.googleapis.com/auth/calendar.events.owned'])
     RETURNING id`,
    [account, sub, email],
  )
  await sql(
    w.db,
    `INSERT INTO google_connection_secrets (connection_id, refresh_token) VALUES ($1, 'cifrado')`,
    [row.id],
  )
  return row.id
}

const newCalendar = async (w: World, account: string, name: string) =>
  (
    await sql<{ id: string }>(
      w.db,
      `INSERT INTO calendars (account_id, name) VALUES ($1, $2) RETURNING id`,
      [account, name],
    )
  )[0].id

const link = (w: World, calendar: string, conn: string | null, googleCalendar = 'dr@clinica.com') =>
  sql(
    w.db,
    `UPDATE calendars SET google_connection_id = $2, google_calendar_id = $3 WHERE id = $1`,
    [calendar, conn, conn ? googleCalendar : null],
  )

const book = async (w: World, user: string, account: string, calendar: string, start = FUTURE, end = FUTURE_END) =>
  (
    await asUser<{ id: string }>(
      w.db,
      user,
      `INSERT INTO calendar_events (account_id, calendar_id, starts_at, ends_at, kind, status, created_by)
       VALUES ($1, $2, $3::timestamptz, $4::timestamptz, 'block', 'scheduled', auth.uid())
       RETURNING id`,
      [account, calendar, start, end],
    )
  )[0].id

const syncState = async (w: World, event: string) =>
  (
    await sql<{ s: string | null }>(w.db, 'SELECT google_sync_state AS s FROM calendar_events WHERE id = $1', [
      event,
    ])
  )[0].s

interface Claimed {
  event_id: string
  claimed_at: string
  target_connection_id: string | null
  target_calendar_id: string | null
  target_connection_status: string | null
  calendar_name: string
}

const claim = (w: World, event: string | null = null) =>
  sql<Claimed>(w.db, 'SELECT * FROM claim_google_event_sync(50, $1)', [event])

const finish = (
  w: World,
  event: string,
  claimedAt: string,
  googleId: string | null,
  conn: string | null,
  error: string | null = null,
  retry = true,
) =>
  sql(w.db, 'SELECT finish_google_event_sync($1, $2::timestamptz, $3, $4, $5, $6, $7)', [
    event,
    claimedAt,
    googleId,
    googleId ? 'dr@clinica.com' : null,
    conn,
    error,
    retry,
  ])

describe('069 — connected Google accounts', () => {
  let w: World
  let conn: string
  let foreign: string
  let cal: string
  beforeAll(async () => {
    w = await buildWorld()
    conn = await connection(w, w.A, 'sub-a', 'dr@clinica.com')
    foreign = await connection(w, w.D, 'sub-d', 'outro@clinica.com')
    cal = await newCalendar(w, w.A, 'Dr. João')
  })

  it('the team sees which account is connected; another CRM does not', async () => {
    const emails = (user: string) =>
      asUser<{ email: string }>(w.db, user, 'SELECT email FROM google_connections ORDER BY email').then(
        (rows) => rows.map((r) => r.email),
      )
    expect(await emails(U.bob)).toEqual(['dr@clinica.com'])
    expect(await emails(U.carol)).toEqual(['dr@clinica.com'])
    expect(await emails(U.dave)).toEqual(['outro@clinica.com'])
  })

  it('nobody signed in reads or writes the tokens, the sign-in requests or the removals', async () => {
    for (const table of ['google_connection_secrets', 'google_oauth_requests', 'google_event_deletions']) {
      expect(await errorCode(asUser(w.db, U.alice, `SELECT * FROM ${table}`))).toBe('42501')
    }
  })

  it('only the server writes connections', async () => {
    expect(
      await errorCode(
        asUser(
          w.db,
          U.alice,
          `INSERT INTO google_connections (account_id, google_sub, email) VALUES ($1, 'x', 'x@x.com')`,
          [w.A],
        ),
      ),
    ).toBe('42501')
    expect(
      await asUser(w.db, U.alice, `UPDATE google_connections SET status = 'connected' RETURNING id`),
    ).toEqual([])
  })

  it('an admin cannot point an agenda at another CRM’s account', async () => {
    expect(
      await errorCode(
        asUser(w.db, U.alice, `UPDATE calendars SET google_connection_id = $2, google_calendar_id = 'x' WHERE id = $1`, [
          cal,
          foreign,
        ]),
      ),
    ).toBe('23503')
  })

  it('an admin links an agenda from their own session, and its upcoming events are queued', async () => {
    const event = await book(w, U.bob, w.A, cal)
    expect(await syncState(w, event)).toBeNull()
    await asUser(
      w.db,
      U.alice,
      `UPDATE calendars SET google_connection_id = $2, google_calendar_id = 'dr@clinica.com' WHERE id = $1`,
      [cal, conn],
    )
    expect(await syncState(w, event)).toBe('pending')
    // An agent cannot (calendars are admins'): nothing happens.
    expect(
      await asUser(w.db, U.bob, `UPDATE calendars SET google_connection_id = NULL WHERE id = $1 RETURNING id`, [cal]),
    ).toEqual([])
  })

  it('no account, no Google calendar: the pair stays consistent', async () => {
    await link(w, cal, conn)
    await sql(w.db, `UPDATE calendars SET google_calendar_name = 'Principal' WHERE id = $1`, [cal])
    await link(w, cal, null)
    const [row] = await sql<{ g: string | null; n: string | null }>(
      w.db,
      'SELECT google_calendar_id AS g, google_calendar_name AS n FROM calendars WHERE id = $1',
      [cal],
    )
    expect(row).toEqual({ g: null, n: null })
  })
})

describe('069 — what gets queued for Google', () => {
  let w: World
  let conn: string
  let linked: string
  let plain: string
  beforeAll(async () => {
    w = await buildWorld()
    conn = await connection(w, w.A, 'sub-a', 'dr@clinica.com')
    linked = await newCalendar(w, w.A, 'Dr. João')
    plain = await newCalendar(w, w.A, 'Sala 2')
    await link(w, linked, conn)
  })

  it('booked on an agenda that writes to Google: queued; on one that does not: left alone', async () => {
    expect(await syncState(w, await book(w, U.bob, w.A, linked))).toBe('pending')
    expect(await syncState(w, await book(w, U.bob, w.A, plain, '2030-01-09T13:00Z', '2030-01-09T13:30Z'))).toBeNull()
  })

  it('the sender claims it once, with where its agenda writes', async () => {
    const rows = await claim(w)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      target_connection_id: conn,
      target_calendar_id: 'dr@clinica.com',
      target_connection_status: 'connected',
      calendar_name: 'Dr. João',
    })
    expect(await claim(w)).toEqual([])
  })

  it('a run that died is picked up again after 10 minutes', async () => {
    const event = await book(w, U.bob, w.A, linked, '2030-01-10T13:00Z', '2030-01-10T13:30Z')
    const [first] = await claim(w, event)
    expect(first.event_id).toBe(event)
    await sql(
      w.db,
      `UPDATE calendar_events SET google_sync_claimed_at = NOW() - INTERVAL '11 minutes' WHERE id = $1`,
      [event],
    )
    expect((await claim(w, event)).map((r) => r.event_id)).toEqual([event])
  })

  it('a finished send is "synced", and its own write does not queue it again', async () => {
    const event = await book(w, U.bob, w.A, linked, '2030-01-11T13:00Z', '2030-01-11T13:30Z')
    const [row] = await claim(w, event)
    await finish(w, event, row.claimed_at, 'hc1', conn)
    expect(await syncState(w, event)).toBe('synced')
    const [stored] = await sql<{ g: string; c: string }>(
      w.db,
      'SELECT google_event_id AS g, google_connection_id AS c FROM calendar_events WHERE id = $1',
      [event],
    )
    expect(stored).toEqual({ g: 'hc1', c: conn })
  })

  it('edited while being sent: the new version stays queued, the Google id is kept', async () => {
    const event = await book(w, U.bob, w.A, linked, '2030-01-12T13:00Z', '2030-01-12T13:30Z')
    const [row] = await claim(w, event)
    await asUser(w.db, U.bob, `UPDATE calendar_events SET notes = 'mudou' WHERE id = $1`, [event])
    await finish(w, event, row.claimed_at, 'hc2', conn)
    expect(await syncState(w, event)).toBe('pending')
    const [stored] = await sql<{ g: string }>(w.db, 'SELECT google_event_id AS g FROM calendar_events WHERE id = $1', [
      event,
    ])
    expect(stored.g).toBe('hc2')
  })

  it('a failure is retried later, up to five times; one that cannot work is not', async () => {
    const event = await book(w, U.bob, w.A, linked, '2030-01-13T13:00Z', '2030-01-13T13:30Z')
    let [row] = await claim(w, event)
    await finish(w, event, row.claimed_at, null, null, 'Google ocupado', true)
    const [after] = await sql<{ s: string; a: number; later: boolean }>(
      w.db,
      `SELECT google_sync_state AS s, google_sync_attempts AS a, google_sync_next_at > NOW() AS later
       FROM calendar_events WHERE id = $1`,
      [event],
    )
    expect(after).toEqual({ s: 'error', a: 1, later: true })
    expect(await claim(w, event)).toEqual([]) // not yet

    await sql(w.db, 'UPDATE calendar_events SET google_sync_next_at = NOW() WHERE id = $1', [event])
    ;[row] = await claim(w, event)
    await finish(w, event, row.claimed_at, null, null, 'Sem acesso', false)
    await sql(w.db, 'UPDATE calendar_events SET google_sync_next_at = NOW() WHERE id = $1', [event])
    expect(await claim(w, event)).toEqual([])
  })

  it('bookkeeping writes (the WhatsApp stamps) do not queue an event', async () => {
    const event = await book(w, U.bob, w.A, linked, '2030-01-14T13:00Z', '2030-01-14T13:30Z')
    const [row] = await claim(w, event)
    await finish(w, event, row.claimed_at, 'hc3', conn)
    await sql(w.db, 'UPDATE calendar_events SET reminder_at = NOW() WHERE id = $1', [event])
    expect(await syncState(w, event)).toBe('synced')
  })

  it('deleted in the CRM: what was in Google is queued for removal', async () => {
    const event = await book(w, U.bob, w.A, linked, '2030-01-15T13:00Z', '2030-01-15T13:30Z')
    const [row] = await claim(w, event)
    await finish(w, event, row.claimed_at, 'hc4', conn)
    await asUser(w.db, U.bob, 'DELETE FROM calendar_events WHERE id = $1', [event])
    expect(
      await sql(w.db, 'SELECT connection_id, google_event_id FROM google_event_deletions'),
    ).toEqual([{ connection_id: conn, google_event_id: 'hc4' }])
  })
})

describe('069 — pointing an agenda somewhere else', () => {
  let w: World
  let conn: string
  let cal: string
  let upcoming: string
  let past: string
  beforeAll(async () => {
    w = await buildWorld()
    conn = await connection(w, w.A, 'sub-a', 'dr@clinica.com')
    cal = await newCalendar(w, w.A, 'Dr. João')
    upcoming = await book(w, U.bob, w.A, cal)
    past = await book(w, U.bob, w.A, cal, '2020-01-08T13:00Z', '2020-01-08T13:30Z')
  })

  it('linking it queues its upcoming events, not the past', async () => {
    expect(await syncState(w, upcoming)).toBeNull()
    await link(w, cal, conn)
    expect(await syncState(w, upcoming)).toBe('pending')
    expect(await syncState(w, past)).toBeNull()
  })

  it('removing the account unlinks the agenda and drops its pending removals', async () => {
    const [row] = await claim(w, upcoming)
    await finish(w, upcoming, row.claimed_at, 'hc1', conn)
    await sql(
      w.db,
      `INSERT INTO google_event_deletions (account_id, connection_id, google_calendar_id, google_event_id)
       VALUES ($1, $2, 'primary', 'hcx')`,
      [w.A, conn],
    )
    await sql(w.db, 'DELETE FROM google_connections WHERE id = $1', [conn])

    const [calendar] = await sql<{ c: string | null }>(
      w.db,
      'SELECT google_connection_id AS c FROM calendars WHERE id = $1',
      [cal],
    )
    expect(calendar.c).toBeNull()
    const [event] = await sql<{ c: string | null; s: string | null }>(
      w.db,
      'SELECT google_connection_id AS c, google_sync_state AS s FROM calendar_events WHERE id = $1',
      [upcoming],
    )
    // Queued so the sender forgets the now-unreachable Google copy.
    expect(event).toEqual({ c: null, s: 'pending' })
    expect(await sql(w.db, 'SELECT id FROM google_event_deletions')).toEqual([])
    expect(await sql(w.db, 'SELECT connection_id FROM google_connection_secrets')).toEqual([])
  })

  it('google_mark_for_sync is the server’s only', async () => {
    expect(
      await errorCode(asUser(w.db, U.alice, 'SELECT google_mark_for_sync($1, NULL)', [cal])),
    ).toBe('42501')
    expect(await errorCode(asUser(w.db, U.alice, 'SELECT * FROM claim_google_event_sync(5, NULL)'))).toBe('42501')
  })
})
