import { describe, it, expect } from 'vitest'
import {
  isWithinWorkingHours,
  nextWorkingSlot,
  parseTimeOfDay,
  type WorkSchedule,
} from './schedule'

const SP = 'America/Sao_Paulo' // UTC-3, no DST

function schedule(over: Partial<WorkSchedule> = {}): WorkSchedule {
  return {
    workDays: [1, 2, 3, 4, 5],
    workStart: '09:00',
    workEnd: '18:00',
    timezone: SP,
    ...over,
  }
}

/** A UTC instant, so the zone conversion is what's under test. */
function utc(iso: string) {
  return new Date(iso)
}

describe('parseTimeOfDay', () => {
  it('accepts HH:MM and HH:MM:SS', () => {
    expect(parseTimeOfDay('09:30')).toBe(570)
    expect(parseTimeOfDay('09:30:00')).toBe(570)
    expect(parseTimeOfDay('00:00')).toBe(0)
  })

  it('rejects impossible and malformed times', () => {
    expect(parseTimeOfDay('25:00')).toBeNull()
    expect(parseTimeOfDay('09:60')).toBeNull()
    expect(parseTimeOfDay('nine')).toBeNull()
    expect(parseTimeOfDay('')).toBeNull()
  })
})

describe('isWithinWorkingHours', () => {
  it('converts to the agent timezone, not the server one', () => {
    // 2026-05-18 is a Monday. 13:00 UTC = 10:00 in São Paulo → open.
    expect(isWithinWorkingHours(schedule(), utc('2026-05-18T13:00:00Z'))).toBe(
      true,
    )
    // 02:00 UTC Monday = 23:00 Sunday in São Paulo → closed, and the
    // weekday differs from UTC's. This is the case a naive server-local
    // check gets wrong.
    expect(isWithinWorkingHours(schedule(), utc('2026-05-18T02:00:00Z'))).toBe(
      false,
    )
  })

  it('excludes days off', () => {
    // Saturday 2026-05-23, midday São Paulo.
    expect(isWithinWorkingHours(schedule(), utc('2026-05-23T15:00:00Z'))).toBe(
      false,
    )
    expect(
      isWithinWorkingHours(
        schedule({ workDays: [1, 2, 3, 4, 5, 6] }),
        utc('2026-05-23T15:00:00Z'),
      ),
    ).toBe(true)
  })

  it('treats the end of the window as exclusive', () => {
    // 21:00 UTC = 18:00 São Paulo — the window has closed.
    expect(isWithinWorkingHours(schedule(), utc('2026-05-18T21:00:00Z'))).toBe(
      false,
    )
    expect(
      isWithinWorkingHours(schedule(), utc('2026-05-18T20:59:00Z')),
    ).toBe(true)
  })

  it('supports an overnight window', () => {
    const night = schedule({ workStart: '22:00', workEnd: '06:00' })
    // 02:00 São Paulo Monday = 05:00 UTC Monday.
    expect(isWithinWorkingHours(night, utc('2026-05-18T05:00:00Z'))).toBe(true)
    // 12:00 São Paulo Monday — outside.
    expect(isWithinWorkingHours(night, utc('2026-05-18T15:00:00Z'))).toBe(false)
  })

  it('treats an equal start and end as always open', () => {
    const always = schedule({ workStart: '00:00', workEnd: '00:00' })
    expect(isWithinWorkingHours(always, utc('2026-05-18T03:00:00Z'))).toBe(true)
  })

  it('is closed rather than always-open when the schedule is unusable', () => {
    expect(isWithinWorkingHours(schedule({ workStart: 'x' }), utc('2026-05-18T13:00:00Z'))).toBe(false)
    expect(isWithinWorkingHours(schedule({ workDays: [] }), utc('2026-05-18T13:00:00Z'))).toBe(false)
  })

  it('falls back to UTC instead of throwing on an invalid timezone', () => {
    // 13:00 UTC on a Monday is inside 09:00–18:00 read as UTC.
    expect(
      isWithinWorkingHours(
        schedule({ timezone: 'Not/AZone' }),
        utc('2026-05-18T13:00:00Z'),
      ),
    ).toBe(true)
  })
})

describe('nextWorkingSlot', () => {
  it('returns now when the agent is already on shift', () => {
    const now = utc('2026-05-18T13:00:00Z')
    expect(nextWorkingSlot(schedule(), now)).toBe(now)
  })

  it('defers an after-hours task to the next morning', () => {
    // Monday 22:00 São Paulo (= Tuesday 01:00 UTC).
    const slot = nextWorkingSlot(schedule(), utc('2026-05-19T01:00:00Z'))
    expect(slot).not.toBeNull()
    expect(isWithinWorkingHours(schedule(), slot!)).toBe(true)
    // Tuesday 09:00 São Paulo = 12:00 UTC.
    expect(slot!.toISOString()).toBe('2026-05-19T12:00:00.000Z')
  })

  it('skips the weekend', () => {
    // Friday 20:00 São Paulo (= Friday 23:00 UTC).
    const slot = nextWorkingSlot(schedule(), utc('2026-05-22T23:00:00Z'))
    // Monday 09:00 São Paulo = Monday 12:00 UTC.
    expect(slot!.toISOString()).toBe('2026-05-25T12:00:00.000Z')
  })

  it('returns null when the schedule never opens', () => {
    expect(
      nextWorkingSlot(schedule({ workDays: [] }), utc('2026-05-18T13:00:00Z')),
    ).toBeNull()
  })
})
