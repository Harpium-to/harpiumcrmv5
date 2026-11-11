import { describe, expect, it } from 'vitest'

import {
  addDays,
  dayKeyOf,
  formatClock,
  formatDayLong,
  formatDayShort,
  formatTime,
  formatWeekRange,
  fromLocalInput,
  minutesOfDay,
  parseClock,
  safeTimeZone,
  startOfWeek,
  toLocalInput,
  weekdayOf,
  zonedToUtc,
} from './time'

const SP = 'America/Sao_Paulo' // UTC-3, no daylight saving
const MANAUS = 'America/Manaus' // UTC-4
const NY = 'America/New_York' // daylight saving

describe('day keys', () => {
  it('the same instant is a different day in different zones', () => {
    const instant = new Date('2030-01-08T02:30:00Z')
    expect(dayKeyOf(instant, SP)).toBe('2030-01-07')
    expect(dayKeyOf(instant, 'UTC')).toBe('2030-01-08')
    expect(minutesOfDay(instant, SP)).toBe(23 * 60 + 30)
  })

  it('adds days across months and years', () => {
    expect(addDays('2030-01-31', 1)).toBe('2030-02-01')
    expect(addDays('2030-01-01', -1)).toBe('2029-12-31')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29') // leap year
  })

  it('weekdays are ISO, Monday first', () => {
    expect(weekdayOf('2030-01-07')).toBe(1) // a Monday
    expect(weekdayOf('2030-01-13')).toBe(7) // Sunday
    expect(startOfWeek('2030-01-13')).toBe('2030-01-07')
    expect(startOfWeek('2030-01-07')).toBe('2030-01-07')
  })
})

describe('zonedToUtc', () => {
  it('08:00 in São Paulo is 11:00 UTC', () => {
    expect(zonedToUtc('2030-01-07', 8 * 60, SP).toISOString()).toBe('2030-01-07T11:00:00.000Z')
  })

  it('08:00 in Manaus is an hour later than in São Paulo', () => {
    expect(zonedToUtc('2030-01-07', 8 * 60, MANAUS).toISOString()).toBe('2030-01-07T12:00:00.000Z')
  })

  it('follows daylight saving where it exists', () => {
    expect(zonedToUtc('2030-01-07', 9 * 60, NY).toISOString()).toBe('2030-01-07T14:00:00.000Z')
    expect(zonedToUtc('2030-07-08', 9 * 60, NY).toISOString()).toBe('2030-07-08T13:00:00.000Z')
  })

  it('midnight at the end of the day is the next day’s start', () => {
    expect(zonedToUtc('2030-01-07', 24 * 60, SP).toISOString()).toBe(
      zonedToUtc('2030-01-08', 0, SP).toISOString(),
    )
  })

  it('round-trips with the clock it was built from', () => {
    const instant = zonedToUtc('2030-03-15', 14 * 60 + 45, SP)
    expect(dayKeyOf(instant, SP)).toBe('2030-03-15')
    expect(formatTime(instant, SP)).toBe('14:45')
  })

  it('an unknown zone reads as the default', () => {
    expect(safeTimeZone('Marte/Olympus')).toBe(SP)
    expect(safeTimeZone(null)).toBe(SP)
    expect(zonedToUtc('2030-01-07', 8 * 60, 'Marte/Olympus').toISOString()).toBe(
      '2030-01-07T11:00:00.000Z',
    )
  })
})

describe('clock strings', () => {
  it('parses what Postgres and the time input send', () => {
    expect(parseClock('08:00')).toBe(480)
    expect(parseClock('08:30:00')).toBe(510)
    expect(parseClock('24:00')).toBe(1440)
    expect(parseClock('')).toBe(0)
    expect(parseClock(null)).toBe(0)
  })

  it('formats minutes back', () => {
    expect(formatClock(480)).toBe('08:00')
    expect(formatClock(1439)).toBe('23:59')
    expect(formatClock(1440)).toBe('24:00')
  })
})

describe('datetime-local fields speak the agenda’s zone', () => {
  it('shows an instant on the agenda’s clock', () => {
    expect(toLocalInput(new Date('2030-01-07T11:00:00Z'), SP)).toBe('2030-01-07T08:00')
    expect(toLocalInput(new Date('2030-01-07T11:00:00Z'), MANAUS)).toBe('2030-01-07T07:00')
  })

  it('reads the field back as that same instant', () => {
    expect(fromLocalInput('2030-01-07T08:00', SP)?.toISOString()).toBe('2030-01-07T11:00:00.000Z')
    expect(fromLocalInput('', SP)).toBeNull()
    expect(fromLocalInput('amanhã', SP)).toBeNull()
  })
})

describe('labels', () => {
  it('names days in Portuguese', () => {
    expect(formatDayShort('2030-01-07')).toBe('seg, 7 jan')
    expect(formatDayLong('2030-01-07')).toBe('segunda-feira, 7 de janeiro de 2030')
  })

  it('names a week, inside one month or across two', () => {
    expect(formatWeekRange('2030-01-07')).toBe('7 – 13 de janeiro de 2030')
    expect(formatWeekRange('2029-12-31')).toBe('31 dez – 6 jan de 2030')
  })
})
