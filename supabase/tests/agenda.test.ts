// ============================================================
// Migration 067 — the CRM's own agenda: one per professional, opening
// hours, appointments and blocks, and no two bookings in one slot.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'

import { applyMigration, asUser, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

const M067 = '067_agenda.sql'

const contactId = async (w: World, name: string) =>
  (await sql<{ id: string }>(w.db, 'SELECT id FROM contacts WHERE name = $1', [name]))[0].id

const newCalendar = (w: World, user: string, account: string, name: string) =>
  asUser<{ id: string }>(
    w.db,
    user,
    `INSERT INTO calendars (account_id, name, created_by)
     VALUES ($1, $2, auth.uid()) RETURNING id`,
    [account, name],
  )

const book = (
  w: World,
  user: string,
  account: string,
  calendar: string,
  start: string,
  end: string,
  extra: { contact?: string | null; kind?: string; status?: string } = {},
) =>
  asUser<{ id: string }>(
    w.db,
    user,
    `INSERT INTO calendar_events
       (account_id, calendar_id, starts_at, ends_at, contact_id, kind, status, created_by)
     VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7, auth.uid())
     RETURNING id`,
    [
      account,
      calendar,
      start,
      end,
      extra.contact ?? null,
      extra.kind ?? 'appointment',
      extra.status ?? 'scheduled',
    ],
  )

describe('067 — who creates agendas and sets their hours', () => {
  let w: World
  let cal: string
  beforeAll(async () => {
    w = await buildWorld()
  })

  const names = (user: string) =>
    asUser<{ name: string }>(w.db, user, 'SELECT name FROM calendars ORDER BY name').then((rows) =>
      rows.map((r) => r.name),
    )
  const hours = (user: string) =>
    asUser<{ weekday: number; starts: string; ends: string }>(
      w.db,
      user,
      'SELECT weekday, starts::text, ends::text FROM calendar_hours ORDER BY weekday, starts',
    )

  it('an admin creates one and the whole team sees it', async () => {
    cal = (await newCalendar(w, U.alice, w.A, 'Dr. João'))[0].id
    expect(await names(U.bob)).toEqual(['Dr. João'])
    expect(await names(U.carol)).toEqual(['Dr. João']) // viewer
  })

  it('agents and viewers cannot create, rename or delete an agenda', async () => {
    expect(await errorCode(newCalendar(w, U.bob, w.A, 'Do agente'))).toBe('42501')
    expect(await errorCode(newCalendar(w, U.carol, w.A, 'Do leitor'))).toBe('42501')
    expect(
      await asUser(w.db, U.bob, `UPDATE calendars SET name = 'Outro' RETURNING id`),
    ).toEqual([])
    expect(await asUser(w.db, U.bob, 'DELETE FROM calendars RETURNING id')).toEqual([])
  })

  it('another CRM sees nothing and cannot write into this one', async () => {
    expect(await names(U.dave)).toEqual([])
    expect(await errorCode(newCalendar(w, U.dave, w.A, 'De fora'))).toBe('42501')
    expect(await names(U.otto)).toEqual([])
  })

  it('refuses a blank name, a bad colour and an absurd slot', async () => {
    expect(await errorCode(newCalendar(w, U.alice, w.A, '   '))).toBe('23514')
    expect(
      await errorCode(
        asUser(w.db, U.alice, `UPDATE calendars SET color = 'azul' WHERE id = $1`, [cal]),
      ),
    ).toBe('23514')
    expect(
      await errorCode(
        asUser(w.db, U.alice, `UPDATE calendars SET slot_minutes = 0 WHERE id = $1`, [cal]),
      ),
    ).toBe('23514')
  })

  it('an admin sets the week, lunch break included', async () => {
    await asUser(w.db, U.alice, 'SELECT set_calendar_hours($1, $2::jsonb)', [
      cal,
      JSON.stringify([
        { weekday: 1, starts: '08:00', ends: '12:00' },
        { weekday: 1, starts: '14:00', ends: '18:00' },
        { weekday: 3, starts: '09:00', ends: '13:00' },
      ]),
    ])
    expect(await hours(U.carol)).toEqual([
      { weekday: 1, starts: '08:00:00', ends: '12:00:00' },
      { weekday: 1, starts: '14:00:00', ends: '18:00:00' },
      { weekday: 3, starts: '09:00:00', ends: '13:00:00' },
    ])
  })

  it('saving again replaces the week instead of adding to it', async () => {
    await asUser(w.db, U.alice, 'SELECT set_calendar_hours($1, $2::jsonb)', [
      cal,
      JSON.stringify([{ weekday: 5, starts: '10:00', ends: '16:00' }]),
    ])
    expect(await hours(U.alice)).toEqual([{ weekday: 5, starts: '10:00:00', ends: '16:00:00' }])
  })

  it('a bad week changes nothing', async () => {
    // Ends before it starts: the insert fails, and the delete with it.
    expect(
      await errorCode(
        asUser(w.db, U.alice, 'SELECT set_calendar_hours($1, $2::jsonb)', [
          cal,
          JSON.stringify([{ weekday: 2, starts: '18:00', ends: '08:00' }]),
        ]),
      ),
    ).toBe('23514')
    expect(await hours(U.alice)).toEqual([{ weekday: 5, starts: '10:00:00', ends: '16:00:00' }])
  })

  it('an agent cannot set the hours, nor can another CRM', async () => {
    const week = JSON.stringify([{ weekday: 1, starts: '08:00', ends: '12:00' }])
    expect(
      await errorCode(asUser(w.db, U.bob, 'SELECT set_calendar_hours($1, $2::jsonb)', [cal, week])),
    ).toBe('42501')
    expect(
      await errorCode(asUser(w.db, U.dave, 'SELECT set_calendar_hours($1, $2::jsonb)', [cal, week])),
    ).toBe('42501')
    expect(await hours(U.alice)).toEqual([{ weekday: 5, starts: '10:00:00', ends: '16:00:00' }])
  })
})

describe('067 — booking', () => {
  let w: World
  let cal: string
  let other: string
  let ana: string
  let duda: string
  beforeAll(async () => {
    w = await buildWorld()
    cal = (await newCalendar(w, U.alice, w.A, 'Dr. João'))[0].id
    other = (await newCalendar(w, U.alice, w.A, 'Dra. Lia'))[0].id
    ana = await contactId(w, 'Ana')
    duda = await contactId(w, 'Duda')
  })

  const starts = (user: string) =>
    asUser<{ s: string }>(
      w.db,
      user,
      `SELECT to_char(starts_at AT TIME ZONE 'UTC', 'DD HH24:MI') AS s
       FROM calendar_events ORDER BY starts_at`,
    ).then((rows) => rows.map((r) => r.s))

  it('an agent books and the whole team sees it', async () => {
    await book(w, U.bob, w.A, cal, '2030-01-07T13:00Z', '2030-01-07T13:30Z', { contact: ana })
    expect(await starts(U.alice)).toEqual(['07 13:00'])
    expect(await starts(U.carol)).toEqual(['07 13:00']) // viewer
  })

  it('a viewer reads but cannot book, move or delete', async () => {
    expect(
      await errorCode(book(w, U.carol, w.A, cal, '2030-01-07T15:00Z', '2030-01-07T15:30Z')),
    ).toBe('42501')
    expect(
      await asUser(w.db, U.carol, `UPDATE calendar_events SET status = 'cancelled' RETURNING id`),
    ).toEqual([])
    expect(await asUser(w.db, U.carol, 'DELETE FROM calendar_events RETURNING id')).toEqual([])
  })

  it('another CRM sees nothing and cannot book into this one', async () => {
    expect(await starts(U.dave)).toEqual([])
    expect(
      await errorCode(book(w, U.dave, w.A, cal, '2030-01-07T16:00Z', '2030-01-07T16:30Z')),
    ).toBe('42501')
  })

  it('refuses two bookings in the same slot of one agenda', async () => {
    expect(
      await errorCode(book(w, U.bob, w.A, cal, '2030-01-07T13:15Z', '2030-01-07T13:45Z')),
    ).toBe('23P01')
    // Even one that only swallows it.
    expect(
      await errorCode(book(w, U.bob, w.A, cal, '2030-01-07T12:00Z', '2030-01-07T15:00Z')),
    ).toBe('23P01')
  })

  it('back to back is fine, and so is the same time on another agenda', async () => {
    await book(w, U.bob, w.A, cal, '2030-01-07T13:30Z', '2030-01-07T14:00Z')
    await book(w, U.bob, w.A, other, '2030-01-07T13:00Z', '2030-01-07T13:30Z')
    expect(await starts(U.alice)).toEqual(['07 13:00', '07 13:00', '07 13:30'])
  })

  it('cancelling frees the slot', async () => {
    await asUser(
      w.db,
      U.bob,
      `UPDATE calendar_events SET status = 'cancelled'
       WHERE calendar_id = $1 AND starts_at = '2030-01-07T13:00Z'`,
      [cal],
    )
    await book(w, U.bob, w.A, cal, '2030-01-07T13:00Z', '2030-01-07T13:30Z', { contact: ana })
    // And the cancelled one cannot come back on top of the new one.
    expect(
      await errorCode(
        asUser(
          w.db,
          U.bob,
          `UPDATE calendar_events SET status = 'scheduled'
           WHERE calendar_id = $1 AND status = 'cancelled'`,
          [cal],
        ),
      ),
    ).toBe('23P01')
  })

  it('a block takes the slot like an appointment does', async () => {
    await book(w, U.bob, w.A, cal, '2030-01-08T00:00Z', '2030-01-09T00:00Z', { kind: 'block' })
    expect(
      await errorCode(book(w, U.bob, w.A, cal, '2030-01-08T13:00Z', '2030-01-08T13:30Z')),
    ).toBe('23P01')
    // A block is about the agenda, not a person.
    expect(
      await errorCode(
        book(w, U.bob, w.A, cal, '2030-01-10T00:00Z', '2030-01-11T00:00Z', {
          kind: 'block',
          contact: ana,
        }),
      ),
    ).toBe('23514')
  })

  it('refuses an appointment that ends before it starts', async () => {
    expect(
      await errorCode(book(w, U.bob, w.A, cal, '2030-01-09T14:00Z', '2030-01-09T13:00Z')),
    ).toBe('23514')
  })

  it('refuses a contact or an agenda of another CRM', async () => {
    expect(
      await errorCode(
        book(w, U.bob, w.A, cal, '2030-01-09T15:00Z', '2030-01-09T15:30Z', { contact: duda }),
      ),
    ).toBe('23503')
    // Service role, so RLS is not what stops it.
    expect(
      await errorCode(
        sql(
          w.db,
          `INSERT INTO calendar_events (account_id, calendar_id, starts_at, ends_at, contact_id)
           VALUES ($1, $2, '2030-01-09T15:00Z', '2030-01-09T15:30Z', $3)`,
          [w.A, cal, duda],
        ),
      ),
    ).toBe('23503')
    expect(
      await errorCode(
        sql(
          w.db,
          `INSERT INTO calendar_events (account_id, calendar_id, starts_at, ends_at)
           VALUES ($1, $2, '2030-01-09T16:00Z', '2030-01-09T16:30Z')`,
          [w.D, cal],
        ),
      ),
    ).toBe('23503')
  })

  it('deleting the contact keeps the slot taken', async () => {
    await sql(w.db, 'DELETE FROM contacts WHERE id = $1', [ana])
    const rows = await sql<{ contact_id: string | null }>(
      w.db,
      `SELECT contact_id FROM calendar_events
       WHERE calendar_id = $1 AND starts_at = '2030-01-07T13:00Z' AND status <> 'cancelled'`,
      [cal],
    )
    expect(rows).toEqual([{ contact_id: null }])
  })

  it('deleting the agenda takes its hours and events with it', async () => {
    await asUser(w.db, U.alice, 'SELECT set_calendar_hours($1, $2::jsonb)', [
      other,
      JSON.stringify([{ weekday: 1, starts: '08:00', ends: '12:00' }]),
    ])
    await asUser(w.db, U.alice, 'DELETE FROM calendars WHERE id = $1', [other])
    expect(await sql(w.db, 'SELECT 1 FROM calendar_hours WHERE calendar_id = $1', [other])).toEqual(
      [],
    )
    expect(
      await sql(w.db, 'SELECT 1 FROM calendar_events WHERE calendar_id = $1', [other]),
    ).toEqual([])
  })
})

describe('067 — applying it twice', () => {
  it('is idempotent and keeps what was there', async () => {
    const w = await buildWorld()
    const cal = (await newCalendar(w, U.alice, w.A, 'Dr. João'))[0].id
    await book(w, U.bob, w.A, cal, '2030-01-07T13:00Z', '2030-01-07T13:30Z')
    await applyMigration(w.db, M067)
    expect(await sql(w.db, 'SELECT name FROM calendars')).toEqual([{ name: 'Dr. João' }])
    expect(
      await errorCode(book(w, U.bob, w.A, cal, '2030-01-07T13:00Z', '2030-01-07T13:30Z')),
    ).toBe('23P01')
  })
})

describe('067 — telling the customer', () => {
  let w: World
  let cal: string
  let ana: string
  beforeAll(async () => {
    w = await buildWorld()
    cal = (await newCalendar(w, U.alice, w.A, 'Dr. João'))[0].id
    ana = await contactId(w, 'Ana')
  })

  type Claim = { event_id: string; notification: string; calendar_name: string; message_text: string | null }
  const claim = (eventId: string | null = null) =>
    sql<Claim>(w.db, 'SELECT * FROM claim_calendar_notifications(50, $1)', [eventId])
  const kinds = async (eventId: string | null = null) =>
    (await claim(eventId)).map((c) => c.notification)
  const setCalendar = (set: string) => sql(w.db, `UPDATE calendars SET ${set} WHERE id = $1`, [cal])
  /** An appointment `hoursAhead` from now, whose time was set `setHoursAgo` ago. */
  const appointment = async (
    hoursAhead: number,
    setHoursAgo = 0,
    extra: { contact?: string | null; notify?: boolean } = {},
  ) => {
    const rows = await sql<{ id: string }>(
      w.db,
      `INSERT INTO calendar_events (account_id, calendar_id, contact_id, notify, starts_at, ends_at, time_set_at)
       VALUES ($1, $2, $3, $4,
               NOW() + make_interval(hours => $5),
               NOW() + make_interval(hours => $5, mins => 30),
               NOW() - make_interval(hours => $6))
       RETURNING id`,
      [w.A, cal, extra.contact === undefined ? ana : extra.contact, extra.notify ?? true, hoursAhead, setHoursAgo],
    )
    return rows[0].id
  }
  const clear = () => sql(w.db, 'DELETE FROM calendar_events')

  it('says nothing while the agenda has its messages off', async () => {
    await appointment(48)
    await appointment(2, 30)
    expect(await claim()).toEqual([])
    await clear()
  })

  it('confirms a fresh booking once, with the agenda’s own wording', async () => {
    await setCalendar(`confirm_enabled = TRUE, confirm_text = 'Marcado, {nome}!'`)
    const id = await appointment(48)
    const first = await claim()
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({
      event_id: id,
      notification: 'confirmation',
      calendar_name: 'Dr. João',
      message_text: 'Marcado, {nome}!',
    })
    expect(await claim()).toEqual([])
    await clear()
  })

  it('does not confirm what was booked before the option was on', async () => {
    await appointment(48, 2) // its time was set two hours ago
    expect(await claim()).toEqual([])
    await clear()
  })

  it('leaves out blocks, no contact, no-notify, cancelled and past ones', async () => {
    await appointment(48, 0, { contact: null })
    await appointment(49, 0, { notify: false })
    const cancelled = await appointment(50)
    await sql(w.db, `UPDATE calendar_events SET status = 'cancelled' WHERE id = $1`, [cancelled])
    await sql(
      w.db,
      `INSERT INTO calendar_events (account_id, calendar_id, kind, starts_at, ends_at)
       VALUES ($1, $2, 'block', NOW() + INTERVAL '60 hours', NOW() + INTERVAL '61 hours')`,
      [w.A, cal],
    )
    await sql(
      w.db,
      `INSERT INTO calendar_events (account_id, calendar_id, contact_id, starts_at, ends_at)
       VALUES ($1, $2, $3, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour')`,
      [w.A, cal, ana],
    )
    expect(await claim()).toEqual([])
    await clear()
  })

  it('moving an appointment confirms it again', async () => {
    const id = await appointment(48)
    expect(await kinds()).toEqual(['confirmation'])
    // Same time: nothing new to say.
    await asUser(w.db, U.bob, `UPDATE calendar_events SET title = 'Retorno' WHERE id = $1`, [id])
    expect(await kinds()).toEqual([])
    await asUser(
      w.db,
      U.bob,
      `UPDATE calendar_events SET starts_at = starts_at + INTERVAL '1 day', ends_at = ends_at + INTERVAL '1 day' WHERE id = $1`,
      [id],
    )
    expect(await kinds()).toEqual(['confirmation'])
    await clear()
  })

  it('un-cancelling confirms it again too', async () => {
    const id = await appointment(48)
    await claim()
    await asUser(w.db, U.bob, `UPDATE calendar_events SET status = 'cancelled' WHERE id = $1`, [id])
    await asUser(w.db, U.bob, `UPDATE calendar_events SET status = 'scheduled' WHERE id = $1`, [id])
    expect(await kinds()).toEqual(['confirmation'])
    await clear()
  })

  it('reminds inside the window, once, if it was booked before it opened', async () => {
    await setCalendar(`confirm_enabled = FALSE, reminder_enabled = TRUE, reminder_hours = 24`)
    const soon = await appointment(20, 30) // 20h to go, booked 30h ago
    await appointment(40, 30) // not yet inside the window
    await appointment(3, 1) // booked inside the window: no reminder
    const got = await claim()
    expect(got.map((c) => [c.event_id, c.notification])).toEqual([[soon, 'reminder']])
    expect(await claim()).toEqual([])
    await clear()
  })

  it('the window follows the agenda’s own number of hours', async () => {
    await setCalendar(`reminder_hours = 48`)
    await appointment(40, 60)
    expect(await kinds()).toEqual(['reminder'])
    await clear()
  })

  it('can be narrowed to one appointment', async () => {
    await setCalendar(`confirm_enabled = TRUE`)
    const one = await appointment(72)
    const two = await appointment(73)
    expect((await claim(one)).map((c) => c.event_id)).toEqual([one])
    expect((await claim()).map((c) => c.event_id)).toEqual([two])
    await clear()
  })

  it('is the scheduler’s, not a signed-in person’s', async () => {
    expect(
      await errorCode(asUser(w.db, U.alice, 'SELECT * FROM claim_calendar_notifications(50, NULL)')),
    ).toBe('42501')
  })
})

describe('067 — what an AI agent reserved, waiting for a person', () => {
  let w: World
  let cal: string
  let ana: string
  beforeAll(async () => {
    w = await buildWorld()
    cal = (await newCalendar(w, U.alice, w.A, 'Dr. João'))[0].id
    ana = await contactId(w, 'Ana')
  })

  /** A pending appointment 48h ahead plus its request in the queue, as the agent writes them. */
  const reserve = async (hoursAhead = 48) => {
    const event = (
      await sql<{ id: string }>(
        w.db,
        `INSERT INTO calendar_events (account_id, calendar_id, contact_id, status, starts_at, ends_at)
         VALUES ($1, $2, $3, 'pending', NOW() + make_interval(hours => $4), NOW() + make_interval(hours => $4, mins => 30))
         RETURNING id`,
        [w.A, cal, ana, hoursAhead],
      )
    )[0].id
    const approval = (
      await sql<{ id: string }>(
        w.db,
        `INSERT INTO agent_approvals (account_id, agent_name_snapshot, contact_id, kind, summary, payload)
         VALUES ($1, 'Recepção', $2, 'schedule_meeting', 'Marcar Ana', jsonb_build_object('event_id', $3::text))
         RETURNING id`,
        [w.A, ana, event],
      )
    )[0].id
    return { event, approval }
  }
  const approvalOf = async (id: string) =>
    (
      await sql<{ status: string; decided_by: string | null }>(
        w.db,
        'SELECT status, decided_by FROM agent_approvals WHERE id = $1',
        [id],
      )
    )[0]
  const claimed = async () =>
    (
      await sql<{ event_id: string; notification: string }>(
        w.db,
        'SELECT * FROM claim_calendar_notifications(50, NULL)',
      )
    ).map((c) => [c.event_id, c.notification])
  const clear = () => sql(w.db, 'DELETE FROM calendar_events')

  it('holds the slot and tells the customer nothing', async () => {
    await sql(w.db, `UPDATE calendars SET confirm_enabled = TRUE, reminder_enabled = TRUE WHERE id = $1`, [cal])
    const { event } = await reserve()
    expect(await claimed()).toEqual([])
    const taken = await sql<{ starts_at: string; ends_at: string }>(
      w.db,
      'SELECT starts_at::text, ends_at::text FROM calendar_events WHERE id = $1',
      [event],
    )
    expect(
      await errorCode(book(w, U.bob, w.A, cal, taken[0].starts_at, taken[0].ends_at)),
    ).toBe('23P01')
    await clear()
  })

  it('a person approving on the agenda confirms it and answers the queue', async () => {
    const { event, approval } = await reserve()
    await asUser(w.db, U.bob, `UPDATE calendar_events SET status = 'scheduled' WHERE id = $1`, [event])
    expect(await approvalOf(approval)).toEqual({ status: 'approved', decided_by: U.bob })
    expect(await claimed()).toEqual([[event, 'confirmation']])
    await clear()
  })

  it('an approved one is confirmed even on an agenda that does not confirm', async () => {
    await sql(w.db, `UPDATE calendars SET confirm_enabled = FALSE, reminder_enabled = FALSE WHERE id = $1`, [cal])
    const { event } = await reserve()
    await asUser(w.db, U.bob, `UPDATE calendar_events SET status = 'scheduled' WHERE id = $1`, [event])
    expect(await claimed()).toEqual([[event, 'confirmation']])
    // Moved afterwards by a person: back to the agenda's own rule.
    await asUser(
      w.db,
      U.bob,
      `UPDATE calendar_events SET starts_at = starts_at + INTERVAL '1 day', ends_at = ends_at + INTERVAL '1 day' WHERE id = $1`,
      [event],
    )
    expect(await claimed()).toEqual([])
    await clear()
  })

  it('refusing frees the slot, rejects the request and says nothing', async () => {
    await sql(w.db, `UPDATE calendars SET confirm_enabled = TRUE WHERE id = $1`, [cal])
    const { event, approval } = await reserve()
    await asUser(w.db, U.bob, `UPDATE calendar_events SET status = 'cancelled' WHERE id = $1`, [event])
    expect(await approvalOf(approval)).toEqual({ status: 'rejected', decided_by: U.bob })
    expect(await claimed()).toEqual([])
    await clear()
  })

  it('only that appointment’s own pending request is answered', async () => {
    const one = await reserve(48)
    const two = await reserve(72)
    await asUser(w.db, U.bob, `UPDATE calendar_events SET status = 'scheduled' WHERE id = $1`, [one.event])
    expect((await approvalOf(one.approval)).status).toBe('approved')
    expect((await approvalOf(two.approval)).status).toBe('pending')
    await clear()
  })

  it('a viewer cannot approve', async () => {
    const { event, approval } = await reserve()
    expect(
      await asUser(w.db, U.carol, `UPDATE calendar_events SET status = 'scheduled' WHERE id = $1 RETURNING id`, [event]),
    ).toEqual([])
    expect((await approvalOf(approval)).status).toBe('pending')
  })
})

describe('067 — the public link, the feed and agendas in templates', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  it('an agenda is born with both doors shut and a token for each', async () => {
    await newCalendar(w, U.alice, w.A, 'Dr. João')
    await newCalendar(w, U.alice, w.A, 'Dra. Lia')
    const rows = await sql<{
      public_enabled: boolean
      public_auto_confirm: boolean
      feed_enabled: boolean
      public_token: string
      feed_token: string
    }>(w.db, 'SELECT public_enabled, public_auto_confirm, feed_enabled, public_token, feed_token FROM calendars')
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row).toMatchObject({ public_enabled: false, public_auto_confirm: true, feed_enabled: false })
      expect(row.public_token).toMatch(/^[0-9a-f]{64}$/)
      expect(row.feed_token).toMatch(/^[0-9a-f]{64}$/)
      expect(row.public_token).not.toBe(row.feed_token)
    }
    expect(new Set(rows.flatMap((r) => [r.public_token, r.feed_token])).size).toBe(4)
  })

  it('an admin opens the public link; an agent cannot', async () => {
    expect(
      await asUser(w.db, U.bob, `UPDATE calendars SET public_enabled = TRUE RETURNING id`),
    ).toEqual([])
    expect(
      await asUser(w.db, U.alice, `UPDATE calendars SET public_enabled = TRUE WHERE name = 'Dr. João' RETURNING id`),
    ).toHaveLength(1)
  })

  it('records who booked, and refuses a source it does not know', async () => {
    const [cal] = await sql<{ id: string }>(w.db, `SELECT id FROM calendars WHERE name = 'Dr. João'`)
    const insert = (source: string, start: string) =>
      sql(
        w.db,
        `INSERT INTO calendar_events (account_id, calendar_id, source, starts_at, ends_at)
         VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz + INTERVAL '30 minutes')`,
        [w.A, cal.id, source, start],
      )
    await insert('public', '2030-02-04T13:00Z')
    await insert('ai', '2030-02-04T14:00Z')
    expect(await errorCode(insert('robô', '2030-02-04T15:00Z'))).toBe('23514')
    await book(w, U.bob, w.A, cal.id, '2030-02-04T16:00Z', '2030-02-04T16:30Z')
    expect(
      (await sql<{ source: string }>(w.db, 'SELECT source FROM calendar_events ORDER BY starts_at')).map(
        (r) => r.source,
      ),
    ).toEqual(['public', 'ai', 'team'])
  })

  it('the clinic template brings an agenda that talks to nobody yet', async () => {
    const [tpl] = await sql<{ id: string }>(w.db, `SELECT id FROM crm_templates WHERE slug = 'clinica-medica'`)
    const clinic = (
      await asUser<{ id: string }>(
        w.db,
        U.agus,
        `SELECT agencia_create_account('Clínica Agenda', 'agenda@teste.dev', 'tok-agenda', NOW() + INTERVAL '7 days', NULL, 'metrics') AS id`,
      )
    )[0].id
    const apply = () =>
      asUser<{ s: Record<string, number> }>(w.db, U.agus, 'SELECT agencia_apply_template($1, $2) AS s', [
        clinic,
        tpl.id,
      ]).then((r) => r[0].s)

    expect((await apply()).calendars).toBe(1)
    const [agenda] = await sql<{
      id: string
      name: string
      slot_minutes: number
      confirm_enabled: boolean
      reminder_enabled: boolean
      public_enabled: boolean
      feed_enabled: boolean
    }>(
      w.db,
      `SELECT id, name, slot_minutes, confirm_enabled, reminder_enabled, public_enabled, feed_enabled
       FROM calendars WHERE account_id = $1`,
      [clinic],
    )
    expect(agenda).toMatchObject({
      name: 'Consultas',
      slot_minutes: 30,
      confirm_enabled: false,
      reminder_enabled: false,
      public_enabled: false,
      feed_enabled: false,
    })
    const hours = await sql<{ weekday: number }>(
      w.db,
      'SELECT weekday FROM calendar_hours WHERE calendar_id = $1 ORDER BY weekday, starts',
      [agenda.id],
    )
    expect(hours.map((h) => h.weekday)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5])

    // Applying again leaves the agenda alone.
    const again = await apply()
    expect(again.calendars).toBe(0)
    expect(await sql(w.db, 'SELECT 1 FROM calendars WHERE account_id = $1', [clinic])).toHaveLength(1)
  })

  it('a template someone gave agendas of their own keeps them when 067 runs again', async () => {
    await sql(
      w.db,
      `UPDATE crm_templates SET content = content || '{"calendars": [{"name": "Minha", "hours": []}]}'::jsonb
       WHERE slug = 'clinica-medica'`,
    )
    await applyMigration(w.db, M067)
    const [row] = await sql<{ name: string }>(
      w.db,
      `SELECT content -> 'calendars' -> 0 ->> 'name' AS name FROM crm_templates WHERE slug = 'clinica-medica'`,
    )
    expect(row.name).toBe('Minha')
  })
})

