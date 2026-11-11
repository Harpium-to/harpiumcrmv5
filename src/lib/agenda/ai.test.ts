import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import {
  AI_MAX_UPCOMING_PER_CONTACT,
  agendaPrompt,
  bookForAi,
  describeSlot,
  parseBookingMarker,
  resolveBooking,
  thinSlots,
  type AgendaForAi,
  type AiCalendar,
} from './ai'
import { freeSlots, type Slot } from './slots'

const SP = 'America/Sao_Paulo'
const MONDAY = '2030-01-07'
const NOW = new Date(`${MONDAY}T07:00:00-03:00`)

const slotsOf = (hours: [string, string][], minutes: number, days = 1): Slot[] =>
  freeSlots({
    hours: hours.flatMap(([starts, ends]) =>
      [1, 2, 3, 4, 5].map((weekday) => ({ weekday, starts, ends })),
    ),
    slotMinutes: minutes,
    timezone: SP,
    busy: [],
    fromDay: MONDAY,
    days,
    now: NOW,
  })

const joao: AiCalendar = {
  id: 'c1',
  name: 'Dr. João',
  slotMinutes: 60,
  timezone: SP,
  slots: slotsOf([['08:00', '11:00']], 60, 2),
}
const lia: AiCalendar = { id: 'c2', name: 'Dra. Lia', slotMinutes: 30, timezone: SP, slots: [] }

const agenda = (over: Partial<AgendaForAi> = {}): AgendaForAi => ({
  calendars: [joao],
  contactEvents: [],
  now: NOW,
  ...over,
})

describe('thinSlots', () => {
  it('keeps a short day whole', () => {
    expect(thinSlots(joao.slots, 12)).toHaveLength(6)
  })

  it('spreads a long day, first and last slot kept', () => {
    const day = slotsOf([['08:00', '18:00']], 15) // 40 slots
    const thin = thinSlots(day, 6)
    expect(thin).toHaveLength(6)
    expect(thin[0]).toBe(day[0])
    expect(thin[5]).toBe(day[39])
  })

  it('thins each day on its own', () => {
    const two = slotsOf([['08:00', '18:00']], 15, 2)
    const thin = thinSlots(two, 4)
    expect(thin.map((s) => s.dayKey)).toEqual([
      ...Array(4).fill(MONDAY),
      ...Array(4).fill('2030-01-08'),
    ])
  })
})

describe('agendaPrompt', () => {
  it('lists the free slots by day, on the agenda’s clock, with the date the marker needs', () => {
    const prompt = agendaPrompt(agenda(), { needsApproval: false })
    expect(prompt).toContain('It is now Mon 2030-01-07 07:00 (America/Sao_Paulo)')
    expect(prompt).toContain('Agenda 1 — Dr. João (60 min each)')
    expect(prompt).toContain('  Mon 2030-01-07: 08:00, 09:00, 10:00')
    expect(prompt).toContain('  Tue 2030-01-08: 08:00, 09:00, 10:00')
    expect(prompt).toContain('[[AGENDAR <agenda number> <YYYY-MM-DD> <HH:MM>]]')
  })

  it('says so when an agenda has nothing free', () => {
    expect(agendaPrompt(agenda({ calendars: [lia] }), { needsApproval: false })).toContain(
      'no free slots in the next 10 days',
    )
  })

  it('asks which professional only when there is a choice', () => {
    const one = agendaPrompt(agenda(), { needsApproval: false })
    const two = agendaPrompt(agenda({ calendars: [joao, lia] }), { needsApproval: false })
    expect(one).not.toContain('more than one agenda')
    expect(two).toContain('more than one agenda')
    expect(two).toContain('Agenda 2 — Dra. Lia')
  })

  it('tells the agent whether its booking is final or a reservation', () => {
    expect(agendaPrompt(agenda(), { needsApproval: false })).toContain('Booking takes effect at once')
    const reserved = agendaPrompt(agenda(), { needsApproval: true })
    expect(reserved).toContain('still has to approve')
    expect(reserved).not.toContain('Booking takes effect at once')
  })

  it('shows what the customer already has', () => {
    expect(agendaPrompt(agenda(), { needsApproval: false })).toContain(
      "This customer's upcoming appointments: none.",
    )
    const prompt = agendaPrompt(
      agenda({
        contactEvents: [
          { calendarName: 'Dr. João', startsAt: '2030-01-09T17:30:00.000Z', timezone: SP, status: 'pending' },
        ],
      }),
      { needsApproval: false },
    )
    expect(prompt).toContain(
      '- Wed 2030-01-09 14:30 with Dr. João (reserved, waiting for the team to confirm)',
    )
  })
})

describe('parseBookingMarker', () => {
  it('reads the marker and takes it out of the text', () => {
    expect(parseBookingMarker('Perfeito, Ana! Marcado.\n[[AGENDAR 1 2030-01-07 09:00]]')).toEqual({
      text: 'Perfeito, Ana! Marcado.',
      booking: { calendarNumber: 1, dayKey: MONDAY, minute: 540 },
    })
  })

  it('a reply without one is left alone', () => {
    expect(parseBookingMarker('Temos 09:00 ou 10:00. Qual prefere?')).toEqual({
      text: 'Temos 09:00 ou 10:00. Qual prefere?',
      booking: null,
    })
  })

  it('is forgiving about case and spacing', () => {
    expect(parseBookingMarker('Ok [[ agendar 2  2030-01-07  9:30 ]]').booking).toEqual({
      calendarNumber: 2,
      dayKey: MONDAY,
      minute: 570,
    })
  })

  it('a malformed marker books nothing and still never reaches the customer', () => {
    expect(parseBookingMarker('Marcado! [[AGENDAR amanhã às 9]]')).toEqual({
      text: 'Marcado!',
      booking: null,
    })
  })

  it('only the first one counts, and all of them are removed', () => {
    const parsed = parseBookingMarker('A [[AGENDAR 1 2030-01-07 09:00]] B [[AGENDAR 1 2030-01-08 10:00]]')
    expect(parsed.booking?.dayKey).toBe(MONDAY)
    expect(parsed.text).toBe('A B')
  })
})

