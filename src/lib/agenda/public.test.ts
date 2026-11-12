import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ findExistingContact: vi.fn() }))
vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: h.findExistingContact,
  isUniqueViolation: (e: { code?: string } | null) => e?.code === '23505',
}))

import {
  bookPublic,
  loadPublicCalendar,
  parsePublicBooking,
  PUBLIC_MAX_UPCOMING,
  publicSlots,
  type PublicCalendar,
} from './public'

const SP = 'America/Sao_Paulo'
// A Monday, 07:00 in São Paulo.
const NOW = new Date('2030-01-07T07:00:00-03:00')

const calendar: PublicCalendar = {
  id: 'c1',
  accountId: 'acc',
  accountName: 'Clínica Sol',
  ownerUserId: 'owner',
  name: 'Dr. João',
  slotMinutes: 60,
  timezone: SP,
  autoConfirm: true,
}

type Row = Record<string, unknown>

/** Enough of the client for the public link: its reads, one count, the inserts. */
function fakeDb(world: {
  calendars?: Row[]
  hours?: Row[]
  events?: Row[]
  upcoming?: number
  eventError?: { code: string } | null
  contactError?: { code: string } | null
}) {
  const inserted: Record<string, Row[]> = { contacts: [], calendar_events: [] }
  const updated: Row[] = []
  const from = (table: string) => {
    let op: 'select' | 'insert' | 'update' = 'select'
    let head = false
    const filters: [string, unknown][] = []
    const rows = () => {
      if (table === 'calendar_hours') return world.hours ?? []
      if (table === 'calendar_events') return world.events ?? []
      if (table === 'calendars') {
        return (world.calendars ?? []).filter((r) => filters.every(([col, v]) => r[col] === v))
      }
      return []
    }
    const settle = () => {
      if (op === 'insert') {
        const error = table === 'contacts' ? world.contactError : world.eventError
        return error ? { data: null, error } : { data: { id: `${table}-new` }, error: null }
      }
      if (head) return { data: null, count: world.upcoming ?? 0, error: null }
      return { data: rows(), error: null }
    }
    const q: Record<string, unknown> = {
      select: (_c?: string, opts?: { head?: boolean }) => ((head = Boolean(opts?.head)), q),
      insert: (row: Row) => ((op = 'insert'), inserted[table]?.push(row), q),
      update: (row: Row) => ((op = 'update'), updated.push(row), q),
      eq: (col: string, v: unknown) => (filters.push([col, v]), q),
      neq: () => q,
      lt: () => q,
      gt: () => q,
      single: async () => settle(),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve(settle()),
    }
    return q
  }
  return { db: { from } as unknown as SupabaseClient, inserted, updated }
}

/** Mondays 08–11: three one-hour slots today. */
const HOURS = [{ weekday: 1, starts: '08:00:00', ends: '11:00:00' }]
const at = (time: string) => new Date(`2030-01-07T${time}:00-03:00`)

beforeEach(() => {
  h.findExistingContact.mockReset()
  h.findExistingContact.mockResolvedValue(null)
})

describe('loadPublicCalendar', () => {
  const token = 'a'.repeat(64)
  const row = {
    id: 'c1',
    account_id: 'acc',
    name: 'Dr. João',
    slot_minutes: 30,
    timezone: SP,
    public_auto_confirm: false,
    public_token: token,
    public_enabled: true,
    is_active: true,
    account: { name: 'Clínica Sol', owner_user_id: 'owner' },
  }

  it('opens an agenda whose link is on', async () => {
    const { db } = fakeDb({ calendars: [row] })
    expect(await loadPublicCalendar(db, token)).toEqual({
      id: 'c1',
      accountId: 'acc',
      accountName: 'Clínica Sol',
      ownerUserId: 'owner',
      name: 'Dr. João',
      slotMinutes: 30,
      timezone: SP,
      autoConfirm: false,
    })
  })

  it('stays shut when the link is off or the agenda is archived', async () => {
    expect(
      await loadPublicCalendar(fakeDb({ calendars: [{ ...row, public_enabled: false }] }).db, token),
    ).toBeNull()
    expect(
      await loadPublicCalendar(fakeDb({ calendars: [{ ...row, is_active: false }] }).db, token),
    ).toBeNull()
  })

  it('does not even look for something that is not a token', async () => {
    const { db } = fakeDb({ calendars: [row] })
    expect(await loadPublicCalendar(db, '../etc')).toBeNull()
    expect(await loadPublicCalendar(db, token.toUpperCase())).toBeNull()
    expect(await loadPublicCalendar(db, 'b'.repeat(64))).toBeNull()
  })
})

describe('publicSlots', () => {
  it('offers the free slots inside opening hours, minus what is taken', async () => {
    const { db } = fakeDb({
      hours: HOURS,
      events: [
        { starts_at: at('09:00').toISOString(), ends_at: at('10:00').toISOString(), status: 'pending' },
        { starts_at: at('10:00').toISOString(), ends_at: at('11:00').toISOString(), status: 'cancelled' },
      ],
    })
    const slots = await publicSlots(db, calendar, NOW)
    // 09:00 is held by a pending booking; the cancelled 10:00 is free again.
    expect(slots?.filter((s) => s.dayKey === '2030-01-07').map((s) => s.start.toISOString())).toEqual([
      at('08:00').toISOString(),
      at('10:00').toISOString(),
    ])
  })
})

