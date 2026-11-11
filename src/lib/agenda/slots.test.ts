import { describe, expect, it } from 'vitest'

import {
  busyOf,
  dayRanges,
  freeSlots,
  overlaps,
  visibleRange,
  withinHours,
  type HoursRow,
} from './slots'
import { formatTime } from './time'

const SP = 'America/Sao_Paulo'
const MONDAY = '2030-01-07'
const LONG_AGO = new Date('2000-01-01T00:00:00Z')

/** Mondays 08–12 and 14–18, Wednesdays 09–11. */
const WEEK: HoursRow[] = [
  { weekday: 1, starts: '08:00:00', ends: '12:00:00' },
  { weekday: 1, starts: '14:00:00', ends: '18:00:00' },
  { weekday: 3, starts: '09:00', ends: '11:00' },
]

const at = (day: string, time: string) => new Date(`${day}T${time}:00-03:00`)
const times = (slots: { start: Date }[]) => slots.map((s) => formatTime(s.start, SP))

describe('dayRanges', () => {
  it('returns the day’s stretches in order', () => {
    expect(dayRanges(WEEK, 1)).toEqual([
      [480, 720],
      [840, 1080],
    ])
    expect(dayRanges(WEEK, 2)).toEqual([])
  })

  it('merges rows that touch or overlap', () => {
    expect(
      dayRanges(
        [
          { weekday: 1, starts: '12:00', ends: '18:00' },
          { weekday: 1, starts: '08:00', ends: '12:00' },
          { weekday: 1, starts: '09:00', ends: '10:00' },
        ],
        1,
      ),
    ).toEqual([[480, 1080]])
  })

  it('ignores a row that ends before it starts', () => {
    expect(dayRanges([{ weekday: 1, starts: '18:00', ends: '08:00' }], 1)).toEqual([])
  })
})

describe('overlaps', () => {
  it('back to back does not collide', () => {
    const a = { start: at(MONDAY, '09:00'), end: at(MONDAY, '10:00') }
    expect(overlaps(a, { start: at(MONDAY, '10:00'), end: at(MONDAY, '11:00') })).toBe(false)
    expect(overlaps(a, { start: at(MONDAY, '09:59'), end: at(MONDAY, '11:00') })).toBe(true)
  })
})

describe('freeSlots', () => {
  const base = {
    hours: WEEK,
    slotMinutes: 60,
    timezone: SP,
    busy: [],
    fromDay: MONDAY,
    days: 1,
    now: LONG_AGO,
  }

  it('offers every slot of an empty day, skipping lunch', () => {
    expect(times(freeSlots(base))).toEqual([
      '08:00',
      '09:00',
      '10:00',
      '11:00',
      '14:00',
      '15:00',
      '16:00',
      '17:00',
    ])
  })

  it('places them at the right instant for the agenda’s zone', () => {
    expect(freeSlots(base)[0].start.toISOString()).toBe('2030-01-07T11:00:00.000Z')
    expect(freeSlots({ ...base, timezone: 'America/Manaus' })[0].start.toISOString()).toBe(
      '2030-01-07T12:00:00.000Z',
    )
  })

  it('drops what is booked, including a booking that only clips the slot', () => {
    const busy = [
      { start: at(MONDAY, '09:00'), end: at(MONDAY, '10:00') },
      { start: at(MONDAY, '11:15'), end: at(MONDAY, '11:30') }, // um encaixe
    ]
    expect(times(freeSlots({ ...base, busy }))).toEqual([
      '08:00',
      '10:00',
      '14:00',
      '15:00',
      '16:00',
      '17:00',
    ])
  })

  it('a slot must fit whole before closing', () => {
    // 45-minute slots in 08–12: 11:45 would end at 12:30.
    const slots = freeSlots({ ...base, slotMinutes: 45 })
    expect(times(slots).slice(0, 6)).toEqual(['08:00', '08:45', '09:30', '10:15', '11:00', '14:00'])
  })

  it('does not offer what has already started', () => {
    const now = at(MONDAY, '15:01')
    expect(times(freeSlots({ ...base, now }))).toEqual(['16:00', '17:00'])
  })

  it('walks the days and skips the closed ones', () => {
    const slots = freeSlots({ ...base, days: 3, slotMinutes: 120 })
    expect(slots.map((s) => `${s.dayKey} ${formatTime(s.start, SP)}`)).toEqual([
      '2030-01-07 08:00',
      '2030-01-07 10:00',
      '2030-01-07 14:00',
      '2030-01-07 16:00',
      '2030-01-09 09:00',
    ])
  })

  it('stops at the limit', () => {
    expect(freeSlots({ ...base, days: 30, limit: 3 })).toHaveLength(3)
  })

  it('an agenda with no hours has no free slots', () => {
    expect(freeSlots({ ...base, hours: [], days: 7 })).toEqual([])
  })
})

describe('busyOf', () => {
  it('a cancelled event does not occupy the agenda', () => {
    const busy = busyOf([
      { starts_at: '2030-01-07T11:00:00Z', ends_at: '2030-01-07T12:00:00Z', status: 'scheduled' },
      { starts_at: '2030-01-07T12:00:00Z', ends_at: '2030-01-07T13:00:00Z', status: 'cancelled' },
      { starts_at: '2030-01-07T13:00:00Z', ends_at: '2030-01-07T14:00:00Z', status: 'no_show' },
    ])
    expect(busy.map((b) => b.start.toISOString())).toEqual([
      '2030-01-07T11:00:00.000Z',
      '2030-01-07T13:00:00.000Z',
    ])
  })
})

describe('withinHours', () => {
  it('inside one stretch is inside', () => {
    expect(withinHours(WEEK, MONDAY, 8 * 60, 9 * 60)).toBe(true)
    expect(withinHours(WEEK, MONDAY, 17 * 60, 18 * 60)).toBe(true)
  })

  it('over lunch, after closing or on a closed day is an encaixe', () => {
    expect(withinHours(WEEK, MONDAY, 11 * 60 + 30, 12 * 60 + 30)).toBe(false)
    expect(withinHours(WEEK, MONDAY, 18 * 60, 19 * 60)).toBe(false)
    expect(withinHours(WEEK, '2030-01-08', 9 * 60, 10 * 60)).toBe(false)
  })
})

describe('visibleRange', () => {
  it('covers every opening, in whole hours', () => {
    expect(visibleRange([{ weekday: 1, starts: '07:30', ends: '19:15' }])).toEqual([420, 1200])
  })

  it('a new agenda still gets a usable grid', () => {
    expect(visibleRange([])).toEqual([480, 1080])
  })
})