describe('067 — the team hears about bookings from the public link', () => {
  let w: World
  let cal: string
  let ana: string
  beforeAll(async () => {
    w = await buildWorld()
    cal = (await newCalendar(w, U.alice, w.A, 'Dr. João'))[0].id
    ana = await contactId(w, 'Ana')
  })

  const bookAs = (source: string, status: string, start: string) =>
    sql(
      w.db,
      `INSERT INTO calendar_events (account_id, calendar_id, contact_id, source, status, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $6::timestamptz + INTERVAL '30 minutes')`,
      [w.A, cal, ana, source, status, start],
    )
  const bell = () =>
    sql<{ user_id: string; title: string; body: string; contact_id: string }>(
      w.db,
      `SELECT user_id, title, body, contact_id FROM notifications WHERE type = 'agenda_booking' ORDER BY title, user_id`,
    )

  it('a booking from the link reaches everyone who can act on it, and no viewer', async () => {
    await bookAs('public', 'scheduled', '2030-01-07T12:00Z')
    const rows = await bell()
    const who = new Set(rows.map((r) => r.user_id))
    expect(who.has(U.alice)).toBe(true) // owner
    expect(who.has(U.bob)).toBe(true) // agent
    expect(who.has(U.carol)).toBe(false) // viewer
    expect(who.has(U.dave)).toBe(false) // another CRM
    expect(rows[0]).toMatchObject({
      title: 'Novo agendamento pelo link',
      body: 'Ana · Dr. João · 07/01 às 09:00',
      contact_id: ana,
    })
  })

  it('one held for approval says so', async () => {
    await sql(w.db, `DELETE FROM notifications`)
    await bookAs('public', 'pending', '2030-01-08T12:00Z')
    expect((await bell())[0].title).toBe('Pedido de horário pelo link: aprove ou recuse')
  })

  it('bookings by the team or by an AI agent ring no bell', async () => {
    await sql(w.db, `DELETE FROM notifications`)
    await bookAs('team', 'scheduled', '2030-01-09T12:00Z')
    await bookAs('ai', 'pending', '2030-01-09T13:00Z')
    expect(await bell()).toEqual([])
  })

  it('a problem with the bell never costs the customer the booking', async () => {
    await sql(w.db, `UPDATE calendars SET timezone = 'Marte/Olympus' WHERE id = $1`, [cal])
    await bookAs('public', 'scheduled', '2030-01-10T12:00Z')
    expect(
      await sql(w.db, `SELECT 1 FROM calendar_events WHERE starts_at = '2030-01-10T12:00Z'`),
    ).toHaveLength(1)
  })

  it('the earlier notification types are still allowed', async () => {
    await sql(
      w.db,
      `INSERT INTO notifications (account_id, user_id, type, title) VALUES ($1, $2, 'task_due', 'x')`,
      [w.A, U.alice],
    )
  })
})