describe('resolveBooking', () => {
  it('finds a slot the agent was shown', () => {
    const hit = resolveBooking(agenda(), { calendarNumber: 1, dayKey: MONDAY, minute: 540 })
    expect(hit?.calendar.id).toBe('c1')
    expect(hit?.slot.start.toISOString()).toBe('2030-01-07T12:00:00.000Z')
  })

  it('refuses a time that was not on the list', () => {
    const a = agenda()
    expect(resolveBooking(a, { calendarNumber: 1, dayKey: MONDAY, minute: 570 })).toBeNull() // 09:30
    expect(resolveBooking(a, { calendarNumber: 1, dayKey: MONDAY, minute: 780 })).toBeNull() // 13:00
    expect(resolveBooking(a, { calendarNumber: 1, dayKey: '2030-02-01', minute: 540 })).toBeNull()
  })

  it('refuses an agenda that is not there', () => {
    expect(resolveBooking(agenda(), { calendarNumber: 2, dayKey: MONDAY, minute: 540 })).toBeNull()
    expect(resolveBooking(agenda(), { calendarNumber: 0, dayKey: MONDAY, minute: 540 })).toBeNull()
  })
})

// A stand-in for the one insert bookForAi makes.
function fakeDb(result: { data: unknown; error: { code?: string } | null }) {
  const inserted: Record<string, unknown>[] = []
  const q = {
    insert: (row: Record<string, unknown>) => (inserted.push(row), q),
    select: () => q,
    single: async () => result,
  }
  return { db: { from: () => q } as unknown as SupabaseClient, inserted }
}

describe('bookForAi', () => {
  const args = (over: Partial<Parameters<typeof bookForAi>[1]> = {}) => ({
    accountId: 'acc',
    contactId: 'contact',
    agenda: agenda(),
    request: { calendarNumber: 1, dayKey: MONDAY, minute: 540 },
    needsApproval: false,
    agentName: 'Recepção',
    ...over,
  })

  it('books a listed slot, and the agent’s reply stands as the confirmation', async () => {
    const { db, inserted } = fakeDb({ data: { id: 'e1' }, error: null })
    const outcome = await bookForAi(db, args())
    expect(outcome).toMatchObject({ status: 'booked', eventId: 'e1' })
    expect(inserted[0]).toMatchObject({
      account_id: 'acc',
      calendar_id: 'c1',
      contact_id: 'contact',
      kind: 'appointment',
      status: 'scheduled',
      source: 'ai',
      starts_at: '2030-01-07T12:00:00.000Z',
      ends_at: '2030-01-07T13:00:00.000Z',
      notes: 'Marcado pelo agente de IA Recepção.',
    })
    expect(inserted[0].confirmation_at).toEqual(expect.any(String))
  })

  it('when a person must approve, holds the slot as pending and confirms nothing yet', async () => {
    const { db, inserted } = fakeDb({ data: { id: 'e1' }, error: null })
    expect(await bookForAi(db, args({ needsApproval: true }))).toMatchObject({
      status: 'pending',
      eventId: 'e1',
    })
    expect(inserted[0]).toMatchObject({ status: 'pending', confirmation_at: null })
  })

  it('writes nothing for a time the agent was never shown', async () => {
    const { db, inserted } = fakeDb({ data: { id: 'e1' }, error: null })
    expect(
      await bookForAi(db, args({ request: { calendarNumber: 1, dayKey: MONDAY, minute: 0 } })),
    ).toEqual({ status: 'invalid' })
    expect(inserted).toEqual([])
  })

  it('reports a slot someone else took in the meantime', async () => {
    const { db } = fakeDb({ data: null, error: { code: '23P01' } })
    expect(await bookForAi(db, args())).toEqual({ status: 'taken' })
  })

  it('does not book for a customer who already has several coming up', async () => {
    const { db, inserted } = fakeDb({ data: { id: 'e1' }, error: null })
    const busyCustomer = agenda({
      contactEvents: Array.from({ length: AI_MAX_UPCOMING_PER_CONTACT }, () => ({
        calendarName: 'Dr. João',
        startsAt: '2030-01-09T17:30:00.000Z',
        timezone: SP,
        status: 'scheduled',
      })),
    })
    expect(await bookForAi(db, args({ agenda: busyCustomer }))).toEqual({ status: 'limit' })
    expect(inserted).toEqual([])
  })

  it('any other failure is a failure, not a crash', async () => {
    const { db } = fakeDb({ data: null, error: { code: 'XX000' } })
    expect(await bookForAi(db, args())).toEqual({ status: 'failed' })
  })
})

describe('describeSlot', () => {
  it('reads like a person would say it', () => {
    expect(describeSlot(joao, joao.slots[1])).toBe('seg, 7 jan às 09:00')
  })
})