describe('parsePublicBooking', () => {
  const ok = { start: '2030-01-07T11:00:00.000Z', name: '  Ana   Souza ', phone: '(11) 91234-5678' }

  it('accepts a name, a time and a Brazilian number without the country code', () => {
    expect(parsePublicBooking(ok)).toEqual({
      ok: true,
      input: { start: new Date('2030-01-07T11:00:00.000Z'), name: 'Ana Souza', phone: '5511912345678' },
    })
  })

  it('keeps a number that already has the country code', () => {
    const parsed = parsePublicBooking({ ...ok, phone: '+55 11 91234-5678' })
    expect(parsed.ok && parsed.input.phone).toBe('5511912345678')
  })

  it('refuses a missing name, a short number and a missing time', () => {
    expect(parsePublicBooking({ ...ok, name: ' ' })).toEqual({ ok: false, error: 'Informe o seu nome.' })
    expect(parsePublicBooking({ ...ok, phone: '91234-5678' })).toEqual({
      ok: false,
      error: 'Informe o seu WhatsApp com DDD.',
    })
    expect(parsePublicBooking({ ...ok, start: 'amanhã' })).toEqual({ ok: false, error: 'Escolha um horário.' })
    expect(parsePublicBooking(null).ok).toBe(false)
  })
})

describe('bookPublic', () => {
  const input = { start: at('09:00'), name: 'Ana Souza', phone: '5511912345678' }

  it('books a free slot for a new contact, attributed to the CRM’s owner', async () => {
    const { db, inserted } = fakeDb({ hours: HOURS })
    const outcome = await bookPublic(db, calendar, input, NOW)
    expect(outcome).toEqual({ status: 'booked', eventId: 'calendar_events-new', start: at('09:00') })
    expect(inserted.contacts).toEqual([
      { account_id: 'acc', user_id: 'owner', phone: '5511912345678', name: 'Ana Souza' },
    ])
    expect(inserted.calendar_events[0]).toMatchObject({
      account_id: 'acc',
      calendar_id: 'c1',
      contact_id: 'contacts-new',
      status: 'scheduled',
      source: 'public',
      starts_at: at('09:00').toISOString(),
      ends_at: at('10:00').toISOString(),
    })
  })

  it('reuses the contact that number already has, and never renames them', async () => {
    h.findExistingContact.mockResolvedValue({ id: 'k1', phone: '5511912345678', name: 'Ana (paciente)' })
    const { db, inserted, updated } = fakeDb({ hours: HOURS })
    await bookPublic(db, calendar, input, NOW)
    expect(inserted.contacts).toEqual([])
    expect(updated).toEqual([])
    expect(inserted.calendar_events[0].contact_id).toBe('k1')
  })

  it('fills in the name of a contact that only had a number', async () => {
    h.findExistingContact.mockResolvedValue({ id: 'k1', phone: '5511912345678', name: '5511912345678' })
    const { db, updated } = fakeDb({ hours: HOURS })
    await bookPublic(db, calendar, input, NOW)
    expect(updated[0]).toMatchObject({ name: 'Ana Souza' })
  })

  it('holds the slot as pending when the agenda asks for approval', async () => {
    const { db, inserted } = fakeDb({ hours: HOURS })
    const outcome = await bookPublic(db, { ...calendar, autoConfirm: false }, input, NOW)
    expect(outcome.status).toBe('pending')
    expect(inserted.calendar_events[0].status).toBe('pending')
  })

  it('refuses a time that is not a free slot, and creates no contact for it', async () => {
    const { db, inserted } = fakeDb({ hours: HOURS })
    for (const start of [at('09:30'), at('13:00'), at('06:00')]) {
      expect(await bookPublic(db, calendar, { ...input, start }, NOW)).toEqual({ status: 'unavailable' })
    }
    expect(inserted.contacts).toEqual([])
    expect(inserted.calendar_events).toEqual([])
  })

  it('refuses a slot someone else already has', async () => {
    const { db } = fakeDb({
      hours: HOURS,
      events: [
        { starts_at: at('09:00').toISOString(), ends_at: at('10:00').toISOString(), status: 'scheduled' },
      ],
    })
    expect(await bookPublic(db, calendar, input, NOW)).toEqual({ status: 'unavailable' })
  })

  it('reports a slot taken between looking and booking', async () => {
    const { db } = fakeDb({ hours: HOURS, eventError: { code: '23P01' } })
    expect(await bookPublic(db, calendar, input, NOW)).toEqual({ status: 'unavailable' })
  })

  it('a number with several appointments coming up cannot add another', async () => {
    const { db, inserted } = fakeDb({ hours: HOURS, upcoming: PUBLIC_MAX_UPCOMING })
    expect(await bookPublic(db, calendar, input, NOW)).toEqual({ status: 'limit' })
    expect(inserted.calendar_events).toEqual([])
  })

  it('two visitors creating the same contact at once both end up with it', async () => {
    h.findExistingContact
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'k9', phone: '5511912345678', name: 'Ana Souza' })
    const { db, inserted } = fakeDb({ hours: HOURS, contactError: { code: '23505' } })
    expect((await bookPublic(db, calendar, input, NOW)).status).toBe('booked')
    expect(inserted.calendar_events[0].contact_id).toBe('k9')
  })
})
